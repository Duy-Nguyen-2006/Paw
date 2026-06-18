
import { readFile, stat } from "node:fs/promises";
import { relative } from "node:path";
import { APP_NAME } from "../config.ts";
import type { PawSubAgentOutput, PawValidationIssue } from "./contracts.ts";
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
import { parsePawSubAgentOutputJson } from "./subagent.ts";

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

interface FileSystemError extends Error {
	code?: string;
}

export interface PawBlockReviewerParsedInput {
	outputFile: string;
}

export type PawBlockReviewerParsedArgs =
	| { kind: "help" }
	| { kind: "error"; message: string }
	| { kind: "ok"; sessionId: string; input: PawBlockReviewerParsedInput };

const BLOCK_REVIEWER_SCALAR_OPTIONS = new Set(["--output-file"]);

export function parsePawBlockReviewerArgs(args: string[]): PawBlockReviewerParsedArgs {
	if (args.includes("--help") || args.includes("-h")) {
		return { kind: "help" };
	}

	if (args.length === 0) {
		return { kind: "error", message: 'Missing required session id for "paw block-reviewer".' };
	}

	const sessionId = args[0];
	if (sessionId.startsWith("-")) {
		return { kind: "error", message: 'Missing required session id for "paw block-reviewer".' };
	}

	let outputFile: string | undefined;
	const seenScalarOptions = new Set<string>();

	for (let index = 1; index < args.length; ) {
		const arg = args[index];

		if (!BLOCK_REVIEWER_SCALAR_OPTIONS.has(arg)) {
			return { kind: "error", message: `Unknown option for "paw block-reviewer": ${arg}` };
		}

		const error = validateScalarOption(arg, args, index, seenScalarOptions);
		if (error) return { kind: "error", message: error };
		seenScalarOptions.add(arg);
		if (arg === "--output-file") {
			outputFile = args[index + 1];
		}
		index += 2;
	}

	if (outputFile === undefined) {
		return { kind: "error", message: 'Missing required option for "paw block-reviewer": --output-file' };
	}

	return { kind: "ok", sessionId, input: { outputFile } };
}

function validateScalarOption(arg: string, args: string[], index: number, seen: Set<string>): string | null {
	if (seen.has(arg)) {
		return `Duplicate option for "paw block-reviewer": ${arg}`;
	}
	if (index + 1 >= args.length) {
		return `Missing value for "paw block-reviewer" option: ${arg}`;
	}
	if (args[index + 1].trim().length === 0) {
		return `Option ${arg} for "paw block-reviewer" must be a non-empty string.`;
	}
	return null;
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

	const outputRead = await readReviewerOutputFile(input.outputFile);
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
			return `Cannot block reviewer for session ${result.sessionId}: invalid reviewer output at ${result.outputFile}: ${formatIssues(result.issues)}`;
		case "missing_output_file":
			return `Cannot block reviewer for session ${result.sessionId}: reviewer output file not found at ${result.outputFile}.`;
		case "missing_project":
			return `Paw is not initialized at ${result.pawDir}. Run \`${APP_NAME} paw init\`.`;
		case "missing_session":
			return `No Paw session state found for ${result.sessionId} at ${result.stateFile}.`;
		case "locked":
			return `Paw session ${result.sessionId} is locked by pid ${result.lock.pid} on ${result.lock.host}.`;
		case "invalid_state":
			return `Cannot block reviewer for session ${result.sessionId} from ${result.previousStateName}: ${formatIssues(result.issues)}`;
		case "no_selected_slice":
			return `Cannot block reviewer for session ${result.sessionId}: no selected slice in ${result.previousStateName}.`;
		case "invalid_reviewer_output":
			return `Cannot block reviewer for session ${result.sessionId}: ${formatIssues(result.issues)}`;
		case "reviewer_not_blocked":
			return `Cannot block reviewer for session ${result.sessionId}: reviewer output status is ${result.reviewerStatus}, expected blocked or needs_user_decision.`;
		case "invalid_blocked_reason":
			return `Cannot block reviewer for session ${result.sessionId}: ${formatIssues(result.issues)}`;
		case "invalid_transition":
			return `Cannot block reviewer for session ${result.sessionId} from ${result.previousStateName}: ${formatIssues(result.issues)}`;
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
			return blocked.reason === "stale"
				? {
						status: "not_locked",
						sessionId,
						reason: "stale",
						staleReason: blocked.staleReason,
						lockReleased,
					}
				: {
						status: "not_locked",
						sessionId,
						reason: "unlocked",
						lockReleased,
					};
		case "locked_by_other":
			return {
				status: "locked_by_other",
				sessionId,
				lock: blocked.lock,
				lockReleased,
			};
	}
}

type ReviewerOutputReadResult =
	| { kind: "missing" }
	| { kind: "invalid"; issues: readonly PawValidationIssue[] }
	| { kind: "ok"; value: PawSubAgentOutput };

async function readReviewerOutputFile(outputFile: string): Promise<ReviewerOutputReadResult> {
	try {
		const content = await readFile(outputFile, "utf-8");
		const parsed = parsePawSubAgentOutputJson(content);
		if (!parsed.ok) {
			return { kind: "invalid", issues: parsed.issues };
		}
		return { kind: "ok", value: parsed.value };
	} catch (error) {
		if (isFileSystemError(error) && error.code === "ENOENT") {
			return { kind: "missing" };
		}
		throw error;
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

function formatIssues(issues: readonly PawValidationIssue[]): string {
	return issues.map((issue) => `${issue.path} ${issue.message}`).join("; ");
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

function isFileSystemError(error: unknown): error is FileSystemError {
	return error instanceof Error;
}
