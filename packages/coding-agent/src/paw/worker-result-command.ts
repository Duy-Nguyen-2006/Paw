import { readFile, stat } from "node:fs/promises";
import { relative } from "node:path";
import { APP_NAME } from "../config.ts";
import type { PawRuntimeConfig, PawSubAgentOutput, PawValidationIssue } from "./contracts.ts";
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
import { completePawWorkerPass, type PawWorkerPassResult } from "./worker-result.ts";

export type PawCompleteWorkerCommandResult =
	| PawCompleteWorkerCommandCompletedResult
	| PawCompleteWorkerCommandInvalidOutputFileResult
	| PawCompleteWorkerCommandMissingOutputFileResult
	| PawCompleteWorkerCommandMissingProjectResult
	| PawCompleteWorkerCommandMissingSessionResult
	| PawCompleteWorkerCommandLockedResult
	| PawCompleteWorkerCommandInvalidStateResult
	| PawCompleteWorkerCommandNoSelectedSliceResult
	| PawCompleteWorkerCommandInvalidWorkerOutputResult
	| PawCompleteWorkerCommandWorkerNotPassedResult
	| PawCompleteWorkerCommandInvalidTransitionResult
	| PawCompleteWorkerCommandNotLockedResult
	| PawCompleteWorkerCommandLockedByOtherResult;

export interface PawCompleteWorkerCommandInput {
	config?: PawRuntimeConfig;
	lockOptions?: PawSessionLockOptions;
}

export interface PawCompleteWorkerCommandCompletedResult {
	status: "completed";
	sessionId: string;
	selectedSliceId: string;
	previousStateName: PawSessionStateName;
	nextStateName: PawSessionStateName;
	journalEntryCount: number;
	lockReleased: boolean;
}

export interface PawCompleteWorkerCommandInvalidOutputFileResult {
	status: "invalid_output_file";
	sessionId: string;
	outputFile: string;
	issues: readonly PawValidationIssue[];
}

export interface PawCompleteWorkerCommandMissingOutputFileResult {
	status: "missing_output_file";
	sessionId: string;
	outputFile: string;
}

export interface PawCompleteWorkerCommandMissingProjectResult {
	status: "missing_project";
	pawDir: string;
}

export interface PawCompleteWorkerCommandMissingSessionResult {
	status: "missing_session";
	sessionId: string;
	stateFile: string;
}

export interface PawCompleteWorkerCommandLockedResult {
	status: "locked";
	sessionId: string;
	lock: PawSessionLock;
}

