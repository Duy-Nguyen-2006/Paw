import { stat } from "node:fs/promises";
import { relative } from "node:path";
import { APP_NAME } from "../config.ts";
import { loadDefaultPawRuntimeConfig } from "./config.ts";
import type { PawValidationIssue } from "./contracts.ts";
import { resolvePawProjectPaths } from "./persistence.ts";
import { evaluatePawVerifyGate, type PawVerifyGateDecision } from "./resilience-policy.ts";
import {
	acquirePawSessionLock,
	type PawSessionLock,
	type PawSessionLockOptions,
	releasePawSessionLock,
	resolvePawSessionPaths,
} from "./session-store.ts";
import type { PawSessionStateName } from "./state.ts";
import { createPawNativeVerificationPlan, type PawNativeVerificationPlanEntry } from "./verification-plan.ts";
import { completePawVerification } from "./verifier-result.ts";

export type PawVerifyCommandResult =
	| PawVerifyCommandCompletedResult
	| PawVerifyCommandMissingProjectResult
	| PawVerifyCommandMissingSessionResult
	| PawVerifyCommandLockedResult
	| PawVerifyCommandInvalidStateResult
	| PawVerifyCommandInvalidVerificationResult;

export interface PawVerifyCommandInput {
	lockOptions?: PawSessionLockOptions;
}

export interface PawVerifyCommandCompletedResult {
	status: "completed" | "completed_with_unverified";
	sessionId: string;
	previousStateName: PawSessionStateName;
	nextStateName: PawSessionStateName;
	currentSliceId: string;
	nativeVerificationPlan: readonly PawNativeVerificationPlanEntry[];
	verifyDecisions: readonly PawVerifyGateDecision[];
	unverifiedDecisions: readonly PawVerifyGateDecision[];
	lockReleased: boolean;
}

export interface PawVerifyCommandMissingProjectResult {
	status: "missing_project";
	pawDir: string;
}

export interface PawVerifyCommandMissingSessionResult {
	status: "missing_session";
	sessionId: string;
	stateFile: string;
}

export interface PawVerifyCommandLockedResult {
	status: "locked";
	sessionId: string;
	lock: PawSessionLock;
}

