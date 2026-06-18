
import { readFile, stat } from "node:fs/promises";
import { relative } from "node:path";
import { APP_NAME } from "../config.ts";
import type { PawSubAgentOutput, PawValidationIssue } from "./contracts.ts";
import { resolvePawProjectPaths } from "./persistence.ts";
import { completePawReviewerPass, type PawReviewerPassResult } from "./reviewer-result.ts";
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

export type PawCompleteReviewerCommandResult =
	| PawCompleteReviewerCommandCompletedResult
	| PawCompleteReviewerCommandInvalidOutputFileResult
	| PawCompleteReviewerCommandMissingOutputFileResult
	| PawCompleteReviewerCommandMissingProjectResult
	| PawCompleteReviewerCommandMissingSessionResult
	| PawCompleteReviewerCommandLockedResult
	| PawCompleteReviewerCommandInvalidStateResult
	| PawCompleteReviewerCommandNoSelectedSliceResult
	| PawCompleteReviewerCommandInvalidReviewerOutputResult
	| PawCompleteReviewerCommandReviewerNotPassedResult
	| PawCompleteReviewerCommandInvalidTransitionResult
	| PawCompleteReviewerCommandNotLockedResult
	| PawCompleteReviewerCommandLockedByOtherResult;

export interface PawCompleteReviewerCommandInput {
	lockOptions?: PawSessionLockOptions;
}

export interface PawCompleteReviewerCommandCompletedResult {
	status: "completed";
	sessionId: string;
	selectedSliceId: string;
	previousStateName: PawSessionStateName;
	nextStateName: PawSessionStateName;
	lockReleased: boolean;
}

export interface PawCompleteReviewerCommandInvalidOutputFileResult {
	status: "invalid_output_file";
	sessionId: string;
	outputFile: string;
	issues: readonly PawValidationIssue[];
}

export interface PawCompleteReviewerCommandMissingOutputFileResult {
	status: "missing_output_file";
	sessionId: string;
	outputFile: string;
}

export interface PawCompleteReviewerCommandMissingProjectResult {
	status: "missing_project";
	pawDir: string;
}

export interface PawCompleteReviewerCommandMissingSessionResult {
	status: "missing_session";
	sessionId: string;
	stateFile: string;
}

export interface PawCompleteReviewerCommandLockedResult {
	status: "locked";
	sessionId: string;
	lock: PawSessionLock;
}

