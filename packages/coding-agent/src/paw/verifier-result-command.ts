import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { APP_NAME } from "../config.ts";
import {
	type PawCliScalarFieldBinding,
	pawCliArgsShowHelp,
	pawCliParseRequiredSessionId,
	pawCliParseScalarFieldsFromArgs,
} from "./cli-arg-parsing.ts";
import { formatPawCliValidationIssues, isPawFileSystemError, pawCliIsDirectory, pawCliIsFile } from "./cli-fs.ts";
import type { PawValidationIssue } from "./contracts.ts";
import { mapPawNotLockedCommandFields } from "./lock-result-mapping.ts";
import { resolvePawProjectPaths } from "./persistence.ts";
import type { PawVerifyGateDecision } from "./resilience-policy.ts";
import {
	acquirePawSessionLock,
	type PawSessionLock,
	type PawSessionLockOptions,
	type PawSessionLockStaleReason,
	releasePawSessionLock,
	resolvePawSessionPaths,
} from "./session-store.ts";
import type { PawSessionStateName } from "./state.ts";
import { completePawVerification, type PawVerificationResult } from "./verifier-result.ts";
import { extractPawVerifyDecisionsFromJson, normalizePawVerifyGateDecisionList } from "./verify-gate-decision-parse.ts";

const COMPLETE_VERIFICATION_COMMAND_LABEL = "paw complete-verification";

export type PawCompleteVerificationCommandResult =
	| PawCompleteVerificationCommandCompletedResult
	| PawCompleteVerificationCommandCompletedWithUnverifiedResult
	| PawCompleteVerificationCommandInvalidDecisionFileResult
	| PawCompleteVerificationCommandMissingDecisionFileResult
	| PawCompleteVerificationCommandMissingProjectResult
	| PawCompleteVerificationCommandMissingSessionResult
	| PawCompleteVerificationCommandLockedResult
	| PawCompleteVerificationCommandInvalidStateResult
	| PawCompleteVerificationCommandNoSelectedSliceResult
	| PawCompleteVerificationCommandInvalidVerifyDecisionsResult
	| PawCompleteVerificationCommandInvalidTransitionResult
	| PawCompleteVerificationCommandNotLockedResult
	| PawCompleteVerificationCommandLockedByOtherResult;

export interface PawCompleteVerificationCommandInput {
	lockOptions?: PawSessionLockOptions;
}

export interface PawCompleteVerificationCommandCompletedResult {
	status: "completed";
	sessionId: string;
	selectedSliceId: string;
	previousStateName: PawSessionStateName;
	nextStateName: PawSessionStateName;
	decisionCount: number;
	unverifiedCount: number;
	lockReleased: boolean;
}

export interface PawCompleteVerificationCommandCompletedWithUnverifiedResult {
	status: "completed_with_unverified";
	sessionId: string;
	selectedSliceId: string;
	previousStateName: PawSessionStateName;
	nextStateName: PawSessionStateName;
	decisionCount: number;
	unverifiedCount: number;
	lockReleased: boolean;
}

export interface PawCompleteVerificationCommandInvalidDecisionFileResult {
	status: "invalid_decision_file";
	sessionId: string;
	decisionFile: string;
	issues: readonly PawValidationIssue[];
}

export interface PawCompleteVerificationCommandMissingDecisionFileResult {
	status: "missing_decision_file";
	sessionId: string;
	decisionFile: string;
}

export interface PawCompleteVerificationCommandMissingProjectResult {
	status: "missing_project";
	pawDir: string;
}

export interface PawCompleteVerificationCommandMissingSessionResult {
	status: "missing_session";
	sessionId: string;
	stateFile: string;
}

export interface PawCompleteVerificationCommandLockedResult {
	status: "locked";
	sessionId: string;
	lock: PawSessionLock;
}

