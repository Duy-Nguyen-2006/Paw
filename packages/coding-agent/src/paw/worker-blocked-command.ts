import { readFile, stat } from "node:fs/promises";
import { relative } from "node:path";
import { APP_NAME } from "../config.ts";
import type { PawSubAgentOutput, PawValidationIssue } from "./contracts.ts";
import { resolvePawProjectPaths } from "./persistence.ts";
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
import { blockPawWorkerResult, type PawWorkerBlockedResult } from "./worker-blocked-result.ts";

export type PawBlockWorkerCommandResult =
	| PawBlockWorkerCommandBlockedResult
	| PawBlockWorkerCommandInvalidOutputFileResult
	| PawBlockWorkerCommandMissingOutputFileResult
	| PawBlockWorkerCommandMissingProjectResult
	| PawBlockWorkerCommandMissingSessionResult
	| PawBlockWorkerCommandLockedResult
	| PawBlockWorkerCommandInvalidStateResult
	| PawBlockWorkerCommandNoSelectedSliceResult
	| PawBlockWorkerCommandInvalidWorkerOutputResult
	| PawBlockWorkerCommandWorkerNotBlockedResult
	| PawBlockWorkerCommandInvalidBlockedReasonResult
	| PawBlockWorkerCommandInvalidTransitionResult
	| PawBlockWorkerCommandNotLockedResult
	| PawBlockWorkerCommandLockedByOtherResult;

export interface PawBlockWorkerCommandInput {
	lockOptions?: PawSessionLockOptions;
}

export interface PawBlockWorkerCommandBlockedResult {
	status: "blocked";
	sessionId: string;
	selectedSliceId: string;
	previousStateName: PawSessionStateName;
	nextStateName: PawSessionStateName;
	blockedReasonCode: string;
	blockedReasonMessage: string;
	lockReleased: boolean;
}

export interface PawBlockWorkerCommandInvalidOutputFileResult {
	status: "invalid_output_file";
	sessionId: string;
	outputFile: string;
	issues: readonly PawValidationIssue[];
}

export interface PawBlockWorkerCommandMissingOutputFileResult {
	status: "missing_output_file";
	sessionId: string;
	outputFile: string;
}

export interface PawBlockWorkerCommandMissingProjectResult {
	status: "missing_project";
	pawDir: string;
}

export interface PawBlockWorkerCommandMissingSessionResult {
	status: "missing_session";
	sessionId: string;
	stateFile: string;
}

export interface PawBlockWorkerCommandLockedResult {
	status: "locked";
	sessionId: string;
	lock: PawSessionLock;
}

