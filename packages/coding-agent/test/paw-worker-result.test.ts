import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
	completePawWorkerPass,
	hashPawPatchContent,
	loadDefaultPawRuntimeConfig,
	type PawSessionLock,
	type PawSessionState,
	type PawSubAgentOutput,
	readPawSessionState,
	readPawSliceJournal,
	resolvePawSessionPaths,
	writePawJsonAtomic,
	writePawSessionState,
} from "../src/paw/index.ts";

const tempRoots: string[] = [];
const sourceRoot = join(import.meta.dirname, "..", "..", "..");

async function createTempRepo(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-worker-result-"));
	tempRoots.push(root);
	return root;
}

function createImplementingState(sessionId: string, sliceId = "slice-1"): PawSessionState {
	return {
		session_id: sessionId,
		name: "IMPLEMENTING",
		current_slice_id: sliceId,
		pending_slice_ids: ["slice-2", "slice-3"],
		completed_slice_ids: ["slice-0"],
		blocked_reason: null,
	};
}

function createWorkerOutput(overrides: Partial<PawSubAgentOutput> = {}): PawSubAgentOutput {
	return {
		status: "pass",
		confidence: "high",
		agent: "worker",
		session_id: "session-1",
		slice_id: "slice-1",
		artifact_ref: ".paw/artifacts/session-1/worker/report.md",
		changed_files: [
			{
				path: "src/a.ts",
				change_type: "modify",
				content_hash: "sha256:first",
				apply_method: "diff",
			},
			{
				path: "src/b.ts",
				change_type: "create",
				content_hash: "sha256:second",
			},
		],
		inspected_files: [],
		risks: [],
		next_actions: [],
		tokens_used: 42,
		usd_cost: 0.01,
		degraded: false,
		model_used: "model-1",
		...overrides,
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

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("completePawWorkerPass", () => {
	test("appends ordered journal entries and advances IMPLEMENTING to REVIEWING under the current lock", async () => {
		const repoRoot = await createTempRepo();
		const state = createImplementingState("session-1", "slice-1");
		await writePawSessionState(repoRoot, state);
		const lock = await writeCurrentLock(repoRoot, "session-1", 1_000);
		const workerOutput = createWorkerOutput();

		const result = await completePawWorkerPass({
			repoRoot,
			sessionId: "session-1",
			workerOutput,
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
			timestamp: "2026-06-16T00:00:00.000Z",
		});

		expect(result.status).toBe("completed");
		if (result.status !== "completed") return;
		expect(result.lock).toEqual(lock);
		expect(result.previousState).toEqual(state);
		expect(result.nextState).toEqual({
			...state,
			name: "REVIEWING",
		});
		expect(result.workerOutput).toEqual(workerOutput);
		expect(result.journalEntries).toEqual([
			{
				session_id: "session-1",
				slice_id: "slice-1",
				path: "src/a.ts",
				change_type: "modify",
				content_hash: "sha256:first",
				apply_method: "diff",
				timestamp: "2026-06-16T00:00:00.000Z",
			},
			{
				session_id: "session-1",
				slice_id: "slice-1",
				path: "src/b.ts",
				change_type: "create",
				content_hash: "sha256:second",
				timestamp: "2026-06-16T00:00:00.000Z",
			},
		]);
		await expect(readPawSessionState(repoRoot, "session-1")).resolves.toEqual(result.nextState);
		await expect(readPawSliceJournal(repoRoot, "session-1")).resolves.toEqual(result.journalEntries);
	});

	test("allows empty changed files and advances without creating journal content", async () => {
		const repoRoot = await createTempRepo();
		const state = createImplementingState("session-1", "slice-1");
		await writePawSessionState(repoRoot, state);
		await writeCurrentLock(repoRoot, "session-1", 1_000);
		const paths = resolvePawSessionPaths(repoRoot, "session-1");

		const result = await completePawWorkerPass({
			repoRoot,
			sessionId: "session-1",
			workerOutput: createWorkerOutput({ changed_files: [] }),
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
			timestamp: "2026-06-16T00:00:00.000Z",
		});

		expect(result.status).toBe("completed");
		if (result.status !== "completed") return;
		expect(result.journalEntries).toEqual([]);
		expect(existsSync(paths.sliceJournalFile)).toBe(false);
		await expect(readPawSliceJournal(repoRoot, "session-1")).resolves.toEqual([]);
		await expect(readPawSessionState(repoRoot, "session-1")).resolves.toEqual(result.nextState);
	});

	test("applies declared full-file worker patches before advancing to REVIEWING", async () => {
		const repoRoot = await createTempRepo();
		await mkdir(join(repoRoot, "src"), { recursive: true });
		await writeFile(join(repoRoot, "src/a.ts"), "before\n", "utf-8");
		const state = createImplementingState("session-1", "slice-1");
		await writePawSessionState(repoRoot, state);
		await writeCurrentLock(repoRoot, "session-1", 1_000);
		const next = "after\n";

		const result = await completePawWorkerPass({
			repoRoot,
			sessionId: "session-1",
			config: loadDefaultPawRuntimeConfig(sourceRoot),
			workerOutput: createWorkerOutput({
				changed_files: [
					{
						path: "src/a.ts",
						change_type: "modify",
						apply_method: "full_file",
						base_content_hash: hashPawPatchContent("before\n"),
						content_hash: hashPawPatchContent(next),
						new_content: next,
					},
				],
			}),
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
			timestamp: "2026-06-16T00:00:00.000Z",
		});

		expect(result.status).toBe("completed");
		if (result.status !== "completed") return;
		expect(result.appliedChanges).toHaveLength(1);
		expect(await readFile(join(repoRoot, "src/a.ts"), "utf-8")).toBe(next);
	});

	test("returns not_locked for missing and stale locks without writing state or journal", async () => {
		const repoRoot = await createTempRepo();
		const missingState = createImplementingState("missing-lock", "slice-1");
		const staleState = createImplementingState("stale-lock", "slice-1");
		await writePawSessionState(repoRoot, missingState);
		await writePawSessionState(repoRoot, staleState);
		const staleLock: PawSessionLock = {
			pid: process.pid,
			host: hostname(),
			heartbeat_ts: 1_000,
			ttl: 1,
		};
		await writeLock(repoRoot, "stale-lock", staleLock);

		const missing = await completePawWorkerPass({
			repoRoot,
			sessionId: "missing-lock",
			workerOutput: createWorkerOutput({ session_id: "missing-lock" }),
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});
		const stale = await completePawWorkerPass({
			repoRoot,
			sessionId: "stale-lock",
			workerOutput: createWorkerOutput({ session_id: "stale-lock" }),
			lockOptions: { nowMs: 2_001, ttlSec: 120 },
		});

		expect(missing).toEqual({ status: "not_locked", reason: "unlocked" });
		expect(stale).toEqual({
			status: "not_locked",
			reason: "stale",
			staleReason: "expired_heartbeat",
			lock: staleLock,
		});
		await expect(readPawSessionState(repoRoot, "missing-lock")).resolves.toEqual(missingState);
		await expect(readPawSessionState(repoRoot, "stale-lock")).resolves.toEqual(staleState);
		await expect(readPawSliceJournal(repoRoot, "missing-lock")).resolves.toEqual([]);
		await expect(readPawSliceJournal(repoRoot, "stale-lock")).resolves.toEqual([]);
	});

	test("returns locked_by_other for a foreign live lock without writing state or journal", async () => {
		const repoRoot = await createTempRepo();
		const state = createImplementingState("session-1", "slice-1");
		const otherOwnerLock: PawSessionLock = {
			pid: process.pid,
			host: "other-host",
			heartbeat_ts: 1_000,
			ttl: 120,
		};
		await writePawSessionState(repoRoot, state);
		await writeLock(repoRoot, "session-1", otherOwnerLock);

		const result = await completePawWorkerPass({
			repoRoot,
			sessionId: "session-1",
			workerOutput: createWorkerOutput(),
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result).toEqual({
			status: "locked_by_other",
			lock: otherOwnerLock,
			expectedOwner: {
				pid: process.pid,
				host: hostname(),
			},
		});
		await expect(readPawSessionState(repoRoot, "session-1")).resolves.toEqual(state);
		await expect(readPawSliceJournal(repoRoot, "session-1")).resolves.toEqual([]);
	});

	test("returns no-write results for wrong state and missing current slice", async () => {
		const repoRoot = await createTempRepo();
		const wrongState: PawSessionState = {
			...createImplementingState("wrong-state", "slice-1"),
			name: "REVIEWING",
		};
		const noSliceState: PawSessionState = {
			...createImplementingState("no-slice", "slice-1"),
			current_slice_id: null,
		};
		await writePawSessionState(repoRoot, wrongState);
		await writePawSessionState(repoRoot, noSliceState);
		await writeCurrentLock(repoRoot, "wrong-state", 1_000);
		await writeCurrentLock(repoRoot, "no-slice", 1_000);

		const wrong = await completePawWorkerPass({
			repoRoot,
			sessionId: "wrong-state",
			workerOutput: createWorkerOutput({ session_id: "wrong-state" }),
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});
		const noSlice = await completePawWorkerPass({
			repoRoot,
			sessionId: "no-slice",
			workerOutput: createWorkerOutput({ session_id: "no-slice", slice_id: null }),
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(wrong.status).toBe("invalid_state");
		if (wrong.status !== "invalid_state") return;
		expect(wrong.previousState).toEqual(wrongState);
		expect(wrong.issues).toEqual([
			{
				path: "/name",
				message: "Worker pass completion requires IMPLEMENTING state.",
			},
		]);
		expect(noSlice.status).toBe("no_selected_slice");
		if (noSlice.status !== "no_selected_slice") return;
		expect(noSlice.previousState).toEqual(noSliceState);
		await expect(readPawSessionState(repoRoot, "wrong-state")).resolves.toEqual(wrongState);
		await expect(readPawSessionState(repoRoot, "no-slice")).resolves.toEqual(noSliceState);
		await expect(readPawSliceJournal(repoRoot, "wrong-state")).resolves.toEqual([]);
		await expect(readPawSliceJournal(repoRoot, "no-slice")).resolves.toEqual([]);
	});

	test("returns no-write results for worker output mismatches, non-pass status, and missing content hash", async () => {
		const repoRoot = await createTempRepo();
		const mismatchState = createImplementingState("mismatch", "slice-1");
		const nonPassState = createImplementingState("non-pass", "slice-1");
		const invalidFilesState = createImplementingState("invalid-files", "slice-1");
		await writePawSessionState(repoRoot, mismatchState);
		await writePawSessionState(repoRoot, nonPassState);
		await writePawSessionState(repoRoot, invalidFilesState);
		await writeCurrentLock(repoRoot, "mismatch", 1_000);
		await writeCurrentLock(repoRoot, "non-pass", 1_000);
		await writeCurrentLock(repoRoot, "invalid-files", 1_000);

		const mismatch = await completePawWorkerPass({
			repoRoot,
			sessionId: "mismatch",
			workerOutput: createWorkerOutput({ agent: "reviewer", session_id: "other-session", slice_id: "slice-2" }),
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});
		const nonPass = await completePawWorkerPass({
			repoRoot,
			sessionId: "non-pass",
			workerOutput: createWorkerOutput({ session_id: "non-pass", status: "blocked" }),
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});
		const invalidFiles = await completePawWorkerPass({
			repoRoot,
			sessionId: "invalid-files",
			workerOutput: createWorkerOutput({
				session_id: "invalid-files",
				changed_files: [
					{
						path: "",
						change_type: "modify",
						content_hash: "",
					},
				],
			}),
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(mismatch.status).toBe("invalid_worker_output");
		if (mismatch.status !== "invalid_worker_output") return;
		expect(mismatch.issues.map((issue) => issue.path)).toEqual(["/agent", "/session_id", "/slice_id"]);
		expect(nonPass.status).toBe("worker_not_passed");
		if (nonPass.status !== "worker_not_passed") return;
		expect(nonPass.workerOutput.status).toBe("blocked");
		expect(invalidFiles.status).toBe("invalid_worker_output");
		if (invalidFiles.status !== "invalid_worker_output") return;
		expect(invalidFiles.issues).toEqual([
			{
				path: "/changed_files/0/path",
				message: "Changed file path is required for journal persistence.",
			},
			{
				path: "/changed_files/0/content_hash",
				message: "Changed file content hash is required for journal persistence.",
			},
		]);
		await expect(readPawSessionState(repoRoot, "mismatch")).resolves.toEqual(mismatchState);
		await expect(readPawSessionState(repoRoot, "non-pass")).resolves.toEqual(nonPassState);
		await expect(readPawSessionState(repoRoot, "invalid-files")).resolves.toEqual(invalidFilesState);
		await expect(readPawSliceJournal(repoRoot, "mismatch")).resolves.toEqual([]);
		await expect(readPawSliceJournal(repoRoot, "non-pass")).resolves.toEqual([]);
		await expect(readPawSliceJournal(repoRoot, "invalid-files")).resolves.toEqual([]);
	});
});
