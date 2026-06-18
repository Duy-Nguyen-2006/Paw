import { stat } from "node:fs/promises";
import { relative } from "node:path";
import { APP_NAME } from "../config.ts";
import { resolvePawProjectPaths } from "./persistence.ts";
import {
	acquirePawSessionLock,
	type PawSessionLock,
	type PawSessionLockOptions,
	type PawSessionLockStaleReason,
	readPawSessionState,
	releasePawSessionLock,
	resolvePawSessionPaths,
} from "./session-store.ts";
import type { PawSessionStateName } from "./state.ts";

export type PawResumeCommandResult =
	| PawResumeCommandReadyResult
	| PawResumeCommandMissingProjectResult
	| PawResumeCommandMissingSessionResult
	| PawResumeCommandInvalidSessionResult
	| PawResumeCommandLockedResult;

export interface PawResumeCommandInput {
	lockOptions?: PawSessionLockOptions;
}

export interface PawResumeCommandReadyResult {
	status: "ready";
	sessionId: string;
	stateName: PawSessionStateName;
	currentSliceId: string | null;
	pendingSliceCount: number;
	completedSliceCount: number;
	reclaimed: PawResumeCommandReclaimedLock | null;
	lockReleased: boolean;
}

export interface PawResumeCommandReclaimedLock {
	reason: PawSessionLockStaleReason;
	lock: PawSessionLock;
}

export interface PawResumeCommandMissingProjectResult {
	status: "missing_project";
	pawDir: string;
}

export interface PawResumeCommandMissingSessionResult {
	status: "missing_session";
	sessionId: string;
	stateFile: string;
}

export interface PawResumeCommandInvalidSessionResult {
	status: "invalid_session";
	sessionId: string;
	stateFile: string;
	errorSummary: string;
}

export interface PawResumeCommandLockedResult {
	status: "locked";
	sessionId: string;
	lock: PawSessionLock;
}

interface FileSystemError extends Error {
	code?: string;
}

export async function createPawResumeCommandResult(
	repoRoot: string,
	sessionId: string,
	input: PawResumeCommandInput = {},
): Promise<PawResumeCommandResult> {
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

	try {
		const state = await readPawSessionState(repoRoot, sessionId);
		const lockReleased = await releasePawSessionLock(repoRoot, sessionId, input.lockOptions);
		return {
			status: "ready",
			sessionId,
			stateName: state.name,
			currentSliceId: state.current_slice_id,
			pendingSliceCount: state.pending_slice_ids.length,
			completedSliceCount: state.completed_slice_ids.length,
			reclaimed: lockResult.reclaimed,
			lockReleased,
		};
	} catch (error) {
		await releasePawSessionLock(repoRoot, sessionId, input.lockOptions);
		return {
			status: "invalid_session",
			sessionId,
			stateFile: relativeStateFile,
			errorSummary: error instanceof Error ? error.message : String(error),
		};
	}
}

export function formatPawResumeCommandResult(result: PawResumeCommandResult): string {
	switch (result.status) {
		case "ready":
			return [
				"Paw resume",
				`session: ${result.sessionId}`,
				`state: ${result.stateName}`,
				`current slice: ${result.currentSliceId ?? "none"}`,
				`pending slices: ${result.pendingSliceCount}`,
				`completed slices: ${result.completedSliceCount}`,
				`reclaimed lock: ${formatReclaimedLock(result.reclaimed)}`,
				`lock released: ${result.lockReleased ? "yes" : "no"}`,
				`next action: resume orchestrator from ${result.stateName}`,
			].join("\n");
		case "missing_project":
			return `Paw is not initialized at ${result.pawDir}. Run \`${APP_NAME} paw init\`.`;
		case "missing_session":
			return `No Paw session state found for ${result.sessionId} at ${result.stateFile}.`;
		case "invalid_session":
			return `Invalid Paw session state for ${result.sessionId} at ${result.stateFile}: ${result.errorSummary}`;
		case "locked":
			return `Paw session ${result.sessionId} is locked by pid ${result.lock.pid} on ${result.lock.host}.`;
	}
}

export async function runPawResumeCommand(args: string[]): Promise<void> {
	if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
		printPawResumeHelp();
		return;
	}

	if (args.length === 0) {
		printPawResumeCommandError('Missing required session id for "paw resume".');
		return;
	}

	if (args.length > 1) {
		printPawResumeCommandError(`Unknown option for "paw resume": ${args[1]}`);
		return;
	}

	try {
		console.log(formatPawResumeCommandResult(await createPawResumeCommandResult(process.cwd(), args[0])));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		printPawResumeCommandError(message);
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

function formatReclaimedLock(reclaimed: PawResumeCommandReclaimedLock | null): string {
	if (reclaimed === null) {
		return "no";
	}
	return `${reclaimed.reason} from pid ${reclaimed.lock.pid} on ${reclaimed.lock.host}`;
}

function printPawResumeHelp(): void {
	console.log(`Usage:
  ${APP_NAME} paw resume <session-id>

Inspect and lock-check a resumable Paw session without running the full orchestrator.

Commands:
  ${APP_NAME} paw resume <session-id> Show resume state and lock status
  ${APP_NAME} paw resume --help       Show this help
`);
}

function printPawResumeCommandError(message: string): void {
	console.error(`Error: ${message}`);
	process.exitCode = 1;
}

function isFileSystemError(error: unknown): error is FileSystemError {
	return error instanceof Error;
}