export interface PawBlockWorkerCommandInvalidStateResult {
	status: "invalid_state";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawBlockWorkerCommandNoSelectedSliceResult {
	status: "no_selected_slice";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawBlockWorkerCommandInvalidWorkerOutputResult {
	status: "invalid_worker_output";
	sessionId: string;
	previousStateName: PawSessionStateName;
	workerOutput: PawSubAgentOutput;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawBlockWorkerCommandWorkerNotBlockedResult {
	status: "worker_not_blocked";
	sessionId: string;
	previousStateName: PawSessionStateName;
	workerStatus: PawSubAgentOutput["status"];
	lockReleased: boolean;
}

export interface PawBlockWorkerCommandInvalidBlockedReasonResult {
	status: "invalid_blocked_reason";
	sessionId: string;
	previousStateName: PawSessionStateName;
	workerOutput: PawSubAgentOutput;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawBlockWorkerCommandInvalidTransitionResult {
	status: "invalid_transition";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawBlockWorkerCommandNotLockedResult {
	status: "not_locked";
	sessionId: string;
	reason: "unlocked" | "stale";
	staleReason?: PawSessionLockStaleReason;
	lockReleased: boolean;
}

export interface PawBlockWorkerCommandLockedByOtherResult {
	status: "locked_by_other";
	sessionId: string;
	lock: PawSessionLock;
	lockReleased: boolean;
}

interface FileSystemError extends Error {
	code?: string;
}

export interface PawBlockWorkerParsedInput {
	outputFile: string;
}

export type PawBlockWorkerParsedArgs =
	| { kind: "help" }
	| { kind: "error"; message: string }
	| { kind: "ok"; sessionId: string; input: PawBlockWorkerParsedInput };

const BLOCK_WORKER_COMMAND_LABEL = "paw block-worker";

export function parsePawBlockWorkerArgs(args: string[]): PawBlockWorkerParsedArgs {
	if (args.some((arg) => arg === "--help" || arg === "-h")) {
		return { kind: "help" };
	}

	const sessionIdResult = readPawBlockWorkerSessionId(args);
	if ("kind" in sessionIdResult) {
		return sessionIdResult;
	}

	const outputFileResult = parsePawBlockWorkerOutputFile(args);
	if ("kind" in outputFileResult) {
		return outputFileResult;
	}

	return { kind: "ok", sessionId: sessionIdResult.sessionId, input: { outputFile: outputFileResult.outputFile } };
}

export async function createPawBlockWorkerCommandResult(
	repoRoot: string,
	sessionId: string,
	input: PawBlockWorkerParsedInput,
	commandInput: PawBlockWorkerCommandInput = {},
): Promise<PawBlockWorkerCommandResult> {
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

	const outputRead = await readWorkerOutputFile(input.outputFile);
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

	const blocked = await blockPawWorkerResult({
		repoRoot,
		sessionId,
		workerOutput: outputRead.value,
		lockOptions: commandInput.lockOptions,
	});
	const lockReleased = await releasePawSessionLock(repoRoot, sessionId, commandInput.lockOptions);
	return mapPawBlockWorkerResult(sessionId, blocked, lockReleased);
}

export function formatPawBlockWorkerCommandResult(result: PawBlockWorkerCommandResult): string {
	switch (result.status) {
		case "blocked":
			return [
				"Paw block-worker",
				`session: ${result.sessionId}`,
				`status: ${result.status}`,
				`selected slice: ${result.selectedSliceId}`,
				`state: ${result.previousStateName} -> ${result.nextStateName}`,
				`blocked reason: ${result.blockedReasonCode} — ${result.blockedReasonMessage}`,
				`lock released: ${result.lockReleased ? "yes" : "no"}`,
			].join("\n");
		case "invalid_output_file":
			return `Cannot block worker for session ${result.sessionId}: invalid worker output at ${result.outputFile}: ${formatIssues(result.issues)}`;
		case "missing_output_file":
			return `Cannot block worker for session ${result.sessionId}: worker output file not found at ${result.outputFile}.`;
		case "missing_project":
			return `Paw is not initialized at ${result.pawDir}. Run \`${APP_NAME} paw init\`.`;
		case "missing_session":
			return `No Paw session state found for ${result.sessionId} at ${result.stateFile}.`;
		case "locked":
			return `Paw session ${result.sessionId} is locked by pid ${result.lock.pid} on ${result.lock.host}.`;
		case "invalid_state":
			return `Cannot block worker for session ${result.sessionId} from ${result.previousStateName}: ${formatIssues(result.issues)}`;
		case "no_selected_slice":
			return `Cannot block worker for session ${result.sessionId}: no selected slice in ${result.previousStateName}.`;
		case "invalid_worker_output":
			return `Cannot block worker for session ${result.sessionId}: ${formatIssues(result.issues)}`;
		case "worker_not_blocked":
			return `Cannot block worker for session ${result.sessionId}: worker output status is ${result.workerStatus}, expected blocked or needs_user_decision.`;
		case "invalid_blocked_reason":
			return `Cannot block worker for session ${result.sessionId}: ${formatIssues(result.issues)}`;
		case "invalid_transition":
			return `Cannot block worker for session ${result.sessionId} from ${result.previousStateName}: ${formatIssues(result.issues)}`;
		case "not_locked":
			return result.reason === "stale"
				? `Cannot block worker for session ${result.sessionId}: session lock is stale (${result.staleReason ?? "unknown"}).`
				: `Cannot block worker for session ${result.sessionId}: session lock is not held by this process.`;
		case "locked_by_other":
			return `Cannot block worker for session ${result.sessionId}: locked by pid ${result.lock.pid} on ${result.lock.host}.`;
	}
}

export async function runPawBlockWorkerCommand(args: string[]): Promise<void> {
	const parsed = parsePawBlockWorkerArgs(args);

	if (parsed.kind === "help") {
		printPawBlockWorkerHelp();
		return;
	}

	if (parsed.kind === "error") {
		printPawBlockWorkerCommandError(parsed.message);
		return;
	}

	try {
		console.log(
			formatPawBlockWorkerCommandResult(
				await createPawBlockWorkerCommandResult(process.cwd(), parsed.sessionId, parsed.input),
			),
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		printPawBlockWorkerCommandError(message);
	}
}

function mapPawBlockWorkerResult(
	sessionId: string,
	blocked: PawWorkerBlockedResult,
	lockReleased: boolean,
): PawBlockWorkerCommandResult {
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
		case "invalid_worker_output":
			return {
				status: "invalid_worker_output",
				sessionId,
				previousStateName: blocked.previousState.name,
				workerOutput: blocked.workerOutput,
				issues: blocked.issues,
				lockReleased,
			};
		case "worker_not_blocked":
			return {
				status: "worker_not_blocked",
				sessionId,
				previousStateName: blocked.previousState.name,
				workerStatus: blocked.workerOutput.status,
				lockReleased,
			};
		case "invalid_blocked_reason":
			return {
				status: "invalid_blocked_reason",
				sessionId,
				previousStateName: blocked.previousState.name,
				workerOutput: blocked.workerOutput,
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

type WorkerOutputReadResult =
	| { kind: "missing" }
	| { kind: "invalid"; issues: readonly PawValidationIssue[] }
	| { kind: "ok"; value: PawSubAgentOutput };

async function readWorkerOutputFile(outputFile: string): Promise<WorkerOutputReadResult> {
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

function printPawBlockWorkerHelp(): void {
	console.log(`Usage:
  ${APP_NAME} paw block-worker <session-id> --output-file <path>

Record a worker blocked result from IMPLEMENTING to a BLOCKED_* state using worker sub-agent output JSON.

Options:
  --output-file <path>  Required worker sub-agent output JSON file

Commands:
  ${APP_NAME} paw block-worker <session-id> --output-file <path>  Block worker pass
  ${APP_NAME} paw block-worker --help                              Show this help
`);
}

function printPawBlockWorkerCommandError(message: string): void {
	console.error(`Error: ${message}`);
	process.exitCode = 1;
}

function readPawBlockWorkerSessionId(args: string[]): PawBlockWorkerParsedArgs | { sessionId: string } {
	if (args.length === 0) {
		return { kind: "error", message: `Missing required session id for "${BLOCK_WORKER_COMMAND_LABEL}".` };
	}

	const sessionId = args[0];
	if (sessionId.startsWith("-")) {
		return { kind: "error", message: `Missing required session id for "${BLOCK_WORKER_COMMAND_LABEL}".` };
	}

	return { sessionId };
}

function parsePawBlockWorkerOutputFile(args: string[]): PawBlockWorkerParsedArgs | { outputFile: string } {
	let outputFile: string | undefined;
	const seenScalarOptions = new Set<string>();

	for (let index = 1; index < args.length; ) {
		const arg = args[index];
		if (arg === "--output-file") {
			const scalarResult = readPawBlockWorkerScalarOption(arg, args, index, seenScalarOptions);
			if ("kind" in scalarResult) {
				return scalarResult;
			}
			outputFile = scalarResult.value;
			index = scalarResult.nextIndex;
			continue;
		}

		if (arg.startsWith("-")) {
			return { kind: "error", message: `Unknown option for "${BLOCK_WORKER_COMMAND_LABEL}": ${arg}` };
		}

		return { kind: "error", message: `Unknown option for "${BLOCK_WORKER_COMMAND_LABEL}": ${arg}` };
	}

	if (outputFile === undefined) {
		return { kind: "error", message: `Missing required option for "${BLOCK_WORKER_COMMAND_LABEL}": --output-file` };
	}

	return { outputFile };
}

function readPawBlockWorkerScalarOption(
	optionName: string,
	args: string[],
	index: number,
	seenScalarOptions: Set<string>,
): PawBlockWorkerParsedArgs | { value: string; nextIndex: number } {
	if (seenScalarOptions.has(optionName)) {
		return { kind: "error", message: `Duplicate option for "${BLOCK_WORKER_COMMAND_LABEL}": ${optionName}` };
	}
	seenScalarOptions.add(optionName);
	if (index + 1 >= args.length) {
		return { kind: "error", message: `Missing value for "${BLOCK_WORKER_COMMAND_LABEL}" option: ${optionName}` };
	}

	const value = args[index + 1];
	if (value.trim().length === 0) {
		return {
			kind: "error",
			message: `Option ${optionName} for "${BLOCK_WORKER_COMMAND_LABEL}" must be a non-empty string.`,
		};
	}

	return { value, nextIndex: index + 2 };
}

function isFileSystemError(error: unknown): error is FileSystemError {
	return error instanceof Error;
}
