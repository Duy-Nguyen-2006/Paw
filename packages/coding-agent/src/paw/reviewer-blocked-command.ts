import { relative } from "node:path";
import { APP_NAME } from "../config.ts";
import {
	type PawCliScalarFieldBinding,
	pawCliArgsShowHelp,
	pawCliParseRequiredSessionId,
	pawCliParseScalarFieldsFromArgs,
} from "./cli-arg-parsing.ts";
import { formatPawCliValidationIssues, pawCliIsDirectory, pawCliIsFile } from "./cli-fs.ts";
import type { PawSubAgentOutput, PawValidationIssue } from "./contracts.ts";
import { mapPawNotLockedCommandFields } from "./lock-result-mapping.ts";
import { resolvePawProjectPaths } from "./persistence.ts";
import { blockPawReviewerResult, type PawReviewerBlockedResult } from "./reviewer-blocked-result.ts";
import {
	acquirePawSessionLock,
	type PawSessionLock,
	type PawSessionLockOptions,
	type PawSessionLockStaleReason,
	releasePawSessionLock,
	resolvePawSessionPaths,
} from "./session-store.ts";
import type { PawSessionStateName } from "./state.ts";
import { readPawSubAgentOutputFile } from "./subagent-output-file.ts";
export type PawBlockReviewerCommandResult =
	| PawBlockReviewerCommandBlockedResult
	| PawBlockReviewerCommandInvalidOutputFileResult
	| PawBlockReviewerCommandMissingOutputFileResult
	| PawBlockReviewerCommandMissingProjectResult
	| PawBlockReviewerCommandMissingSessionResult
	| PawBlockReviewerCommandLockedResult
	| PawBlockReviewerCommandInvalidStateResult
	| PawBlockReviewerCommandNoSelectedSliceResult
	| PawBlockReviewerCommandInvalidReviewerOutputResult
	| PawBlockReviewerCommandReviewerNotBlockedResult
	| PawBlockReviewerCommandInvalidBlockedReasonResult
	| PawBlockReviewerCommandInvalidTransitionResult
	| PawBlockReviewerCommandNotLockedResult
	| PawBlockReviewerCommandLockedByOtherResult;

export interface PawBlockReviewerCommandInput {
	lockOptions?: PawSessionLockOptions;
}

export interface PawBlockReviewerCommandBlockedResult {
	status: "blocked";
	sessionId: string;
	selectedSliceId: string;
	previousStateName: PawSessionStateName;
	nextStateName: PawSessionStateName;
	blockedReasonCode: string;
	blockedReasonMessage: string;
	lockReleased: boolean;
}

export interface PawBlockReviewerCommandInvalidOutputFileResult {
	status: "invalid_output_file";
	sessionId: string;
	outputFile: string;
	issues: readonly PawValidationIssue[];
}

export interface PawBlockReviewerCommandMissingOutputFileResult {
	status: "missing_output_file";
	sessionId: string;
	outputFile: string;
}

export interface PawBlockReviewerCommandMissingProjectResult {
	status: "missing_project";
	pawDir: string;
}

export interface PawBlockReviewerCommandMissingSessionResult {
	status: "missing_session";
	sessionId: string;
	stateFile: string;
}

export interface PawBlockReviewerCommandLockedResult {
	status: "locked";
	sessionId: string;
	lock: PawSessionLock;
}