export interface PawCompleteWorkerCommandInvalidStateResult {
	status: "invalid_state";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawCompleteWorkerCommandNoSelectedSliceResult {
	status: "no_selected_slice";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawCompleteWorkerCommandInvalidWorkerOutputResult {
	status: "invalid_worker_output";
	sessionId: string;
	previousStateName: PawSessionStateName;
	workerOutput: PawSubAgentOutput;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawCompleteWorkerCommandWorkerNotPassedResult {
	status: "worker_not_passed";
	sessionId: string;
	previousStateName: PawSessionStateName;
	workerStatus: PawSubAgentOutput["status"];
	lockReleased: boolean;
}

export interface PawCompleteWorkerCommandInvalidTransitionResult {
	status: "invalid_transition";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawCompleteWorkerCommandNotLockedResult {
	status: "not_locked";
	sessionId: string;
	reason: "unlocked" | "stale";
	staleReason?: PawSessionLockStaleReason;
	lockReleased: boolean;
}

export interface PawCompleteWorkerCommandLockedByOtherResult {
	status: "locked_by_other";
	sessionId: string;
	lock: PawSessionLock;
	lockReleased: boolean;
}

interface FileSystemError extends Error {
	code?: string;
}

export interface PawCompleteWorkerParsedInput {
	outputFile: string;
	timestamp?: string;
}

export type PawCompleteWorkerParsedArgs =
	| { kind: "help" }
	| { kind: "error"; message: string }
	| { kind: "ok"; sessionId: string; input: PawCompleteWorkerParsedInput };

const COMPLETE_WORKER_SCALAR_OPTIONS = new Set(["--output-file", "--timestamp"]);

export function parsePawCompleteWorkerArgs(args: string[]): PawCompleteWorkerParsedArgs {
	if (args.some((arg) => arg === "--help" || arg === "-h")) {
		return { kind: "help" };
	}

	if (args.length === 0) {
		return { kind: "error", message: 'Missing required session id for "paw complete-worker".' };
	}

	const sessionId = args[0];
	if (sessionId.startsWith("-")) {
		return { kind: "error", message: 'Missing required session id for "paw complete-worker".' };
	}

	let outputFile: string | undefined;
	let timestamp: string | undefined;
	const seenScalarOptions = new Set<string>();

	for (let index = 1; index < args.length; ) {
		const arg = args[index];

		if (COMPLETE_WORKER_SCALAR_OPTIONS.has(arg)) {
			if (seenScalarOptions.has(arg)) {
				return { kind: "error", message: `Duplicate option for "paw complete-worker": ${arg}` };
			}
			seenScalarOptions.add(arg);
			if (index + 1 >= args.length) {
				return { kind: "error", message: `Missing value for "paw complete-worker" option: ${arg}` };
			}
			const value = args[index + 1];
			if (value.trim().length === 0) {
				return {
					kind: "error",
					message: `Option ${arg} for "paw complete-worker" must be a non-empty string.`,
				};
			}
			if (arg === "--output-file") {
				outputFile = value;
			} else if (arg === "--timestamp") {
				timestamp = value;
			}
			index += 2;
			continue;
		}

		if (arg.startsWith("-")) {
			return { kind: "error", message: `Unknown option for "paw complete-worker": ${arg}` };
		}

		return { kind: "error", message: `Unknown option for "paw complete-worker": ${arg}` };
	}

	if (outputFile === undefined) {
		return { kind: "error", message: 'Missing required option for "paw complete-worker": --output-file' };
	}

	if (timestamp !== undefined) {
		const timestampError = validatePawCompleteWorkerTimestamp(timestamp);
		if (timestampError !== undefined) {
			return { kind: "error", message: timestampError };
		}
	}

	const input: PawCompleteWorkerParsedInput = { outputFile };
	if (timestamp !== undefined) {
		input.timestamp = timestamp;
	}

	return { kind: "ok", sessionId, input };
}

export async function createPawCompleteWorkerCommandResult(
	repoRoot: string,
	sessionId: string,
	input: PawCompleteWorkerParsedInput,
	commandInput: PawCompleteWorkerCommandInput = {},
): Promise<PawCompleteWorkerCommandResult> {
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

	const completion = await completePawWorkerPass({
		repoRoot,
		sessionId,
		workerOutput: outputRead.value,
		config: commandInput.config,
		lockOptions: commandInput.lockOptions,
		timestamp: input.timestamp,
	});
	const lockReleased = await releasePawSessionLock(repoRoot, sessionId, commandInput.lockOptions);
	return mapPawCompleteWorkerResult(sessionId, completion, lockReleased);
}

export function formatPawCompleteWorkerCommandResult(result: PawCompleteWorkerCommandResult): string {
	switch (result.status) {
		case "completed":
			return [
				"Paw complete-worker",
				`session: ${result.sessionId}`,
				`status: ${result.status}`,
				`selected slice: ${result.selectedSliceId}`,
				`state: ${result.previousStateName} -> ${result.nextStateName}`,
				`journal entries: ${result.journalEntryCount}`,
				`lock released: ${result.lockReleased ? "yes" : "no"}`,
			].join("\n");
		case "invalid_output_file":
			return `Cannot complete worker pass for session ${result.sessionId}: invalid worker output at ${result.outputFile}: ${formatIssues(result.issues)}`;
		case "missing_output_file":
			return `Cannot complete worker pass for session ${result.sessionId}: worker output file not found at ${result.outputFile}.`;
		case "missing_project":
			return `Paw is not initialized at ${result.pawDir}. Run \`${APP_NAME} paw init\`.`;
		case "missing_session":
			return `No Paw session state found for ${result.sessionId} at ${result.stateFile}.`;
		case "locked":
			return `Paw session ${result.sessionId} is locked by pid ${result.lock.pid} on ${result.lock.host}.`;
		case "invalid_state":
			return `Cannot complete worker pass for session ${result.sessionId} from ${result.previousStateName}: ${formatIssues(result.issues)}`;
		case "no_selected_slice":
			return `Cannot complete worker pass for session ${result.sessionId}: no selected slice in ${result.previousStateName}.`;
		case "invalid_worker_output":
			return `Cannot complete worker pass for session ${result.sessionId}: ${formatIssues(result.issues)}`;
		case "worker_not_passed":
			return `Cannot complete worker pass for session ${result.sessionId}: worker output status is ${result.workerStatus}, expected pass.`;
		case "invalid_transition":
			return `Cannot complete worker pass for session ${result.sessionId} from ${result.previousStateName}: ${formatIssues(result.issues)}`;
		case "not_locked":
			return result.reason === "stale"
				? `Cannot complete worker pass for session ${result.sessionId}: session lock is stale (${result.staleReason ?? "unknown"}).`
				: `Cannot complete worker pass for session ${result.sessionId}: session lock is not held by this process.`;
		case "locked_by_other":
			return `Cannot complete worker pass for session ${result.sessionId}: locked by pid ${result.lock.pid} on ${result.lock.host}.`;
	}
}

export async function runPawCompleteWorkerCommand(args: string[]): Promise<void> {
	const parsed = parsePawCompleteWorkerArgs(args);

	if (parsed.kind === "help") {
		printPawCompleteWorkerHelp();
		return;
	}

	if (parsed.kind === "error") {
		printPawCompleteWorkerCommandError(parsed.message);
		return;
	}

	try {
		console.log(
			formatPawCompleteWorkerCommandResult(
				await createPawCompleteWorkerCommandResult(process.cwd(), parsed.sessionId, parsed.input),
			),
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		printPawCompleteWorkerCommandError(message);
	}
}

function mapPawCompleteWorkerResult(
	sessionId: string,
	completion: PawWorkerPassResult,
	lockReleased: boolean,
): PawCompleteWorkerCommandResult {
	switch (completion.status) {
		case "completed":
			return {
				status: "completed",
				sessionId,
				selectedSliceId: completion.previousState.current_slice_id ?? "",
				previousStateName: completion.previousState.name,
				nextStateName: completion.nextState.name,
				journalEntryCount: completion.journalEntries.length,
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
		case "invalid_worker_output":
			return {
				status: "invalid_worker_output",
				sessionId,
				previousStateName: completion.previousState.name,
				workerOutput: completion.workerOutput,
				issues: completion.issues,
				lockReleased,
			};
		case "worker_not_passed":
			return {
				status: "worker_not_passed",
				sessionId,
				previousStateName: completion.previousState.name,
				workerStatus: completion.workerOutput.status,
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

function validatePawCompleteWorkerTimestamp(timestamp: string): string | undefined {
	const date = new Date(timestamp);
	if (Number.isNaN(date.getTime())) {
		return `Invalid timestamp for "paw complete-worker": ${timestamp}`;
	}
	return undefined;
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

function printPawCompleteWorkerHelp(): void {
	console.log(`Usage:
  ${APP_NAME} paw complete-worker <session-id> --output-file <path> [--timestamp <iso>]

Complete a worker pass from IMPLEMENTING to REVIEWING using worker sub-agent output JSON.

Options:
  --output-file <path>  Required worker sub-agent output JSON file
  --timestamp <iso>     Optional ISO-8601 timestamp for journal entries

Commands:
  ${APP_NAME} paw complete-worker <session-id> --output-file <path>  Complete worker pass
  ${APP_NAME} paw complete-worker --help                              Show this help
`);
}

function printPawCompleteWorkerCommandError(message: string): void {
	console.error(`Error: ${message}`);
	process.exitCode = 1;
}

function isFileSystemError(error: unknown): error is FileSystemError {
	return error instanceof Error;
}