export interface PawCompleteVerificationCommandInvalidStateResult {
	status: "invalid_state";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawCompleteVerificationCommandNoSelectedSliceResult {
	status: "no_selected_slice";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawCompleteVerificationCommandInvalidVerifyDecisionsResult {
	status: "invalid_verify_decisions";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawCompleteVerificationCommandInvalidTransitionResult {
	status: "invalid_transition";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawCompleteVerificationCommandNotLockedResult {
	status: "not_locked";
	sessionId: string;
	reason: "unlocked" | "stale";
	staleReason?: PawSessionLockStaleReason;
	lockReleased: boolean;
}

export interface PawCompleteVerificationCommandLockedByOtherResult {
	status: "locked_by_other";
	sessionId: string;
	lock: PawSessionLock;
	lockReleased: boolean;
}

export interface PawCompleteVerificationParsedInput {
	decisionFile: string;
}

export type PawCompleteVerificationParsedArgs =
	| { kind: "help" }
	| { kind: "error"; message: string }
	| { kind: "ok"; sessionId: string; input: PawCompleteVerificationParsedInput };

const COMPLETE_VERIFICATION_SCALAR_OPTIONS = new Set(["--decision-file"]);

export function parsePawCompleteVerificationArgs(args: string[]): PawCompleteVerificationParsedArgs {
	if (pawCliArgsShowHelp(args)) {
		return { kind: "help" };
	}

	const sessionIdResult = pawCliParseRequiredSessionId(args, COMPLETE_VERIFICATION_COMMAND_LABEL);
	if ("kind" in sessionIdResult) {
		return sessionIdResult;
	}

	let decisionFile: string | undefined;
	const bindings: PawCliScalarFieldBinding[] = [
		{
			option: "--decision-file",
			set: (value) => {
				decisionFile = value;
			},
		},
	];
	const fields = pawCliParseScalarFieldsFromArgs(
		COMPLETE_VERIFICATION_COMMAND_LABEL,
		args,
		1,
		COMPLETE_VERIFICATION_SCALAR_OPTIONS,
		bindings,
	);
	if ("kind" in fields) {
		return fields;
	}

	if (decisionFile === undefined) {
		return {
			kind: "error",
			message: `Missing required option for "${COMPLETE_VERIFICATION_COMMAND_LABEL}": --decision-file`,
		};
	}

	return { kind: "ok", sessionId: sessionIdResult.sessionId, input: { decisionFile } };
}

export async function createPawCompleteVerificationCommandResult(
	repoRoot: string,
	sessionId: string,
	input: PawCompleteVerificationParsedInput,
	commandInput: PawCompleteVerificationCommandInput = {},
): Promise<PawCompleteVerificationCommandResult> {
	const relativeDecisionFile = relative(repoRoot, input.decisionFile) || input.decisionFile;
	const projectPaths = resolvePawProjectPaths(repoRoot);
	const pawDir = relative(projectPaths.repoRoot, projectPaths.pawDir) || ".paw";
	if (!(await pawCliIsDirectory(projectPaths.pawDir))) {
		return {
			status: "missing_project",
			pawDir,
		};
	}

	const sessionPaths = resolvePawSessionPaths(repoRoot, sessionId);
	const relativeStateFile = relative(projectPaths.repoRoot, sessionPaths.stateFile);
	if (!(await pawCliIsFile(sessionPaths.stateFile))) {
		return {
			status: "missing_session",
			sessionId,
			stateFile: relativeStateFile,
		};
	}

	const decisionRead = await readVerificationDecisionFile(input.decisionFile);
	if (decisionRead.kind === "missing") {
		return {
			status: "missing_decision_file",
			sessionId,
			decisionFile: relativeDecisionFile,
		};
	}
	if (decisionRead.kind === "invalid") {
		return {
			status: "invalid_decision_file",
			sessionId,
			decisionFile: relativeDecisionFile,
			issues: decisionRead.issues,
		};
	}

	const lockResult = await acquirePawSessionLock(repoRoot, sessionId, commandInput.lockOptions);
	if (!lockResult.acquired) {
		return {
			status: "locked",
			sessionId,
			lock: lockResult.lock,
		};
	}

	const completion = await completePawVerification({
		repoRoot,
		sessionId,
		verifyDecisions: decisionRead.value,
		lockOptions: commandInput.lockOptions,
	});
	const lockReleased = await releasePawSessionLock(repoRoot, sessionId, commandInput.lockOptions);
	return mapPawCompleteVerificationResult(sessionId, completion, lockReleased);
}

export function formatPawCompleteVerificationCommandResult(result: PawCompleteVerificationCommandResult): string {
	switch (result.status) {
		case "completed":
		case "completed_with_unverified":
			return [
				"Paw complete-verification",
				`session: ${result.sessionId}`,
				`status: ${result.status}`,
				`selected slice: ${result.selectedSliceId}`,
				`state: ${result.previousStateName} -> ${result.nextStateName}`,
				`decisions: ${result.decisionCount}`,
				`unverified: ${result.unverifiedCount}`,
				`lock released: ${result.lockReleased ? "yes" : "no"}`,
			].join("\n");
		case "invalid_decision_file":
			return `Cannot complete verification for session ${result.sessionId}: invalid decision file at ${result.decisionFile}: ${formatPawCliValidationIssues(result.issues)}`;
		case "missing_decision_file":
			return `Cannot complete verification for session ${result.sessionId}: decision file not found at ${result.decisionFile}.`;
		case "missing_project":
			return `Paw is not initialized at ${result.pawDir}. Run \`${APP_NAME} paw init\`.`;
		case "missing_session":
			return `No Paw session state found for ${result.sessionId} at ${result.stateFile}.`;
		case "locked":
			return `Paw session ${result.sessionId} is locked by pid ${result.lock.pid} on ${result.lock.host}.`;
		case "invalid_state":
			return `Cannot complete verification for session ${result.sessionId} from ${result.previousStateName}: ${formatPawCliValidationIssues(result.issues)}`;
		case "no_selected_slice":
			return `Cannot complete verification for session ${result.sessionId}: no selected slice in ${result.previousStateName}.`;
		case "invalid_verify_decisions":
			return `Cannot complete verification for session ${result.sessionId} from ${result.previousStateName}: ${formatPawCliValidationIssues(result.issues)}`;
		case "invalid_transition":
			return `Cannot complete verification for session ${result.sessionId} from ${result.previousStateName}: ${formatPawCliValidationIssues(result.issues)}`;
		case "not_locked":
			return result.reason === "stale"
				? `Cannot complete verification for session ${result.sessionId}: session lock is stale (${result.staleReason ?? "unknown"}).`
				: `Cannot complete verification for session ${result.sessionId}: session lock is not held by this process.`;
		case "locked_by_other":
			return `Cannot complete verification for session ${result.sessionId}: locked by pid ${result.lock.pid} on ${result.lock.host}.`;
	}
}

export async function runPawCompleteVerificationCommand(args: string[]): Promise<void> {
	const parsed = parsePawCompleteVerificationArgs(args);

	if (parsed.kind === "help") {
		printPawCompleteVerificationHelp();
		return;
	}

	if (parsed.kind === "error") {
		printPawCompleteVerificationCommandError(parsed.message);
		return;
	}

	try {
		console.log(
			formatPawCompleteVerificationCommandResult(
				await createPawCompleteVerificationCommandResult(process.cwd(), parsed.sessionId, parsed.input),
			),
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		printPawCompleteVerificationCommandError(message);
	}
}

function mapPawCompleteVerificationResult(
	sessionId: string,
	completion: PawVerificationResult,
	lockReleased: boolean,
): PawCompleteVerificationCommandResult {
	switch (completion.status) {
		case "completed":
			return {
				status: "completed",
				sessionId,
				selectedSliceId: completion.previousState.current_slice_id ?? "",
				previousStateName: completion.previousState.name,
				nextStateName: completion.nextState.name,
				decisionCount: completion.verifyDecisions.length,
				unverifiedCount: completion.unverifiedDecisions.length,
				lockReleased,
			};
		case "completed_with_unverified":
			return {
				status: "completed_with_unverified",
				sessionId,
				selectedSliceId: completion.previousState.current_slice_id ?? "",
				previousStateName: completion.previousState.name,
				nextStateName: completion.nextState.name,
				decisionCount: completion.verifyDecisions.length,
				unverifiedCount: completion.unverifiedDecisions.length,
				lockReleased,
			};
		case "invalid_state":
			return {
				status: "invalid_state",
				sessionId,
				previousStateName: completion.previousState.name,
				issues: completion.issues,
				lockReleased,
			};
		case "no_selected_slice":
			return {
				status: "no_selected_slice",
				sessionId,
				previousStateName: completion.previousState.name,
				issues: completion.issues,
				lockReleased,
			};
		case "invalid_verify_decisions":
			return {
				status: "invalid_verify_decisions",
				sessionId,
				previousStateName: completion.previousState.name,
				issues: completion.issues,
				lockReleased,
			};
		case "invalid_transition":
			return {
				status: "invalid_transition",
				sessionId,
				previousStateName: completion.previousState.name,
				issues: completion.issues,
				lockReleased,
			};
		case "not_locked":
			return mapPawNotLockedCommandFields(sessionId, completion.reason, lockReleased, completion.staleReason);
		case "locked_by_other":
			return {
				status: "locked_by_other",
				sessionId,
				lock: completion.lock,
				lockReleased,
			};
	}
}

type VerificationDecisionReadResult =
	| { kind: "missing" }
	| { kind: "invalid"; issues: readonly PawValidationIssue[] }
	| { kind: "ok"; value: PawVerifyGateDecision[] };

async function readVerificationDecisionFile(decisionFile: string): Promise<VerificationDecisionReadResult> {
	try {
		const content = await readFile(decisionFile, "utf-8");
		return parseVerificationDecisionFileContent(content);
	} catch (error) {
		if (isPawFileSystemError(error) && error.code === "ENOENT") {
			return { kind: "missing" };
		}
		throw error;
	}
}

function parseVerificationDecisionFileContent(content: string): VerificationDecisionReadResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		return {
			kind: "invalid",
			issues: [{ path: "/", message: "Decision file must contain valid JSON." }],
		};
	}

	const decisions = extractPawVerifyDecisionsFromJson(parsed);
	if (decisions === undefined) {
		return {
			kind: "invalid",
			issues: [
				{
					path: "/",
					message: "Decision file must be a verify decision array or an object with verify_decisions.",
				},
			],
		};
	}

	if (decisions.length === 0) {
		return {
			kind: "invalid",
			issues: [
				{
					path: "/verify_decisions",
					message: "Verification completion requires at least one gate decision.",
				},
			],
		};
	}

	const normalizedResult = normalizePawVerifyGateDecisionList(decisions);
	if (!normalizedResult.ok) {
		return { kind: "invalid", issues: normalizedResult.issues };
	}

	return { kind: "ok", value: normalizedResult.value };
}

function printPawCompleteVerificationHelp(): void {
	console.log(`Usage:
  ${APP_NAME} paw complete-verification <session-id> --decision-file <path>

Complete verification from VERIFYING to SLICE_DONE using verify gate decision JSON.

Options:
  --decision-file <path>  Required verify decisions JSON file (array or { verify_decisions: [...] })

Commands:
  ${APP_NAME} paw complete-verification <session-id> --decision-file <path>  Complete verification
  ${APP_NAME} paw complete-verification --help                                   Show this help
`);
}

function printPawCompleteVerificationCommandError(message: string): void {
	console.error(`Error: ${message}`);
	process.exitCode = 1;
}
