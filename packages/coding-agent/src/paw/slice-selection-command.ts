
import { stat } from "node:fs/promises";
import { relative } from "node:path";
import { APP_NAME } from "../config.ts";
import type { PawValidationIssue } from "./contracts.ts";
import { resolvePawProjectPaths } from "./persistence.ts";
import {
	acquirePawSessionLock,
	type PawSessionLock,
	type PawSessionLockOptions,
	releasePawSessionLock,
	resolvePawSessionPaths,
} from "./session-store.ts";
import { type PawSliceSelectionResult, selectNextPawPlanSlice } from "./slice-selection.ts";
import type { PawSessionStateName } from "./state.ts";

export type PawSelectSliceCommandResult =
	| PawSelectSliceCommandAdvancedResult
	| PawSelectSliceCommandNoPendingResult
	| PawSelectSliceCommandMissingProjectResult
	| PawSelectSliceCommandMissingSessionResult
	| PawSelectSliceCommandLockedResult
	| PawSelectSliceCommandInvalidTransitionResult
	| PawSelectSliceCommandNotLockedResult
	| PawSelectSliceCommandLockedByOtherResult;

export interface PawSelectSliceCommandInput {
	lockOptions?: PawSessionLockOptions;
}

export interface PawSelectSliceCommandAdvancedResult {
	status: "advanced";
	sessionId: string;
	selectedSliceId: string;
	previousStateName: PawSessionStateName;
	nextStateName: PawSessionStateName;
	lockReleased: boolean;
}

export interface PawSelectSliceCommandNoPendingResult {
	status: "no_pending_slices";
	sessionId: string;
	previousStateName: PawSessionStateName;
	lockReleased: boolean;
}

export interface PawSelectSliceCommandMissingProjectResult {
	status: "missing_project";
	pawDir: string;
}

export interface PawSelectSliceCommandMissingSessionResult {
	status: "missing_session";
	sessionId: string;
	stateFile: string;
}

export interface PawSelectSliceCommandLockedResult {
	status: "locked";
	sessionId: string;
	lock: PawSessionLock;
}

export interface PawSelectSliceCommandInvalidTransitionResult {
	status: "invalid_transition";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawSelectSliceCommandNotLockedResult {
	status: "not_locked";
	sessionId: string;
	lockReleased: boolean;
}

export interface PawSelectSliceCommandLockedByOtherResult {
	status: "locked_by_other";
	sessionId: string;
	lock: PawSessionLock;
	lockReleased: boolean;
}

interface FileSystemError extends Error {
	code?: string;
}

export type PawSelectSliceParsedArgs =
	| { kind: "help" }
	| { kind: "error"; message: string }
	| { kind: "ok"; sessionId: string };

export function parsePawSelectSliceArgs(args: string[]): PawSelectSliceParsedArgs {
	if (args.includes("--help") || args.includes("-h")) {
		return { kind: "help" };
	}

	if (args.length === 0) {
		return { kind: "error", message: 'Missing required session id for "paw select-slice".' };
	}

	const sessionId = args[0];
	if (sessionId.startsWith("-")) {
		return { kind: "error", message: 'Missing required session id for "paw select-slice".' };
	}

	if (args.length > 1) {
		return { kind: "error", message: `Unknown option for "paw select-slice": ${args[1]}` };
	}

	return { kind: "ok", sessionId };
}

export async function createPawSelectSliceCommandResult(
	repoRoot: string,
	sessionId: string,
	input: PawSelectSliceCommandInput = {},
): Promise<PawSelectSliceCommandResult> {
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

	const selection = await selectNextPawPlanSlice({
		repoRoot,
		sessionId,
		lockOptions: input.lockOptions,
	});
	const lockReleased = await releasePawSessionLock(repoRoot, sessionId, input.lockOptions);
	return mapPawSelectSliceResult(sessionId, selection, lockReleased);
}

export function formatPawSelectSliceCommandResult(result: PawSelectSliceCommandResult): string {
	switch (result.status) {
		case "advanced":
			return [
				"Paw select-slice",
				`session: ${result.sessionId}`,
				`status: ${result.status}`,
				`selected slice: ${result.selectedSliceId}`,
				`state: ${result.previousStateName} -> ${result.nextStateName}`,
				`lock released: ${result.lockReleased ? "yes" : "no"}`,
			].join("\n");
		case "no_pending_slices":
			return [
				"Paw select-slice",
				`session: ${result.sessionId}`,
				`status: ${result.status}`,
				`state: ${result.previousStateName}`,
				`lock released: ${result.lockReleased ? "yes" : "no"}`,
			].join("\n");
		case "missing_project":
			return `Paw is not initialized at ${result.pawDir}. Run \`${APP_NAME} paw init\`.`;
		case "missing_session":
			return `No Paw session state found for ${result.sessionId} at ${result.stateFile}.`;
		case "locked":
			return `Paw session ${result.sessionId} is locked by pid ${result.lock.pid} on ${result.lock.host}.`;
		case "invalid_transition":
			return `Cannot select slice for session ${result.sessionId} from ${result.previousStateName}: ${formatIssues(result.issues)}`;
		case "not_locked":
			return `Cannot select slice for session ${result.sessionId}: session lock is not held by this process.`;
		case "locked_by_other":
			return `Cannot select slice for session ${result.sessionId}: locked by pid ${result.lock.pid} on ${result.lock.host}.`;
	}
}

export async function runPawSelectSliceCommand(args: string[]): Promise<void> {
	const parsed = parsePawSelectSliceArgs(args);

	if (parsed.kind === "help") {
		printPawSelectSliceHelp();
		return;
	}

	if (parsed.kind === "error") {
		printPawSelectSliceCommandError(parsed.message);
		return;
	}

	try {
		console.log(
			formatPawSelectSliceCommandResult(await createPawSelectSliceCommandResult(process.cwd(), parsed.sessionId)),
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		printPawSelectSliceCommandError(message);
	}
}

function mapPawSelectSliceResult(
	sessionId: string,
	selection: PawSliceSelectionResult,
	lockReleased: boolean,
): PawSelectSliceCommandResult {
	switch (selection.status) {
		case "advanced":
			return {
				status: "advanced",
				sessionId,
				selectedSliceId: selection.selectedSliceId,
				previousStateName: selection.advance.previousState.name,
				nextStateName: selection.advance.nextState.name,
				lockReleased,
			};
		case "no_pending_slices":
			return {
				status: "no_pending_slices",
				sessionId,
				previousStateName: selection.previousState.name,
				lockReleased,
			};
		case "invalid_transition":
			return {
				status: "invalid_transition",
				sessionId,
				previousStateName: selection.advance.previousState.name,
				issues: selection.advance.issues,
				lockReleased,
			};
		case "not_locked":
			return {
				status: "not_locked",
				sessionId,
				lockReleased,
			};
		case "locked_by_other":
			return {
				status: "locked_by_other",
				sessionId,
				lock: selection.advance.lock,
				lockReleased,
			};
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

function printPawSelectSliceHelp(): void {
	console.log(`Usage:
  ${APP_NAME} paw select-slice <session-id>

Select the next pending Paw plan slice under session lock from PLAN_APPROVED or SLICE_DONE.

Commands:
  ${APP_NAME} paw select-slice <session-id>  Select next pending slice
  ${APP_NAME} paw select-slice --help         Show this help
`);
}

function printPawSelectSliceCommandError(message: string): void {
	console.error(`Error: ${message}`);
	process.exitCode = 1;
}

function isFileSystemError(error: unknown): error is FileSystemError {
	return error instanceof Error;
}
