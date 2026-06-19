import { stat } from "node:fs/promises";
import { relative } from "node:path";
import { APP_NAME } from "../config.ts";
import type { PawCheckpointChangedFile } from "./checkpoints.ts";
import { resolvePawProjectPaths } from "./persistence.ts";
import {
	acquirePawSessionLock,
	type PawSessionLock,
	type PawSessionLockOptions,
	releasePawSessionLock,
	resolvePawSessionPaths,
} from "./session-store.ts";
import { type PawSliceCheckpointResult, preparePawSliceCheckpoint } from "./slice-checkpoint.ts";
import type { PawSessionStateName } from "./state.ts";

export type PawPrepareCheckpointCommandResult =
	| PawPrepareCheckpointCommandPreparedResult
	| PawPrepareCheckpointCommandMissingProjectResult
	| PawPrepareCheckpointCommandMissingSessionResult
	| PawPrepareCheckpointCommandLockedResult
	| PawPrepareCheckpointCommandInvalidStateResult
	| PawPrepareCheckpointCommandNoSelectedSliceResult
	| PawPrepareCheckpointCommandNotLockedResult
	| PawPrepareCheckpointCommandLockedByOtherResult;

export interface PawPrepareCheckpointCommandInput {
	lockOptions?: PawSessionLockOptions;
}

export interface PawPrepareCheckpointCommandPreparedResult {
	status: "prepared";
	sessionId: string;
	checkpointName: string;
	selectedSliceId: string;
	metadataPath: string;
	stateName: PawSessionStateName;
	changedFileCount: number;
	lockReleased: boolean;
}

export interface PawPrepareCheckpointCommandMissingProjectResult {
	status: "missing_project";
	pawDir: string;
}

export interface PawPrepareCheckpointCommandMissingSessionResult {
	status: "missing_session";
	sessionId: string;
	stateFile: string;
}

export interface PawPrepareCheckpointCommandLockedResult {
	status: "locked";
	sessionId: string;
	lock: PawSessionLock;
}

export interface PawPrepareCheckpointCommandInvalidStateResult {
	status: "invalid_state";
	sessionId: string;
	expectedState: "SLICE_SELECT";
	stateName: PawSessionStateName;
	lockReleased: boolean;
}

export interface PawPrepareCheckpointCommandNoSelectedSliceResult {
	status: "no_selected_slice";
	sessionId: string;
	stateName: PawSessionStateName;
	lockReleased: boolean;
}

export interface PawPrepareCheckpointCommandNotLockedResult {
	status: "not_locked";
	sessionId: string;
	reason: "unlocked" | "stale";
	staleReason?: string;
	lockReleased: boolean;
}

export interface PawPrepareCheckpointCommandLockedByOtherResult {
	status: "locked_by_other";
	sessionId: string;
	lock: PawSessionLock;
	lockReleased: boolean;
}

interface FileSystemError extends Error {
	code?: string;
}

export interface PawPrepareCheckpointParsedInput {
	baseTree: string;
	shortId: string;
	timestamp: string;
	changedFiles: PawCheckpointChangedFile[];
	notes?: string;
}

export type PawPrepareCheckpointParsedArgs =
	| { kind: "help" }
	| { kind: "error"; message: string }
	| { kind: "ok"; sessionId: string; input: PawPrepareCheckpointParsedInput };

const PREPARE_CHECKPOINT_SCALAR_OPTIONS = new Set(["--base-tree", "--short-id", "--timestamp", "--notes"]);
const PREPARE_CHECKPOINT_COMMAND_LABEL = "paw prepare-checkpoint";

interface PawPrepareCheckpointArgParseState {
	baseTree: string | undefined;
	shortId: string | undefined;
	timestamp: string | undefined;
	notes: string | undefined;
	changedFiles: PawCheckpointChangedFile[];
	seenScalarOptions: Set<string>;
}

export function parsePawPrepareCheckpointArgs(args: string[]): PawPrepareCheckpointParsedArgs {
	if (args.some((arg) => arg === "--help" || arg === "-h")) {
		return { kind: "help" };
	}

	const sessionIdResult = readPawPrepareCheckpointSessionId(args);
	if ("kind" in sessionIdResult) {
		return sessionIdResult;
	}

	const state = createEmptyPawPrepareCheckpointArgParseState();
	const optionParseResult = parsePawPrepareCheckpointOptionArgs(args, 1, state);
	if (optionParseResult.kind === "error") {
		return optionParseResult;
	}

	return finalizePawPrepareCheckpointParsedArgs(sessionIdResult.sessionId, state);
}