export interface PawBlockReviewerCommandInvalidStateResult {
	status: "invalid_state";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawBlockReviewerCommandNoSelectedSliceResult {
	status: "no_selected_slice";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawBlockReviewerCommandInvalidReviewerOutputResult {
	status: "invalid_reviewer_output";
	sessionId: string;
	previousStateName: PawSessionStateName;
	reviewerOutput: PawSubAgentOutput;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawBlockReviewerCommandReviewerNotBlockedResult {
	status: "reviewer_not_blocked";
	sessionId: string;
	previousStateName: PawSessionStateName;
	reviewerStatus: PawSubAgentOutput["status"];
	lockReleased: boolean;
}

export interface PawBlockReviewerCommandInvalidBlockedReasonResult {
	status: "invalid_blocked_reason";
	sessionId: string;
	previousStateName: PawSessionStateName;
	reviewerOutput: PawSubAgentOutput;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawBlockReviewerCommandInvalidTransitionResult {
	status: "invalid_transition";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawBlockReviewerCommandNotLockedResult {
	status: "not_locked";
	sessionId: string;
	reason: "unlocked" | "stale";
	staleReason?: PawSessionLockStaleReason;
	lockReleased: boolean;
}

export interface PawBlockReviewerCommandLockedByOtherResult {
	status: "locked_by_other";
	sessionId: string;
	lock: PawSessionLock;
	lockReleased: boolean;
}

const BLOCK_REVIEWER_COMMAND_LABEL = "paw block-reviewer";

export interface PawBlockReviewerParsedInput {
	outputFile: string;
}

export type PawBlockReviewerParsedArgs =
	| { kind: "help" }
	| { kind: "error"; message: string }
	| { kind: "ok"; sessionId: string; input: PawBlockReviewerParsedInput };

const BLOCK_REVIEWER_SCALAR_OPTIONS = new Set(["--output-file"]);

export function parsePawBlockReviewerArgs(args: string[]): PawBlockReviewerParsedArgs {
	if (pawCliArgsShowHelp(args)) {
		return { kind: "help" };
	}

	const sessionIdResult = pawCliParseRequiredSessionId(args, BLOCK_REVIEWER_COMMAND_LABEL);
	if ("kind" in sessionIdResult) {
		return sessionIdResult;
	}

	let outputFile: string | undefined;
	const bindings: PawCliScalarFieldBinding[] = [
		{
			option: "--output-file",
			set: (value) => {
				outputFile = value;
			},
		},
	];
	const fields = pawCliParseScalarFieldsFromArgs(
		BLOCK_REVIEWER_COMMAND_LABEL,
		args,
		1,
		BLOCK_REVIEWER_SCALAR_OPTIONS,
		bindings,
	);
	if ("kind" in fields) {
		return fields;
	}

	if (outputFile === undefined) {
		return { kind: "error", message: `Missing required option for "${BLOCK_REVIEWER_COMMAND_LABEL}": --output-file` };
	}

	return { kind: "ok", sessionId: sessionIdResult.sessionId, input: { outputFile } };
}

export async function createPawBlockReviewerCommandResult(
	repoRoot: string,
	sessionId: string,
	input: PawBlockReviewerParsedInput,
	commandInput: PawBlockReviewerCommandInput = {},
): Promise<PawBlockReviewerCommandResult> {
	const relativeOutputFile = relative(repoRoot, input.outputFile) || input.outputFile;
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

	const outputRead = await readPawSubAgentOutputFile(input.outputFile);
	if (outputRead.kind === "missing") {
		return {
			status: "missing_output_file",
			sessionId,
			outputFile: relativeOutputFile,
		};
	}
	if (outputRead.kind === "invalid") {
		return {
			status: "invalid_output_file",
			sessionId,
			outputFile: relativeOutputFile,
			issues: outputRead.issues,
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

	const blocked = await blockPawReviewerResult({
		repoRoot,
		sessionId,
		reviewerOutput: outputRead.value,
		lockOptions: commandInput.lockOptions,
	});
	const lockReleased = await releasePawSessionLock(repoRoot, sessionId, commandInput.lockOptions);
	return mapPawBlockReviewerResult(sessionId, blocked, lockReleased);
}

export function formatPawBlockReviewerCommandResult(result: PawBlockReviewerCommandResult): string {
	switch (result.status) {
		case "blocked":
			return [
				"Paw block-reviewer",
				`session: ${result.sessionId}`,
				`status: ${result.status}`,
				`selected slice: ${result.selectedSliceId}`,
				`state: ${result.previousStateName} -> ${result.nextStateName}`,
				`blocked reason: ${result.blockedReasonCode} — ${result.blockedReasonMessage}`,
				`lock released: ${result.lockReleased ? "yes" : "no"}`,
			].join("\n");
		case "invalid_output_file":
			return `Cannot block reviewer for session ${result.sessionId}: invalid reviewer output at ${result.outputFile}: ${formatPawCliValidationIssues(result.issues)}`;
		case "missing_output_file":
			return `Cannot block reviewer for session ${result.sessionId}: reviewer output file not found at ${result.outputFile}.`;
		case "missing_project":
			return `Paw is not initialized at ${result.pawDir}. Run \`${APP_NAME} paw init\`.`;
		case "missing_session":
			return `No Paw session state found for ${result.sessionId} at ${result.stateFile}.`;
		case "locked":
			return `Paw session ${result.sessionId} is locked by pid ${result.lock.pid} on ${result.lock.host}.`;
		case "invalid_state":
			return `Cannot block reviewer for session ${result.sessionId} from ${result.previousStateName}: ${formatPawCliValidationIssues(result.issues)}`;
		case "no_selected_slice":
			return `Cannot block reviewer for session ${result.sessionId}: no selected slice in ${result.previousStateName}.`;
		case "invalid_reviewer_output":
			return `Cannot block reviewer for session ${result.sessionId}: ${formatPawCliValidationIssues(result.issues)}`;
		case "reviewer_not_blocked":
			return `Cannot block reviewer for session ${result.sessionId}: reviewer output status is ${result.reviewerStatus}, expected blocked or needs_user_decision.`;
		case "invalid_blocked_reason":
			return `Cannot block reviewer for session ${result.sessionId}: ${formatPawCliValidationIssues(result.issues)}`;
		case "invalid_transition":
			return `Cannot block reviewer for session ${result.sessionId} from ${result.previousStateName}: ${formatPawCliValidationIssues(result.issues)}`;
		case "not_locked":
			return result.reason === "stale"
				? `Cannot block reviewer for session ${result.sessionId}: session lock is stale (${result.staleReason ?? "unknown"}).`
				: `Cannot block reviewer for session ${result.sessionId}: session lock is not held by this process.`;
		case "locked_by_other":
			return `Cannot block reviewer for session ${result.sessionId}: locked by pid ${result.lock.pid} on ${result.lock.host}.`;
	}
}

export async function runPawBlockReviewerCommand(args: string[]): Promise<void> {
	const parsed = parsePawBlockReviewerArgs(args);

	if (parsed.kind === "help") {
		printPawBlockReviewerHelp();
		return;
	}

	if (parsed.kind === "error") {
		printPawBlockReviewerCommandError(parsed.message);
		return;
	}

	try {
		console.log(
			formatPawBlockReviewerCommandResult(
				await createPawBlockReviewerCommandResult(process.cwd(), parsed.sessionId, parsed.input),
			),
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		printPawBlockReviewerCommandError(message);
	}
}

function mapPawBlockReviewerResult(
	sessionId: string,
	blocked: PawReviewerBlockedResult,
	lockReleased: boolean,
): PawBlockReviewerCommandResult {
	switch (blocked.status) {
		case "blocked": {
			const reason = blocked.nextState.blocked_reason;
			return {
				status: "blocked",
				sessionId,
				selectedSliceId: blocked.previousState.current_slice_id ?? "",
				previousStateName: blocked.previousState.name,
				nextStateName: blocked.nextState.name,
				blockedReasonCode: reason?.code ?? "",
				blockedReasonMessage: reason?.message ?? "",
				lockReleased,
			};
		}
		case "invalid_state":
			return {
				status: "invalid_state",
				sessionId,
				previousStateName: blocked.previousState.name,
				issues: blocked.issues,
				lockReleased,
			};
		case "no_selected_slice":
			return {
				status: "no_selected_slice",
				sessionId,
				previousStateName: blocked.previousState.name,
				issues: blocked.issues,
				lockReleased,
			};
		case "invalid_reviewer_output":
			return {
				status: "invalid_reviewer_output",
				sessionId,
				previousStateName: blocked.previousState.name,
				reviewerOutput: blocked.reviewerOutput,
				issues: blocked.issues,
				lockReleased,
			};
		case "reviewer_not_blocked":
			return {
				status: "reviewer_not_blocked",
				sessionId,
				previousStateName: blocked.previousState.name,
				reviewerStatus: blocked.reviewerOutput.status,
				lockReleased,
			};
		case "invalid_blocked_reason":
			return {
				status: "invalid_blocked_reason",
				sessionId,
				previousStateName: blocked.previousState.name,
				reviewerOutput: blocked.reviewerOutput,
				issues: blocked.issues,
				lockReleased,
			};
		case "invalid_transition":
			return {
				status: "invalid_transition",
				sessionId,
				previousStateName: blocked.previousState.name,
				issues: blocked.issues,
				lockReleased,
			};
		case "not_locked":
			return mapPawNotLockedCommandFields(
				sessionId,
				blocked.reason,
				lockReleased,
				blocked.reason === "stale" ? blocked.staleReason : undefined,
			);
		case "locked_by_other":
			return {
				status: "locked_by_other",
				sessionId,
				lock: blocked.lock,
				lockReleased,
			};
	}
}

function printPawBlockReviewerHelp(): void {
	console.log(`Usage:
  ${APP_NAME} paw block-reviewer <session-id> --output-file <path>

Record a reviewer blocked result from REVIEWING to a BLOCKED_* state using reviewer sub-agent output JSON.

Options:
  --output-file <path>  Required reviewer sub-agent output JSON file

Commands:
  ${APP_NAME} paw block-reviewer <session-id> --output-file <path>  Block reviewer pass
  ${APP_NAME} paw block-reviewer --help                              Show this help
`);
}

function printPawBlockReviewerCommandError(message: string): void {
	console.error(`Error: ${message}`);
	process.exitCode = 1;
}
