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
import { beginPawSliceImplementation, type PawSliceImplementationResult } from "./slice-implementation.ts";
import type { PawSessionStateName } from "./state.ts";

export type PawBeginImplementationCommandResult =
	| PawBeginImplementationCommandAdvancedResult
	| PawBeginImplementationCommandNoSelectedSliceResult
	| PawBeginImplementationCommandMissingProjectResult
	| PawBeginImplementationCommandMissingSessionResult
	| PawBeginImplementationCommandLockedResult
	| PawBeginImplementationCommandInvalidTransitionResult
	| PawBeginImplementationCommandNotLockedResult
	| PawBeginImplementationCommandLockedByOtherResult;

export interface PawBeginImplementationCommandInput {
	lockOptions?: PawSessionLockOptions;
}

export interface PawBeginImplementationCommandAdvancedResult {
	status: "advanced";
	sessionId: string;
	selectedSliceId: string;
	previousStateName: PawSessionStateName;
	nextStateName: PawSessionStateName;
	lockReleased: boolean;
}

export interface PawBeginImplementationCommandNoSelectedSliceResult {
	status: "no_selected_slice";
	sessionId: string;
	previousStateName: PawSessionStateName;
	lockReleased: boolean;
}

export interface PawBeginImplementationCommandMissingProjectResult {
	status: "missing_project";
	pawDir: string;
}

export interface PawBeginImplementationCommandMissingSessionResult {
	status: "missing_session";
	sessionId: string;
	stateFile: string;
}

export interface PawBeginImplementationCommandLockedResult {
	status: "locked";
	sessionId: string;
	lock: PawSessionLock;
}

export interface PawBeginImplementationCommandInvalidTransitionResult {
	status: "invalid_transition";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawBeginImplementationCommandNotLockedResult {
	status: "not_locked";
	sessionId: string;
	lockReleased: boolean;
}

export interface PawBeginImplementationCommandLockedByOtherResult {
	status: "locked_by_other";
	sessionId: string;
	lock: PawSessionLock;
	lockReleased: boolean;
}

interface FileSystemError extends Error {
	code?: string;
}

export type PawBeginImplementationParsedArgs =
	| { kind: "help" }
	| { kind: "error"; message: string }
	| { kind: "ok"; sessionId: string };

export function parsePawBeginImplementationArgs(args: string[]): PawBeginImplementationParsedArgs {
	if (args.some((arg) => arg === "--help" || arg === "-h")) {
		return { kind: "help" };
	}

	if (args.length === 0) {
		return { kind: "error", message: 'Missing required session id for "paw begin-implementation".' };
	}

	const sessionId = args[0];
	if (sessionId.startsWith("-")) {
		return { kind: "error", message: 'Missing required session id for "paw begin-implementation".' };
	}

	if (args.length > 1) {
		return { kind: "error", message: `Unknown option for "paw begin-implementation": ${args[1]}` };
	}

	return { kind: "ok", sessionId };
}

export async function createPawBeginImplementationCommandResult(
	repoRoot: string,
	sessionId: string,
	input: PawBeginImplementationCommandInput = {},
): Promise<PawBeginImplementationCommandResult> {
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

	const implementation = await beginPawSliceImplementation({
		repoRoot,
		sessionId,
		lockOptions: input.lockOptions,
	});
	const lockReleased = await releasePawSessionLock(repoRoot, sessionId, input.lockOptions);
	return mapPawBeginImplementationResult(sessionId, implementation, lockReleased);
}

export function formatPawBeginImplementationCommandResult(result: PawBeginImplementationCommandResult): string {
	switch (result.status) {
		case "advanced":
			return [
				"Paw begin-implementation",
				`session: ${result.sessionId}`,
				`status: ${result.status}`,
				`selected slice: ${result.selectedSliceId}`,
				`state: ${result.previousStateName} -> ${result.nextStateName}`,
				`lock released: ${result.lockReleased ? "yes" : "no"}`,
			].join("\n");
		case "no_selected_slice":
			return [
				"Paw begin-implementation",
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
			return `Cannot begin implementation for session ${result.sessionId} from ${result.previousStateName}: ${formatIssues(result.issues)}`;
		case "not_locked":
			return `Cannot begin implementation for session ${result.sessionId}: session lock is not held by this process.`;
		case "locked_by_other":
			return `Cannot begin implementation for session ${result.sessionId}: locked by pid ${result.lock.pid} on ${result.lock.host}.`;
	}
}

export async function runPawBeginImplementationCommand(args: string[]): Promise<void> {
	const parsed = parsePawBeginImplementationArgs(args);

	if (parsed.kind === "help") {
		printPawBeginImplementationHelp();
		return;
	}

	if (parsed.kind === "error") {
		printPawBeginImplementationCommandError(parsed.message);
		return;
	}

	try {
		console.log(
			formatPawBeginImplementationCommandResult(
				await createPawBeginImplementationCommandResult(process.cwd(), parsed.sessionId),
			),
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		printPawBeginImplementationCommandError(message);
	}
}

function mapPawBeginImplementationResult(
	sessionId: string,
	implementation: PawSliceImplementationResult,
	lockReleased: boolean,
): PawBeginImplementationCommandResult {
	switch (implementation.status) {
		case "advanced":
			return {
				status: "advanced",
				sessionId,
				selectedSliceId: implementation.selectedSliceId,
				previousStateName: implementation.advance.previousState.name,
				nextStateName: implementation.advance.nextState.name,
				lockReleased,
			};
		case "no_selected_slice":
			return {
				status: "no_selected_slice",
				sessionId,
				previousStateName: implementation.previousState.name,
				lockReleased,
			};
		case "invalid_transition":
			return {
				status: "invalid_transition",
				sessionId,
				previousStateName: implementation.advance.previousState.name,
				issues: implementation.advance.issues,
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
				lock: implementation.advance.lock,
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

function printPawBeginImplementationHelp(): void {
	console.log(`Usage:
  ${APP_NAME} paw begin-implementation <session-id>

Begin implementing the selected Paw slice under session lock from SLICE_SELECT.

Commands:
  ${APP_NAME} paw begin-implementation <session-id>  Begin slice implementation
  ${APP_NAME} paw begin-implementation --help         Show this help
`);
}

function printPawBeginImplementationCommandError(message: string): void {
	console.error(`Error: ${message}`);
	process.exitCode = 1;
}

function isFileSystemError(error: unknown): error is FileSystemError {
	return error instanceof Error;
}