export interface PawVerifyCommandInvalidStateResult {
	status: "invalid_state";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawVerifyCommandInvalidVerificationResult {
	status: "invalid_verification";
	sessionId: string;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

interface FileSystemError extends Error {
	code?: string;
}

export async function createPawVerifyCommandResult(
	repoRoot: string,
	sessionId: string,
	input: PawVerifyCommandInput = {},
): Promise<PawVerifyCommandResult> {
	const projectPaths = resolvePawProjectPaths(repoRoot);
	const pawDir = relative(projectPaths.repoRoot, projectPaths.pawDir) || ".paw";
	if (!(await isDirectory(projectPaths.pawDir))) {
		return {
			status: "missing_project",
			pawDir,
		};
	}

	const sessionPaths = resolvePawSessionPaths(repoRoot, sessionId);
	const relativeStateFile = relative(projectPaths.repoRoot, sessionPaths.stateFile);
	if (!(await isFile(sessionPaths.stateFile))) {
		return {
			status: "missing_session",
			sessionId,
			stateFile: relativeStateFile,
		};
	}

	const lockResult = await acquirePawSessionLock(repoRoot, sessionId, input.lockOptions);
	if (!lockResult.acquired) {
		return {
			status: "locked",
			sessionId,
			lock: lockResult.lock,
		};
	}

	const nativeVerificationPlan = createFoundationVerificationPlan(repoRoot);
	const verifyDecisions = createFoundationVerifyDecisions(repoRoot, nativeVerificationPlan);
	const verification = await completePawVerification({
		repoRoot,
		sessionId,
		verifyDecisions,
		lockOptions: input.lockOptions,
	});
	const lockReleased = await releasePawSessionLock(repoRoot, sessionId, input.lockOptions);

	switch (verification.status) {
		case "completed":
		case "completed_with_unverified":
			return {
				status: verification.status,
				sessionId,
				previousStateName: verification.previousState.name,
				nextStateName: verification.nextState.name,
				currentSliceId: verification.previousState.current_slice_id ?? "",
				nativeVerificationPlan,
				verifyDecisions: verification.verifyDecisions,
				unverifiedDecisions: verification.unverifiedDecisions,
				lockReleased,
			};
		case "invalid_state":
		case "no_selected_slice":
			return {
				status: "invalid_state",
				sessionId,
				previousStateName: verification.previousState.name,
				issues: verification.issues,
				lockReleased,
			};
		case "invalid_verify_decisions":
		case "invalid_transition":
			return {
				status: "invalid_verification",
				sessionId,
				issues: verification.issues,
				lockReleased,
			};
		case "not_locked":
			return {
				status: "invalid_verification",
				sessionId,
				issues: [{ path: "/lock", message: `Acquired lock was not current: ${verification.reason}.` }],
				lockReleased,
			};
		case "locked_by_other":
			return {
				status: "locked",
				sessionId,
				lock: verification.lock,
			};
	}
}

export function formatPawVerifyCommandResult(result: PawVerifyCommandResult): string {
	switch (result.status) {
		case "completed":
		case "completed_with_unverified":
			return [
				"Paw verify",
				`session: ${result.sessionId}`,
				`status: ${result.status}`,
				`state: ${result.previousStateName} -> ${result.nextStateName}`,
				`slice: ${result.currentSliceId}`,
				`planned native gates: ${formatPlannedGateNames(result.nativeVerificationPlan)}`,
				`verified gates: ${formatGateNames(result.verifyDecisions.filter((decision) => decision.status === "verified"))}`,
				`unverified gates: ${formatGateNames(result.unverifiedDecisions)}`,
				`lock released: ${result.lockReleased ? "yes" : "no"}`,
			].join("\n");
		case "missing_project":
			return `Paw is not initialized at ${result.pawDir}. Run \`${APP_NAME} paw init\`.`;
		case "missing_session":
			return `No Paw session state found for ${result.sessionId} at ${result.stateFile}.`;
		case "locked":
			return `Paw session ${result.sessionId} is locked by pid ${result.lock.pid} on ${result.lock.host}.`;
		case "invalid_state":
			return `Cannot verify session ${result.sessionId} from ${result.previousStateName}: ${formatIssues(result.issues)}`;
		case "invalid_verification":
			return `Cannot verify session ${result.sessionId}: ${formatIssues(result.issues)}`;
	}
}

export async function runPawVerifyCommand(args: string[]): Promise<void> {
	if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
		printPawVerifyHelp();
		return;
	}

	if (args.length === 0) {
		printPawVerifyCommandError('Missing required session id for "paw verify".');
		return;
	}

	if (args.length > 1) {
		printPawVerifyCommandError(`Unknown option for "paw verify": ${args[1]}`);
		return;
	}

	try {
		console.log(formatPawVerifyCommandResult(await createPawVerifyCommandResult(process.cwd(), args[0])));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		printPawVerifyCommandError(message);
	}
}

function createFoundationVerificationPlan(repoRoot: string): PawNativeVerificationPlanEntry[] {
	const config = loadDefaultPawRuntimeConfig(repoRoot).verify;
	return createPawNativeVerificationPlan(config.v1_gates);
}

function createFoundationVerifyDecisions(
	repoRoot: string,
	plan: readonly PawNativeVerificationPlanEntry[],
): PawVerifyGateDecision[] {
	const config = loadDefaultPawRuntimeConfig(repoRoot).verify;
	return plan.map((entry) =>
		evaluatePawVerifyGate({
			gate: entry.gate,
			available: false,
			config,
			reason: entry.reason,
		}),
	);
}

async function isDirectory(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory();
	} catch (error) {
		if (isFileSystemError(error) && error.code === "ENOENT") {
			return false;
		}
		throw error;
	}
}

async function isFile(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isFile();
	} catch (error) {
		if (isFileSystemError(error) && error.code === "ENOENT") {
			return false;
		}
		throw error;
	}
}

function formatGateNames(decisions: readonly PawVerifyGateDecision[]): string {
	if (decisions.length === 0) {
		return "none";
	}
	return decisions.map((decision) => decision.gate).join(", ");
}

function formatPlannedGateNames(entries: readonly PawNativeVerificationPlanEntry[]): string {
	const plannedEntries = entries.filter((entry) => entry.status === "planned");
	if (plannedEntries.length === 0) {
		return "none";
	}
	return plannedEntries.map((entry) => entry.gate).join(", ");
}

function formatIssues(issues: readonly PawValidationIssue[]): string {
	return issues.map((issue) => `${issue.path} ${issue.message}`).join("; ");
}

function printPawVerifyHelp(): void {
	console.log(`Usage:
  ${APP_NAME} paw verify <session-id>

Evaluate configured Paw verification gates for a session.

Commands:
  ${APP_NAME} paw verify <session-id> Record verification decisions for current slice
  ${APP_NAME} paw verify --help       Show this help
`);
}

function printPawVerifyCommandError(message: string): void {
	console.error(`Error: ${message}`);
	process.exitCode = 1;
}

function isFileSystemError(error: unknown): error is FileSystemError {
	return error instanceof Error;
}