function createEmptyPawPrepareCheckpointArgParseState(): PawPrepareCheckpointArgParseState {
	return {
		baseTree: undefined,
		shortId: undefined,
		timestamp: undefined,
		notes: undefined,
		changedFiles: [],
		seenScalarOptions: new Set<string>(),
	};
}

function parsePawPrepareCheckpointOptionArgs(
	args: string[],
	startIndex: number,
	state: PawPrepareCheckpointArgParseState,
): { kind: "ok" } | PawPrepareCheckpointParsedArgs {
	for (let index = startIndex; index < args.length; ) {
		const arg = args[index];
		const nextIndex = parsePawPrepareCheckpointRemainingArg(arg, args, index, state);
		if (typeof nextIndex !== "number") {
			return nextIndex;
		}
		index = nextIndex;
	}
	return { kind: "ok" };
}

export async function createPawPrepareCheckpointCommandResult(
	repoRoot: string,
	sessionId: string,
	input: PawPrepareCheckpointParsedInput,
	commandInput: PawPrepareCheckpointCommandInput = {},
): Promise<PawPrepareCheckpointCommandResult> {
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

	const lockResult = await acquirePawSessionLock(repoRoot, sessionId, commandInput.lockOptions);
	if (!lockResult.acquired) {
		return {
			status: "locked",
			sessionId,
			lock: lockResult.lock,
		};
	}

	const preparation = await preparePawSliceCheckpoint({
		repoRoot,
		sessionId,
		baseTree: input.baseTree,
		changedFiles: input.changedFiles,
		captureRestoreFiles: true,
		shortId: input.shortId,
		timestamp: input.timestamp,
		notes: input.notes,
		lockOptions: commandInput.lockOptions,
	});
	const lockReleased = await releasePawSessionLock(repoRoot, sessionId, commandInput.lockOptions);
	return mapPawPrepareCheckpointResult(repoRoot, sessionId, preparation, lockReleased);
}

export function formatPawPrepareCheckpointCommandResult(result: PawPrepareCheckpointCommandResult): string {
	switch (result.status) {
		case "prepared":
			return [
				"Paw prepare-checkpoint",
				`session: ${result.sessionId}`,
				`status: ${result.status}`,
				`checkpoint: ${result.checkpointName}`,
				`selected slice: ${result.selectedSliceId}`,
				`metadata: ${result.metadataPath}`,
				`state: ${result.stateName}`,
				`changed files: ${result.changedFileCount}`,
				`lock released: ${result.lockReleased ? "yes" : "no"}`,
			].join("\n");
		case "missing_project":
			return `Paw is not initialized at ${result.pawDir}. Run \`${APP_NAME} paw init\`.`;
		case "missing_session":
			return `No Paw session state found for ${result.sessionId} at ${result.stateFile}.`;
		case "locked":
			return `Paw session ${result.sessionId} is locked by pid ${result.lock.pid} on ${result.lock.host}.`;
		case "invalid_state":
			return `Cannot prepare checkpoint for session ${result.sessionId}: expected state ${result.expectedState}, got ${result.stateName}.`;
		case "no_selected_slice":
			return `Cannot prepare checkpoint for session ${result.sessionId}: no selected slice in ${result.stateName}.`;
		case "not_locked":
			if (result.reason === "stale") {
				const detail = result.staleReason !== undefined ? ` (${result.staleReason})` : "";
				return `Cannot prepare checkpoint for session ${result.sessionId}: session lock is stale${detail}.`;
			}
			return `Cannot prepare checkpoint for session ${result.sessionId}: session lock is not held by this process.`;
		case "locked_by_other":
			return `Cannot prepare checkpoint for session ${result.sessionId}: locked by pid ${result.lock.pid} on ${result.lock.host}.`;
	}
}

