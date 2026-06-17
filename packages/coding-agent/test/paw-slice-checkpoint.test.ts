import { mkdtemp, rm, stat } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
	type PawCheckpointChangedFile,
	type PawSessionLock,
	type PawSessionState,
	preparePawSliceCheckpoint,
	readPawCheckpointMetadata,
	resolvePawCheckpointPaths,
	resolvePawSessionPaths,
	writePawJsonAtomic,
	writePawSessionState,
} from "../src/paw/index.ts";

const tempRoots: string[] = [];
const timestamp = new Date("2026-06-16T03:04:05.678Z");
const changedFiles: PawCheckpointChangedFile[] = [
	{
		path: "src/example.ts",
		content_hash: "sha256:abc123",
	},
	{
		path: "src/deleted.ts",
		content_hash: null,
	},
];

async function createTempRepo(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-slice-checkpoint-"));
	tempRoots.push(root);
	return root;
}

function createSelectedSliceState(sessionId: string, sliceId = "slice-1"): PawSessionState {
	return {
		session_id: sessionId,
		name: "SLICE_SELECT",
		current_slice_id: sliceId,
		pending_slice_ids: [`${sliceId}-next`],
		completed_slice_ids: [],
		blocked_reason: null,
	};
}

async function writeLock(repoRoot: string, sessionId: string, lock: PawSessionLock): Promise<void> {
	await writePawJsonAtomic(resolvePawSessionPaths(repoRoot, sessionId).lockFile, lock);
}

async function writeCurrentLock(repoRoot: string, sessionId: string, nowMs: number): Promise<PawSessionLock> {
	const lock: PawSessionLock = {
		pid: process.pid,
		host: hostname(),
		heartbeat_ts: nowMs,
		ttl: 120,
	};
	await writeLock(repoRoot, sessionId, lock);
	return lock;
}