export interface PawCompleteReviewerCommandInvalidStateResult {
	status: "invalid_state";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawCompleteReviewerCommandNoSelectedSliceResult {
	status: "no_selected_slice";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawCompleteReviewerCommandInvalidReviewerOutputResult {
	status: "invalid_reviewer_output";
	sessionId: string;
	previousStateName: PawSessionStateName;
	reviewerOutput: PawSubAgentOutput;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawCompleteReviewerCommandReviewerNotPassedResult {
	status: "reviewer_not_passed";
	sessionId: string;
	previousStateName: PawSessionStateName;
	reviewerStatus: PawSubAgentOutput["status"];
	lockReleased: boolean;
}

export interface PawCompleteReviewerCommandInvalidTransitionResult {
	status: "invalid_transition";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawCompleteReviewerCommandNotLockedResult {
	status: "not_locked";
	sessionId: string;
	reason: "unlocked" | "stale";
	staleReason?: PawSessionLockStaleReason;
	lockReleased: boolean;
}

export interface PawCompleteReviewerCommandLockedByOtherResult {
	status: "locked_by_other";
	sessionId: string;
	lock: PawSessionLock;
	lockReleased: boolean;
}

interface FileSystemError extends Error {
	code?: string;
}

export interface PawCompleteReviewerParsedInput {
	outputFile: string;
}

export type PawCompleteReviewerParsedArgs =
	| { kind: "help" }
	| { kind: "error"; message: string }
	| { kind: "ok"; sessionId: string; input: PawCompleteReviewerParsedInput };

const COMPLETE_REVIEWER_SCALAR_OPTIONS = new Set(["--output-file"]);

export function parsePawCompleteReviewerArgs(args: string[]): PawCompleteReviewerParsedArgs {
	if (args.includes("--help") || args.includes("-h")) {
		return { kind: "help" };
	}

	if (args.length === 0) {
		return { kind: "error", message: 'Missing required session id for "paw complete-reviewer".' };
	}

	const sessionId = args[0];
	if (sessionId.startsWith("-")) {
		return { kind: "error", message: 'Missing required session id for "paw complete-reviewer".' };
	}

	let outputFile: string | undefined;
	const seenScalarOptions = new Set<string>();

	for (let index = 1; index < args.length; ) {
		const arg = args[index];

		if (COMPLETE_REVIEWER_SCALAR_OPTIONS.has(arg)) {
			if (seenScalarOptions.has(arg)) {
				return { kind: "error", message: `Duplicate option for "paw complete-reviewer": ${arg}` };
			}
			seenScalarOptions.add(arg);
			if (index + 1 >= args.length) {
				return { kind: "error", message: `Missing value for "paw complete-reviewer" option: ${arg}` };
			}
			const value = args[index + 1];
			if (value.trim().length === 0) {
				return {
					kind: "error",
					message: `Option ${arg} for "paw complete-reviewer" must be a non-empty string.`,
				};
			}
			if (arg === "--output-file") {
				outputFile = value;
			}
			index += 2;
			continue;
		}

		if (arg.startsWith("-")) {
			return { kind: "error", message: `Unknown option for "paw complete-reviewer": ${arg}` };
		}

		return { kind: "error", message: `Unknown option for "paw complete-reviewer": ${arg}` };
	}

	if (outputFile === undefined) {
		return { kind: "error", message: 'Missing required option for "paw complete-reviewer": --output-file' };
	}

	return { kind: "ok", sessionId, input: { outputFile } };
}

export async function createPawCompleteReviewerCommandResult(
	repoRoot: string,
	sessionId: string,
	input: PawCompleteReviewerParsedInput,
	commandInput: PawCompleteReviewerCommandInput = {},
): Promise<PawCompleteReviewerCommandResult> {
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

	const completion = await completePawReviewerPass({
		repoRoot,
		sessionId,
		reviewerOutput: outputRead.value,
		lockOptions: commandInput.lockOptions,
	});
	const lockReleased = await releasePawSessionLock(repoRoot, sessionId, commandInput.lockOptions);
	return mapPawCompleteReviewerResult(sessionId, completion, lockReleased);
}

export function formatPawCompleteReviewerCommandResult(result: PawCompleteReviewerCommandResult): string {
	switch (result.status) {
		case "completed":
			return [
				"Paw complete-reviewer",
				`session: ${result.sessionId}`,
				`status: ${result.status}`,
				`selected slice: ${result.selectedSliceId}`,
				`state: ${result.previousStateName} -> ${result.nextStateName}`,
				`lock released: ${result.lockReleased ? "yes" : "no"}`,
			].join("\n");
		case "invalid_output_file":
			return `Cannot complete reviewer pass for session ${result.sessionId}: invalid reviewer output at ${result.outputFile}: ${formatIssues(result.issues)}`;
		case "missing_output_file":
			return `Cannot complete reviewer pass for session ${result.sessionId}: reviewer output file not found at ${result.outputFile}.`;
		case "missing_project":
			return `Paw is not initialized at ${result.pawDir}. Run \`${APP_NAME} paw init\`.`;
		case "missing_session":
			return `No Paw session state found for ${result.sessionId} at ${result.stateFile}.`;
		case "locked":
			return `Paw session ${result.sessionId} is locked by pid ${result.lock.pid} on ${result.lock.host}.`;
		case "invalid_state":
			return `Cannot complete reviewer pass for session ${result.sessionId} from ${result.previousStateName}: ${formatIssues(result.issues)}`;
		case "no_selected_slice":
			return `Cannot complete reviewer pass for session ${result.sessionId}: no selected slice in ${result.previousStateName}.`;
		case "invalid_reviewer_output":
			return `Cannot complete reviewer pass for session ${result.sessionId}: ${formatIssues(result.issues)}`;
		case "reviewer_not_passed":
			return `Cannot complete reviewer pass for session ${result.sessionId}: reviewer output status is ${result.reviewerStatus}, expected pass.`;
		case "invalid_transition":
			return `Cannot complete reviewer pass for session ${result.sessionId} from ${result.previousStateName}: ${formatIssues(result.issues)}`;
		case "not_locked":
			return result.reason === "stale"
				? `Cannot complete reviewer pass for session ${result.sessionId}: session lock is stale (${result.staleReason ?? "unknown"}).`
				: `Cannot complete reviewer pass for session ${result.sessionId}: session lock is not held by this process.`;
		case "locked_by_other":
			return `Cannot complete reviewer pass for session ${result.sessionId}: locked by pid ${result.lock.pid} on ${result.lock.host}.`;
	}
}

export async function runPawCompleteReviewerCommand(args: string[]): Promise<void> {
	const parsed = parsePawCompleteReviewerArgs(args);

	if (parsed.kind === "help") {
		printPawCompleteReviewerHelp();
		return;
	}

	if (parsed.kind === "error") {
		printPawCompleteReviewerCommandError(parsed.message);
		return;
	}

	try {
		console.log(
			formatPawCompleteReviewerCommandResult(
				await createPawCompleteReviewerCommandResult(process.cwd(), parsed.sessionId, parsed.input),
			),
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		printPawCompleteReviewerCommandError(message);
	}
}

function mapPawCompleteReviewerResult(
	sessionId: string,
	completion: PawReviewerPassResult,
	lockReleased: boolean,
): PawCompleteReviewerCommandResult {
	switch (completion.status) {
		case "completed":
			return {
				status: "completed",
				sessionId,
				selectedSliceId: completion.previousState.current_slice_id ?? "",
				previousStateName: completion.previousState.name,
				nextStateName: completion.nextState.name,
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
		case "invalid_reviewer_output":
			return {
				status: "invalid_reviewer_output",
				sessionId,
				previousStateName: completion.previousState.name,
				reviewerOutput: completion.reviewerOutput,
				issues: completion.issues,
				lockReleased,
			};
		case "reviewer_not_passed":
			return {
				status: "reviewer_not_passed",
				sessionId,
				previousStateName: completion.previousState.name,
				reviewerStatus: completion.reviewerOutput.status,
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
			return completion.reason === "stale"
				? {
						status: "not_locked",
						sessionId,
						reason: "stale",
						staleReason: completion.staleReason,
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
				lock: completion.lock,
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

function printPawCompleteReviewerHelp(): void {
	console.log(`Usage:
  ${APP_NAME} paw complete-reviewer <session-id> --output-file <path>

Complete a reviewer pass from REVIEWING to VERIFYING using reviewer sub-agent output JSON.

Options:
  --output-file <path>  Required reviewer sub-agent output JSON file

Commands:
  ${APP_NAME} paw complete-reviewer <session-id> --output-file <path>  Complete reviewer pass
  ${APP_NAME} paw complete-reviewer --help                                   Show this help
`);
}

function printPawCompleteReviewerCommandError(message: string): void {
	console.error(`Error: ${message}`);
	process.exitCode = 1;
}

function isFileSystemError(error: unknown): error is FileSystemError {
	return error instanceof Error;
}
