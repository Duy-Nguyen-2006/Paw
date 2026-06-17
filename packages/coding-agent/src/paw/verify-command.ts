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
import {
	createPawNativeVerificationCommandPolicy,
	createPawPolicyCheckedNativeVerificationExecutor,
} from "./verification-command-policy.ts";
import { createPawNativeSubprocessExecutor } from "./verification-executor.ts";
import { createPawNativeVerificationPlan, type PawNativeVerificationPlanEntry } from "./verification-plan.ts";
import type { PawNativeVerificationExecutor, PawNativeVerificationRunResult } from "./verification-runner.ts";
import { mapPawNativeVerificationRunResults, runPawNativeVerificationPlan } from "./verification-runner.ts";
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
	nativeVerificationExecutor?: PawNativeVerificationExecutor;
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
	nativeVerificationRunResults: readonly PawNativeVerificationRunResult[];
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

	const runtimeConfig = loadDefaultPawRuntimeConfig(repoRoot);
	const nativeVerificationPlan = createPawNativeVerificationPlan(runtimeConfig.verify.v1_gates);

	let verifyDecisions: PawVerifyGateDecision[];
	let nativeVerificationRunResults: PawNativeVerificationRunResult[];
	if (input.nativeVerificationExecutor !== undefined) {
		nativeVerificationRunResults = await runPawNativeVerificationPlan(
			nativeVerificationPlan,
			input.nativeVerificationExecutor,
			{
				timeoutSec: runtimeConfig.resilience.tool_call.timeout_sec,
				outputMaxChars: runtimeConfig.verify.summary_max_tokens,
			},
		);
		verifyDecisions = mapPawNativeVerificationRunResults(nativeVerificationRunResults, runtimeConfig.verify);
	} else {
		nativeVerificationRunResults = [];
		verifyDecisions = nativeVerificationPlan.map((entry) =>
			evaluatePawVerifyGate({
				gate: entry.gate,
				available: false,
				config: runtimeConfig.verify,
				reason: entry.reason,
			}),
		);
	}

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
				nativeVerificationRunResults,
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
				`native executed gates: ${formatNativeExecutedGateNames(result.nativeVerificationRunResults)}`,
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

export type PawVerifyParsedArgs =
	| { kind: "help"; native: boolean }
	| { kind: "error"; native: boolean; message: string }
	| { kind: "ok"; native: boolean; sessionId: string };

export function parsePawVerifyArgs(args: string[]): PawVerifyParsedArgs {
	const native = args.includes("--native");
	const hasHelp = args.some((arg) => arg === "--help" || arg === "-h");

	if (hasHelp) {
		return { kind: "help", native };
	}

	const knownFlags = new Set(["--native", "--help", "-h"]);
	const positional = args.filter((arg) => !knownFlags.has(arg));

	if (positional.length === 0) {
		return { kind: "error", native, message: 'Missing required session id for "paw verify".' };
	}

	const unknownFlag = positional.find((arg) => arg.startsWith("-"));
	if (unknownFlag !== undefined) {
		return { kind: "error", native, message: `Unknown option for "paw verify": ${unknownFlag}` };
	}

	if (positional.length > 1) {
		return { kind: "error", native, message: `Unknown option for "paw verify": ${positional[1]}` };
	}

	return { kind: "ok", native, sessionId: positional[0] };
}

export async function runPawVerifyCommand(args: string[]): Promise<void> {
	const parsed = parsePawVerifyArgs(args);

	if (parsed.kind === "help") {
		printPawVerifyHelp();
		return;
	}

	if (parsed.kind === "error") {
		printPawVerifyCommandError(parsed.message);
		return;
	}

	const nativeVerificationExecutor = parsed.native
		? (() => {
				const repoRoot = process.cwd();
				const runtimeConfig = loadDefaultPawRuntimeConfig(repoRoot);
				const plan = createPawNativeVerificationPlan(runtimeConfig.verify.v1_gates);
				const policy = createPawNativeVerificationCommandPolicy(plan);
				return createPawPolicyCheckedNativeVerificationExecutor(
					createPawNativeSubprocessExecutor({ cwd: repoRoot }),
					policy,
				);
			})()
		: undefined;

	try {
		console.log(
			formatPawVerifyCommandResult(
				await createPawVerifyCommandResult(process.cwd(), parsed.sessionId, {
					nativeVerificationExecutor,
				}),
			),
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		printPawVerifyCommandError(message);
	}
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

function formatNativeExecutedGateNames(results: readonly PawNativeVerificationRunResult[]): string {
	const executed = results.filter((result) => result.executed);
	if (executed.length === 0) {
		return "none";
	}
	return executed.map((result) => `${result.gate}(${result.status})`).join(", ");
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
  ${APP_NAME} paw verify <session-id> [--native]

Evaluate configured Paw verification gates for a session.

Options:
  --native    Execute verification gates via native subprocess

Commands:
  ${APP_NAME} paw verify <session-id>          Record verification decisions for current slice
  ${APP_NAME} paw verify <session-id> --native Run native verification gates for current slice
  ${APP_NAME} paw verify --help                Show this help
`);
}

function printPawVerifyCommandError(message: string): void {
	console.error(`Error: ${message}`);
	process.exitCode = 1;
}

function isFileSystemError(error: unknown): error is FileSystemError {
	return error instanceof Error;
}