export async function runPawPrepareCheckpointCommand(args: string[]): Promise<void> {
	const parsed = parsePawPrepareCheckpointArgs(args);

	if (parsed.kind === "help") {
		printPawPrepareCheckpointHelp();
		return;
	}

	if (parsed.kind === "error") {
		printPawPrepareCheckpointCommandError(parsed.message);
		return;
	}

	try {
		console.log(
			formatPawPrepareCheckpointCommandResult(
				await createPawPrepareCheckpointCommandResult(process.cwd(), parsed.sessionId, parsed.input),
			),
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		printPawPrepareCheckpointCommandError(message);
	}
}

function mapPawPrepareCheckpointResult(
	repoRoot: string,
	sessionId: string,
	preparation: PawSliceCheckpointResult,
	lockReleased: boolean,
): PawPrepareCheckpointCommandResult {
	switch (preparation.status) {
		case "prepared": {
			const metadataPath = relative(repoRoot, preparation.paths.metadataFile) || preparation.paths.metadataFile;
			return {
				status: "prepared",
				sessionId,
				checkpointName: preparation.metadata.checkpoint_name,
				selectedSliceId: preparation.metadata.slice_id ?? "",
				metadataPath,
				stateName: preparation.state.name,
				changedFileCount: preparation.metadata.changed_files.length,
				lockReleased,
			};
		}
		case "invalid_state":
			return {
				status: "invalid_state",
				sessionId,
				expectedState: preparation.expectedState,
				stateName: preparation.state.name,
				lockReleased,
			};
		case "no_selected_slice":
			return {
				status: "no_selected_slice",
				sessionId,
				stateName: preparation.state.name,
				lockReleased,
			};
		case "not_locked":
			if (preparation.reason === "stale") {
				return {
					status: "not_locked",
					sessionId,
					reason: "stale",
					staleReason: preparation.staleReason,
					lockReleased,
				};
			}
			return {
				status: "not_locked",
				sessionId,
				reason: "unlocked",
				lockReleased,
			};
		case "locked_by_other":
			return {
				status: "locked_by_other",
				sessionId,
				lock: preparation.lock,
				lockReleased,
			};
	}
}

function readPawPrepareCheckpointSessionId(args: string[]): PawPrepareCheckpointParsedArgs | { sessionId: string } {
	if (args.length === 0) {
		return { kind: "error", message: `Missing required session id for "${PREPARE_CHECKPOINT_COMMAND_LABEL}".` };
	}

	const sessionId = args[0];
	if (sessionId.startsWith("-")) {
		return { kind: "error", message: `Missing required session id for "${PREPARE_CHECKPOINT_COMMAND_LABEL}".` };
	}

	return { sessionId };
}

function parsePawPrepareCheckpointRemainingArg(
	arg: string,
	args: string[],
	index: number,
	state: PawPrepareCheckpointArgParseState,
): PawPrepareCheckpointParsedArgs | number {
	if (arg === "--changed-file") {
		return parsePawPrepareCheckpointChangedFileOption(args, index, state);
	}

	if (PREPARE_CHECKPOINT_SCALAR_OPTIONS.has(arg)) {
		return parsePawPrepareCheckpointScalarOption(arg, args, index, state);
	}

	if (arg.startsWith("-")) {
		return { kind: "error", message: `Unknown option for "${PREPARE_CHECKPOINT_COMMAND_LABEL}": ${arg}` };
	}

	return { kind: "error", message: `Unknown option for "${PREPARE_CHECKPOINT_COMMAND_LABEL}": ${arg}` };
}

function parsePawPrepareCheckpointChangedFileOption(
	args: string[],
	index: number,
	state: PawPrepareCheckpointArgParseState,
): PawPrepareCheckpointParsedArgs | number {
	if (index + 1 >= args.length) {
		return {
			kind: "error",
			message: `Missing value for "${PREPARE_CHECKPOINT_COMMAND_LABEL}" option: --changed-file`,
		};
	}

	const value = args[index + 1];
	const changedFileResult = parsePawPrepareCheckpointChangedFileValue(value);
	if ("kind" in changedFileResult) {
		return changedFileResult;
	}

	state.changedFiles.push(changedFileResult);
	return index + 2;
}

function parsePawPrepareCheckpointChangedFileValue(
	value: string,
): PawPrepareCheckpointParsedArgs | PawCheckpointChangedFile {
	if (value.trim().length === 0) {
		return {
			kind: "error",
			message: `Option --changed-file for "${PREPARE_CHECKPOINT_COMMAND_LABEL}" must be a non-empty string.`,
		};
	}

	const equalsIndex = value.indexOf("=");
	if (equalsIndex === -1) {
		return {
			kind: "error",
			message: `Option --changed-file for "${PREPARE_CHECKPOINT_COMMAND_LABEL}" must use <path>=<hash|null>.`,
		};
	}

	const path = value.slice(0, equalsIndex).trim();
	const hashPart = value.slice(equalsIndex + 1);
	if (path.length === 0) {
		return {
			kind: "error",
			message: `Option --changed-file for "${PREPARE_CHECKPOINT_COMMAND_LABEL}" must include a non-empty path.`,
		};
	}
	if (hashPart.length === 0) {
		return {
			kind: "error",
			message: `Option --changed-file for "${PREPARE_CHECKPOINT_COMMAND_LABEL}" must include a hash or null.`,
		};
	}

	const contentHash = hashPart === "null" ? null : hashPart;
	if (contentHash !== null && contentHash.trim().length === 0) {
		return {
			kind: "error",
			message: `Option --changed-file for "${PREPARE_CHECKPOINT_COMMAND_LABEL}" must include a non-empty hash or null.`,
		};
	}

	return { path, content_hash: contentHash };
}

function parsePawPrepareCheckpointScalarOption(
	arg: string,
	args: string[],
	index: number,
	state: PawPrepareCheckpointArgParseState,
): PawPrepareCheckpointParsedArgs | number {
	if (state.seenScalarOptions.has(arg)) {
		return { kind: "error", message: `Duplicate option for "${PREPARE_CHECKPOINT_COMMAND_LABEL}": ${arg}` };
	}
	state.seenScalarOptions.add(arg);
	if (index + 1 >= args.length) {
		return { kind: "error", message: `Missing value for "${PREPARE_CHECKPOINT_COMMAND_LABEL}" option: ${arg}` };
	}

	const value = args[index + 1];
	if (value.trim().length === 0) {
		return {
			kind: "error",
			message: `Option ${arg} for "${PREPARE_CHECKPOINT_COMMAND_LABEL}" must be a non-empty string.`,
		};
	}

	if (arg === "--base-tree") {
		state.baseTree = value;
	} else if (arg === "--short-id") {
		state.shortId = value;
	} else if (arg === "--timestamp") {
		state.timestamp = value;
	} else if (arg === "--notes") {
		state.notes = value;
	}

	return index + 2;
}

function finalizePawPrepareCheckpointParsedArgs(
	sessionId: string,
	state: PawPrepareCheckpointArgParseState,
): PawPrepareCheckpointParsedArgs {
	const requiredError = validatePawPrepareCheckpointRequiredOptions(state);
	if (requiredError !== undefined) {
		return { kind: "error", message: requiredError };
	}

	const timestampError = validatePawPrepareCheckpointTimestamp(state.timestamp as string);
	if (timestampError !== undefined) {
		return { kind: "error", message: timestampError };
	}
	if (state.changedFiles.length === 0) {
		return {
			kind: "error",
			message: `Missing required option for "${PREPARE_CHECKPOINT_COMMAND_LABEL}": --changed-file`,
		};
	}

	return { kind: "ok", sessionId, input: buildPawPrepareCheckpointParsedInput(state) };
}

function validatePawPrepareCheckpointRequiredOptions(state: PawPrepareCheckpointArgParseState): string | undefined {
	const requiredScalars: Array<{ value: string | undefined; option: string }> = [
		{ value: state.baseTree, option: "--base-tree" },
		{ value: state.shortId, option: "--short-id" },
		{ value: state.timestamp, option: "--timestamp" },
	];
	for (const { value, option } of requiredScalars) {
		if (value === undefined) {
			return `Missing required option for "${PREPARE_CHECKPOINT_COMMAND_LABEL}": ${option}`;
		}
	}
	return undefined;
}

function buildPawPrepareCheckpointParsedInput(
	state: PawPrepareCheckpointArgParseState,
): PawPrepareCheckpointParsedInput {
	const input: PawPrepareCheckpointParsedInput = {
		baseTree: state.baseTree as string,
		shortId: state.shortId as string,
		timestamp: state.timestamp as string,
		changedFiles: state.changedFiles,
	};
	if (state.notes !== undefined) {
		input.notes = state.notes;
	}
	return input;
}

function validatePawPrepareCheckpointTimestamp(timestamp: string): string | undefined {
	const date = new Date(timestamp);
	if (Number.isNaN(date.getTime())) {
		return `Invalid timestamp for "paw prepare-checkpoint": ${timestamp}`;
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

function printPawPrepareCheckpointHelp(): void {
	console.log(`Usage:
  ${APP_NAME} paw prepare-checkpoint <session-id> --base-tree <tree> --short-id <id> --timestamp <iso> --changed-file <path>=<hash|null> [--notes <text>]

Prepare selected-slice checkpoint metadata under session lock from SLICE_SELECT.

Options:
  --base-tree <tree>                 Required base tree reference
  --short-id <id>                    Required checkpoint short id
  --timestamp <iso>                  Required ISO-8601 timestamp
  --changed-file <path>=<hash|null>  Changed file entry (repeatable, order preserved)
  --notes <text>                     Optional checkpoint notes

Commands:
  ${APP_NAME} paw prepare-checkpoint <session-id> ...  Prepare slice checkpoint metadata
  ${APP_NAME} paw prepare-checkpoint --help             Show this help
`);
}

function printPawPrepareCheckpointCommandError(message: string): void {
	console.error(`Error: ${message}`);
	process.exitCode = 1;
}

function isFileSystemError(error: unknown): error is FileSystemError {
	return error instanceof Error;
}
