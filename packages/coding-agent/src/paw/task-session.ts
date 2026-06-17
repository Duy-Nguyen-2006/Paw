import { hostname } from "node:os";
import { loadDefaultPawRuntimeConfig } from "./config.ts";
import type { PawRuntimeConfig, PawValidationIssue } from "./contracts.ts";
import { initializePawProject, type PawInitResult } from "./persistence.ts";
import {
	acquirePawSessionLock,
	getPawSessionLockStatus,
	type PawSessionLock,
	type PawSessionLockOptions,
	type PawSessionLockStaleReason,
	readPawSessionState,
	resolvePawSessionPaths,
	writePawSessionState,
} from "./session-store.ts";
import {
	createInitialPawSessionState,
	type PawSessionState,
	type PawStateTransition,
	transitionPawSessionState,
} from "./state.ts";

export interface PawTaskSessionStartInput {
	repoRoot: string;
	sessionId: string;
	runtimeConfig?: PawRuntimeConfig;
	lockOptions?: PawSessionLockOptions;
}

export type PawTaskSessionStartResult =
	| PawTaskSessionStartedResult
	| PawTaskSessionExistingResult
	| PawTaskSessionLockedResult;

export interface PawTaskSessionStartedResult {
	status: "started";
	init: PawInitResult;
	lock: PawSessionLock;
	reclaimed: PawTaskSessionReclaimedLock | null;
	state: PawSessionState;
}

export interface PawTaskSessionExistingResult {
	status: "existing";
	init: PawInitResult;
	lock: PawSessionLock;
	reclaimed: PawTaskSessionReclaimedLock | null;
	state: PawSessionState;
}

export interface PawTaskSessionLockedResult {
	status: "locked";
	init: PawInitResult;
	lock: PawSessionLock;
}

export interface PawTaskSessionReclaimedLock {
	reason: PawSessionLockStaleReason;
	lock: PawSessionLock;
}

export interface PawTaskSessionAdvanceInput {
	repoRoot: string;
	sessionId: string;
	transition: PawStateTransition;
	lockOptions?: PawSessionLockOptions;
}

export type PawTaskSessionAdvanceResult =
	| PawTaskSessionAdvancedResult
	| PawTaskSessionInvalidTransitionResult
	| PawTaskSessionNotLockedResult
	| PawTaskSessionLockedByOtherResult;

export interface PawTaskSessionAdvancedResult {
	status: "advanced";
	lock: PawSessionLock;
	previousState: PawSessionState;
	nextState: PawSessionState;
}

export interface PawTaskSessionInvalidTransitionResult {
	status: "invalid_transition";
	previousState: PawSessionState;
	issues: readonly PawValidationIssue[];
}

export type PawTaskSessionNotLockedResult =
	| {
			status: "not_locked";
			reason: "unlocked";
	  }
	| {
			status: "not_locked";
			reason: "stale";
			staleReason: PawSessionLockStaleReason;
			lock: PawSessionLock;
	  };

export interface PawTaskSessionLockedByOtherResult {
	status: "locked_by_other";
	lock: PawSessionLock;
	expectedOwner: PawTaskSessionLockOwner;
}

export interface PawTaskSessionLockOwner {
	pid: number;
	host: string;
}

interface FileSystemError extends Error {
	code?: string;
}

export async function startPawTaskSession(input: PawTaskSessionStartInput): Promise<PawTaskSessionStartResult> {
	const runtimeConfig = input.runtimeConfig ?? loadDefaultPawRuntimeConfig(input.repoRoot);
	const init = await initializePawProject(input.repoRoot, runtimeConfig);
	const lockResult = await acquirePawSessionLock(input.repoRoot, input.sessionId, input.lockOptions);

	if (!lockResult.acquired) {
		return {
			status: "locked",
			init,
			lock: lockResult.lock,
		};
	}

	const existingState = await readExistingPawTaskSessionState(input.repoRoot, input.sessionId);
	if (existingState !== null) {
		return {
			status: "existing",
			init,
			lock: lockResult.lock,
			reclaimed: lockResult.reclaimed,
			state: existingState,
		};
	}

	const startedState = createStartedPawTaskSessionState(input.sessionId);
	await writePawSessionState(input.repoRoot, startedState);

	return {
		status: "started",
		init,
		lock: lockResult.lock,
		reclaimed: lockResult.reclaimed,
		state: startedState,
	};
}

export async function advancePawTaskSession(input: PawTaskSessionAdvanceInput): Promise<PawTaskSessionAdvanceResult> {
	const lockOptions = input.lockOptions ?? {};
	const lockStatus = await getPawSessionLockStatus(input.repoRoot, input.sessionId, lockOptions);
	if (lockStatus.status === "unlocked") {
		return {
			status: "not_locked",
			reason: "unlocked",
		};
	}
	if (lockStatus.status === "stale") {
		return {
			status: "not_locked",
			reason: "stale",
			staleReason: lockStatus.reason,
			lock: lockStatus.lock,
		};
	}

	const expectedOwner = getPawTaskSessionLockOwner(lockOptions);
	if (!isPawTaskSessionLockOwner(lockStatus.lock, expectedOwner)) {
		return {
			status: "locked_by_other",
			lock: lockStatus.lock,
			expectedOwner,
		};
	}

	const previousState = await readPawSessionState(input.repoRoot, input.sessionId);
	const transitioned = transitionPawSessionState(previousState, input.transition);
	if (!transitioned.ok) {
		return {
			status: "invalid_transition",
			previousState,
			issues: transitioned.issues,
		};
	}

	await writePawSessionState(input.repoRoot, transitioned.value);
	return {
		status: "advanced",
		lock: lockStatus.lock,
		previousState,
		nextState: transitioned.value,
	};
}

async function readExistingPawTaskSessionState(repoRoot: string, sessionId: string): Promise<PawSessionState | null> {
	try {
		return await readPawSessionState(repoRoot, sessionId);
	} catch (error) {
		if (isFileSystemError(error) && error.code === "ENOENT") {
			return null;
		}

		const paths = resolvePawSessionPaths(repoRoot, sessionId);
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Invalid existing Paw session state at ${paths.stateFile}: ${message}`);
	}
}

function getPawTaskSessionLockOwner(options: PawSessionLockOptions): PawTaskSessionLockOwner {
	return {
		pid: options.pid ?? process.pid,
		host: options.host ?? hostname(),
	};
}

function isPawTaskSessionLockOwner(lock: PawSessionLock, owner: PawTaskSessionLockOwner): boolean {
	return lock.pid === owner.pid && lock.host === owner.host;
}

function createStartedPawTaskSessionState(sessionId: string): PawSessionState {
	const initialState = createInitialPawSessionState(sessionId);
	const startedState = transitionPawSessionState(initialState, { to: "INTAKE" });
	if (!startedState.ok) {
		throw new Error(
			`Unable to start Paw task session ${sessionId}: ${startedState.issues
				.map((issue) => `${issue.path} ${issue.message}`)
				.join("; ")}`,
		);
	}

	return startedState.value;
}

function isFileSystemError(error: unknown): error is FileSystemError {
	return error instanceof Error;
}