async function expectNoMetadata(repoRoot: string, sessionId: string, checkpointName: string): Promise<void> {
	const paths = resolvePawCheckpointPaths(repoRoot, sessionId, checkpointName);
	await expect(stat(paths.metadataFile)).rejects.toMatchObject({ code: "ENOENT" });
}

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("preparePawSliceCheckpoint", () => {
	test("writes checkpoint metadata for the selected slice under the current lock", async () => {
		const repoRoot = await createTempRepo();
		const state = createSelectedSliceState("session-1", "slice-1");
		await writePawSessionState(repoRoot, state);
		const lock = await writeCurrentLock(repoRoot, "session-1", 1_000);

		const result = await preparePawSliceCheckpoint({
			repoRoot,
			sessionId: "session-1",
			baseTree: "tree:abc123",
			changedFiles,
			shortId: "ABC_123!",
			timestamp,
			notes: "before worker writes",
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result.status).toBe("prepared");
		if (result.status !== "prepared") return;
		expect(result.lock).toEqual(lock);
		expect(result.state).toEqual(state);
		expect(result.metadata).toEqual({
			session_id: "session-1",
			checkpoint_name: "20260616T030405Z-slice-1-abc123",
			scope: "slice",
			slice_id: "slice-1",
			created_at: "2026-06-16T03:04:05.678Z",
			base_tree: "tree:abc123",
			changed_files: changedFiles,
			notes: "before worker writes",
		});
		expect(result.paths.checkpointName).toBe("20260616T030405Z-slice-1-abc123");
		await expect(readPawCheckpointMetadata(repoRoot, "session-1", result.metadata.checkpoint_name)).resolves.toEqual(
			result.metadata,
		);
	});

	test("rejects missing lock without writing metadata", async () => {
		const repoRoot = await createTempRepo();
		await writePawSessionState(repoRoot, createSelectedSliceState("session-1", "slice-1"));

		const result = await preparePawSliceCheckpoint({
			repoRoot,
			sessionId: "session-1",
			baseTree: "tree:abc123",
			changedFiles,
			shortId: "abc123",
			timestamp,
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result).toEqual({
			status: "not_locked",
			reason: "unlocked",
		});
		await expectNoMetadata(repoRoot, "session-1", "20260616T030405Z-slice-1-abc123");
	});

	test("rejects stale and foreign locks without writing metadata", async () => {
		const repoRoot = await createTempRepo();
		await writePawSessionState(repoRoot, createSelectedSliceState("stale-lock", "slice-1"));
		await writePawSessionState(repoRoot, createSelectedSliceState("other-owner", "slice-1"));

		const staleLock: PawSessionLock = {
			pid: process.pid,
			host: hostname(),
			heartbeat_ts: 1_000,
			ttl: 1,
		};
		const otherOwnerLock: PawSessionLock = {
			pid: process.pid,
			host: "other-host",
			heartbeat_ts: 1_000,
			ttl: 120,
		};
		await writeLock(repoRoot, "stale-lock", staleLock);
		await writeLock(repoRoot, "other-owner", otherOwnerLock);

		const stale = await preparePawSliceCheckpoint({
			repoRoot,
			sessionId: "stale-lock",
			baseTree: "tree:abc123",
			changedFiles,
			shortId: "abc123",
			timestamp,
			lockOptions: { nowMs: 2_001, ttlSec: 120 },
		});
		const otherOwner = await preparePawSliceCheckpoint({
			repoRoot,
			sessionId: "other-owner",
			baseTree: "tree:abc123",
			changedFiles,
			shortId: "abc123",
			timestamp,
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(stale).toEqual({
			status: "not_locked",
			reason: "stale",
			staleReason: "expired_heartbeat",
			lock: staleLock,
		});
		expect(otherOwner).toEqual({
			status: "locked_by_other",
			lock: otherOwnerLock,
			expectedOwner: {
				pid: process.pid,
				host: hostname(),
			},
		});
		await expectNoMetadata(repoRoot, "stale-lock", "20260616T030405Z-slice-1-abc123");
		await expectNoMetadata(repoRoot, "other-owner", "20260616T030405Z-slice-1-abc123");
	});

	test("rejects wrong state and missing selected slice without writing metadata", async () => {
		const repoRoot = await createTempRepo();
		const wrongState: PawSessionState = {
			...createSelectedSliceState("wrong-state", "slice-1"),
			name: "IMPLEMENTING",
		};
		const missingSliceState: PawSessionState = {
			...createSelectedSliceState("missing-slice", "slice-1"),
			current_slice_id: null,
		};
		await writePawSessionState(repoRoot, wrongState);
		await writePawSessionState(repoRoot, missingSliceState);
		const wrongStateLock = await writeCurrentLock(repoRoot, "wrong-state", 1_000);
		const missingSliceLock = await writeCurrentLock(repoRoot, "missing-slice", 1_000);

		const wrongStateResult = await preparePawSliceCheckpoint({
			repoRoot,
			sessionId: "wrong-state",
			baseTree: "tree:abc123",
			changedFiles,
			shortId: "abc123",
			timestamp,
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});
		const missingSliceResult = await preparePawSliceCheckpoint({
			repoRoot,
			sessionId: "missing-slice",
			baseTree: "tree:abc123",
			changedFiles,
			shortId: "abc123",
			timestamp,
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(wrongStateResult).toEqual({
			status: "invalid_state",
			expectedState: "SLICE_SELECT",
			state: wrongState,
			lock: wrongStateLock,
		});
		expect(missingSliceResult).toEqual({
			status: "no_selected_slice",
			state: missingSliceState,
			lock: missingSliceLock,
		});
		await expectNoMetadata(repoRoot, "wrong-state", "20260616T030405Z-slice-1-abc123");
		await expectNoMetadata(repoRoot, "missing-slice", "20260616T030405Z-task-abc123");
	});

	test("preserves changed files without optional notes", async () => {
		const repoRoot = await createTempRepo();
		await writePawSessionState(repoRoot, createSelectedSliceState("session-1", "slice-2"));
		await writeCurrentLock(repoRoot, "session-1", 1_000);

		const result = await preparePawSliceCheckpoint({
			repoRoot,
			sessionId: "session-1",
			baseTree: "tree:def456",
			changedFiles,
			shortId: "def456",
			timestamp,
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result.status).toBe("prepared");
		if (result.status !== "prepared") return;
		expect(result.metadata).toEqual({
			session_id: "session-1",
			checkpoint_name: "20260616T030405Z-slice-2-def456",
			scope: "slice",
			slice_id: "slice-2",
			created_at: "2026-06-16T03:04:05.678Z",
			base_tree: "tree:def456",
			changed_files: changedFiles,
		});
		expect("notes" in result.metadata).toBe(false);
	});
});
