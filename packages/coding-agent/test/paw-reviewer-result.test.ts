import { mkdtemp, rm } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
	completePawReviewerPass,
	type PawSessionLock,
	type PawSessionState,
	type PawSubAgentOutput,
	readPawSessionState,
	resolvePawSessionPaths,
	writePawJsonAtomic,
	writePawSessionState,
} from "../src/paw/index.ts";

const tempRoots: string[] = [];

async function createTempRepo(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-reviewer-result-"));
	tempRoots.push(root);
	return root;
}

function createReviewingState(sessionId: string, sliceId = "slice-1"): PawSessionState {
	return {
		session_id: sessionId,
		name: "REVIEWING",
		current_slice_id: sliceId,
		pending_slice_ids: ["slice-2", "slice-3"],
		completed_slice_ids: ["slice-0"],
		blocked_reason: null,
	};
}

function createReviewerOutput(overrides: Partial<PawSubAgentOutput> = {}): PawSubAgentOutput {
	return {
		status: "pass",
		confidence: "high",
		agent: "reviewer",
		session_id: "session-1",
		slice_id: "slice-1",
		artifact_ref: ".paw/artifacts/session-1/reviewer/report.md",
		changed_files: [],
		inspected_files: [],
		risks: [],
		next_actions: [],
		tokens_used: 21,
		usd_cost: 0.005,
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

describe("completePawReviewerPass", () => {
	test("advances REVIEWING to VERIFYING under the current lock", async () => {
		const repoRoot = await createTempRepo();
		const state = createReviewingState("session-1", "slice-1");
		await writePawSessionState(repoRoot, state);
		const lock = await writeCurrentLock(repoRoot, "session-1", 1_000);
		const reviewerOutput = createReviewerOutput();

		const result = await completePawReviewerPass({
			repoRoot,
			sessionId: "session-1",
			reviewerOutput,
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result.status).toBe("completed");
		if (result.status !== "completed") return;
		expect(result.lock).toEqual(lock);
		expect(result.previousState).toEqual(state);
		expect(result.nextState).toEqual({
			...state,
			name: "VERIFYING",
		});
		expect(result.reviewerOutput).toEqual(reviewerOutput);
		await expect(readPawSessionState(repoRoot, "session-1")).resolves.toEqual(result.nextState);
	});

	test("returns not_locked for missing and stale locks without writing state", async () => {
		const repoRoot = await createTempRepo();
		const missingState = createReviewingState("missing-lock", "slice-1");
		const staleState = createReviewingState("stale-lock", "slice-1");
		await writePawSessionState(repoRoot, missingState);
		await writePawSessionState(repoRoot, staleState);
		const staleLock: PawSessionLock = {
			pid: process.pid,
			host: hostname(),
			heartbeat_ts: 1_000,
			ttl: 1,
		};
		await writeLock(repoRoot, "stale-lock", staleLock);

		const missing = await completePawReviewerPass({
			repoRoot,
			sessionId: "missing-lock",
			reviewerOutput: createReviewerOutput({ session_id: "missing-lock" }),
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});
		const stale = await completePawReviewerPass({
			repoRoot,
			sessionId: "stale-lock",
			reviewerOutput: createReviewerOutput({ session_id: "stale-lock" }),
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
	});

	test("returns locked_by_other for a foreign live lock without writing state", async () => {
		const repoRoot = await createTempRepo();
		const state = createReviewingState("session-1", "slice-1");
		const otherOwnerLock: PawSessionLock = {
			pid: process.pid,
			host: "other-host",
			heartbeat_ts: 1_000,
			ttl: 120,
		};
		await writePawSessionState(repoRoot, state);
		await writeLock(repoRoot, "session-1", otherOwnerLock);

		const result = await completePawReviewerPass({
			repoRoot,
			sessionId: "session-1",
			reviewerOutput: createReviewerOutput(),
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
	});

	test("returns no-write results for wrong state and missing current slice", async () => {
		const repoRoot = await createTempRepo();
		const wrongState: PawSessionState = {
			...createReviewingState("wrong-state", "slice-1"),
			name: "VERIFYING",
		};
		const noSliceState: PawSessionState = {
			...createReviewingState("no-slice", "slice-1"),
			current_slice_id: null,
		};
		await writePawSessionState(repoRoot, wrongState);
		await writePawSessionState(repoRoot, noSliceState);
		await writeCurrentLock(repoRoot, "wrong-state", 1_000);
		await writeCurrentLock(repoRoot, "no-slice", 1_000);

		const wrong = await completePawReviewerPass({
			repoRoot,
			sessionId: "wrong-state",
			reviewerOutput: createReviewerOutput({ session_id: "wrong-state" }),
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});
		const noSlice = await completePawReviewerPass({
			repoRoot,
			sessionId: "no-slice",
			reviewerOutput: createReviewerOutput({ session_id: "no-slice", slice_id: null }),
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(wrong.status).toBe("invalid_state");
		if (wrong.status !== "invalid_state") return;
		expect(wrong.previousState).toEqual(wrongState);
		expect(wrong.issues).toEqual([
			{
				path: "/name",
				message: "Reviewer pass completion requires REVIEWING state.",
			},
		]);
		expect(noSlice.status).toBe("no_selected_slice");
		if (noSlice.status !== "no_selected_slice") return;
		expect(noSlice.previousState).toEqual(noSliceState);
		await expect(readPawSessionState(repoRoot, "wrong-state")).resolves.toEqual(wrongState);
		await expect(readPawSessionState(repoRoot, "no-slice")).resolves.toEqual(noSliceState);
	});

	test("returns no-write results for reviewer output mismatches and non-pass status", async () => {
		const repoRoot = await createTempRepo();
		const mismatchState = createReviewingState("mismatch", "slice-1");
		const nonPassState = createReviewingState("non-pass", "slice-1");
		await writePawSessionState(repoRoot, mismatchState);
		await writePawSessionState(repoRoot, nonPassState);
		await writeCurrentLock(repoRoot, "mismatch", 1_000);
		await writeCurrentLock(repoRoot, "non-pass", 1_000);

		const mismatch = await completePawReviewerPass({
			repoRoot,
			sessionId: "mismatch",
			reviewerOutput: createReviewerOutput({ agent: "worker", session_id: "other-session", slice_id: "slice-2" }),
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});
		const nonPass = await completePawReviewerPass({
			repoRoot,
			sessionId: "non-pass",
			reviewerOutput: createReviewerOutput({ session_id: "non-pass", status: "fail" }),
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(mismatch.status).toBe("invalid_reviewer_output");
		if (mismatch.status !== "invalid_reviewer_output") return;
		expect(mismatch.issues.map((issue) => issue.path)).toEqual(["/agent", "/session_id", "/slice_id"]);
		expect(nonPass.status).toBe("reviewer_not_passed");
		if (nonPass.status !== "reviewer_not_passed") return;
		expect(nonPass.reviewerOutput.status).toBe("fail");
		await expect(readPawSessionState(repoRoot, "mismatch")).resolves.toEqual(mismatchState);
		await expect(readPawSessionState(repoRoot, "non-pass")).resolves.toEqual(nonPassState);
	});
});
