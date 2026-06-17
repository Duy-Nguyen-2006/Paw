import { hostname } from "node:os";
import {
	createPawCheckpointName,
	type PawCheckpointChangedFile,
	type PawCheckpointMetadata,
	type PawCheckpointPaths,
	type PawCheckpointRestorableFile,
	writePawCheckpointMetadata,
} from "./checkpoints.ts";
import {
	getPawSessionLockStatus,
	type PawSessionLock,
	type PawSessionLockOptions,
	type PawSessionLockStaleReason,
	readPawSessionState,
} from "./session-store.ts";
import type { PawSessionState } from "./state.ts";

export interface PawSliceCheckpointInput {
	repoRoot: string;
	sessionId: string;
	baseTree: string;
	changedFiles: readonly PawCheckpointChangedFile[];
	restoreFiles?: readonly PawCheckpointRestorableFile[];
	shortId: string;
	timestamp: Date | string;
	notes?: string;
	lockOptions?: PawSessionLockOptions;
}

export type PawSliceCheckpointResult =
	| PawSliceCheckpointPreparedResult
	| PawSliceCheckpointNotLockedResult
	| PawSliceCheckpointLockedByOtherResult
	| PawSliceCheckpointInvalidStateResult
	| PawSliceCheckpointNoSelectedSliceResult;

export interface PawSliceCheckpointPreparedResult {
	status: "prepared";
	metadata: PawCheckpointMetadata;
	paths: PawCheckpointPaths;
	state: PawSessionState;
	lock: PawSessionLock;
}

export type PawSliceCheckpointNotLockedResult =
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

export interface PawSliceCheckpointLockedByOtherResult {
	status: "locked_by_other";
	lock: PawSessionLock;
	expectedOwner: PawSliceCheckpointLockOwner;
}

export interface PawSliceCheckpointInvalidStateResult {
	status: "invalid_state";
	expectedState: "SLICE_SELECT";
	state: PawSessionState;
	lock: PawSessionLock;
}

export interface PawSliceCheckpointNoSelectedSliceResult {
	status: "no_selected_slice";
	state: PawSessionState;
	lock: PawSessionLock;
}

export interface PawSliceCheckpointLockOwner {
	pid: number;
	host: string;
}

export async function preparePawSliceCheckpoint(input: PawSliceCheckpointInput): Promise<PawSliceCheckpointResult> {
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

	const expectedOwner = getPawSliceCheckpointLockOwner(lockOptions);
	if (!isPawSliceCheckpointLockOwner(lockStatus.lock, expectedOwner)) {
		return {
			status: "locked_by_other",
			lock: lockStatus.lock,
			expectedOwner,
		};
	}

	const state = await readPawSessionState(input.repoRoot, input.sessionId);
	if (state.name !== "SLICE_SELECT") {
		return {
			status: "invalid_state",
			expectedState: "SLICE_SELECT",
			state,
			lock: lockStatus.lock,
		};
	}
	if (state.current_slice_id === null) {
		return {
			status: "no_selected_slice",
			state,
			lock: lockStatus.lock,
		};
	}

	const metadata: PawCheckpointMetadata = {
		session_id: input.sessionId,
		checkpoint_name: createPawCheckpointName({
			timestamp: input.timestamp,
			sliceId: state.current_slice_id,
			shortId: input.shortId,
		}),
		scope: "slice",
		slice_id: state.current_slice_id,
		created_at: toCheckpointCreatedAt(input.timestamp),
		base_tree: input.baseTree,
		changed_files: input.changedFiles.map((file) => ({ ...file })),
	};
	if (input.restoreFiles !== undefined) {
		metadata.restore_files = input.restoreFiles.map((file) => ({ ...file }));
	}
	if (input.notes !== undefined) {
		metadata.notes = input.notes;
	}

	const paths = await writePawCheckpointMetadata(input.repoRoot, metadata);
	return {
		status: "prepared",
		metadata,
		paths,
		state,
		lock: lockStatus.lock,
	};
}

function getPawSliceCheckpointLockOwner(options: PawSessionLockOptions): PawSliceCheckpointLockOwner {
	return {
		pid: options.pid ?? process.pid,
		host: options.host ?? hostname(),
	};
}

function isPawSliceCheckpointLockOwner(lock: PawSessionLock, owner: PawSliceCheckpointLockOwner): boolean {
	return lock.pid === owner.pid && lock.host === owner.host;
}

function toCheckpointCreatedAt(timestamp: Date | string): string {
	const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
	return date.toISOString();
}
