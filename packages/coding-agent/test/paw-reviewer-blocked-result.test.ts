import { mkdtemp, rm } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
	blockPawReviewerResult,
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
	const root = await mkdtemp(join(tmpdir(), "paw-reviewer-blocked-result-"));
	tempRoots.push(root);
	return root;
}

function createReviewingState(sessionId: string, sliceId = "slice-1"): PawSessionState {
	return {
		session_id: sessionId,
		name: "REVIEWING",
		current_slice_id: sliceId,
		pending_slice_ids: ["slice-2"],
		completed_slice_ids: ["slice-0"],
		blocked_reason: null,
	};
}

function createBlockedReviewerOutput(overrides: Partial<PawSubAgentOutput> = {}): PawSubAgentOutput {
	return {
		status: "blocked",
		confidence: "medium",
		agent: "reviewer",
		session_id: "session-1",
		slice_id: "slice-1",
		artifact_ref: ".paw/artifacts/session-1/reviewer/report.md",
		changed_files: [],
		inspected_files: [],
		risks: [],
		next_actions: ["Address the review findings and resume."],
		blocked_reason: {
			code: "TEST_FAILURE",
			message: "Reviewer found failing tests.",
			suggested_action: "Fix the failing tests identified during review.",
		},
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

describe("blockPawReviewerResult", () => {
	test("persists a matching blocked state for blocked reviewer output under the current lock", async () => {
		const repoRoot = await createTempRepo();
		const state = createReviewingState("session-1", "slice-1");
		await writePawSessionState(repoRoot, state);
		const lock = await writeCurrentLock(repoRoot, "session-1", 1_000);
		const reviewerOutput = createBlockedReviewerOutput();

		const result = await blockPawReviewerResult({
			repoRoot,
			sessionId: "session-1",
			reviewerOutput,
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result.status).toBe("blocked");
		if (result.status !== "blocked") return;
		expect(result.lock).toEqual(lock);
		expect(result.previousState).toEqual(state);
		expect(result.nextState).toEqual({
			...state,
			name: "BLOCKED_TEST_FAILURE",
			blocked_reason: {
				code: "TEST_FAILURE",
				message: "Reviewer found failing tests.",
				suggested_action: "Fix the failing tests identified during review.",
				slice_id: "slice-1",
				resume_state: "REVIEWING",
			},
		});
		expect(result.reviewerOutput).toEqual(reviewerOutput);
		await expect(readPawSessionState(repoRoot, "session-1")).resolves.toEqual(result.nextState);
	});

	test("maps needs_user_decision output to BLOCKED_NEEDS_USER_DECISION", async () => {
		const repoRoot = await createTempRepo();
		const state = createReviewingState("session-1", "slice-1");
		await writePawSessionState(repoRoot, state);
		await writeCurrentLock(repoRoot, "session-1", 1_000);

		const result = await blockPawReviewerResult({
			repoRoot,
			sessionId: "session-1",
			reviewerOutput: createBlockedReviewerOutput({
				status: "needs_user_decision",
				blocked_reason: {
					code: "NEEDS_USER_DECISION",
					message: "Reviewer cannot decide between two valid refactorings.",
					suggested_action: "Choose the preferred refactoring strategy.",
				},
			}),
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result.status).toBe("blocked");
		if (result.status !== "blocked") return;
		expect(result.nextState.name).toBe("BLOCKED_NEEDS_USER_DECISION");
		expect(result.nextState.blocked_reason).toMatchObject({
			code: "NEEDS_USER_DECISION",
			slice_id: "slice-1",
			resume_state: "REVIEWING",
		});
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

		const missing = await blockPawReviewerResult({
			repoRoot,
			sessionId: "missing-lock",
			reviewerOutput: createBlockedReviewerOutput({ session_id: "missing-lock" }),
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});
		const stale = await blockPawReviewerResult({
			repoRoot,
			sessionId: "stale-lock",
			reviewerOutput: createBlockedReviewerOutput({ session_id: "stale-lock" }),
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

		const result = await blockPawReviewerResult({
			repoRoot,
			sessionId: "session-1",
			reviewerOutput: createBlockedReviewerOutput(),
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
			name: "IMPLEMENTING",
		};
		const noSliceState: PawSessionState = {
			...createReviewingState("no-slice", "slice-1"),
			current_slice_id: null,
		};
		await writePawSessionState(repoRoot, wrongState);
		await writePawSessionState(repoRoot, noSliceState);
		await writeCurrentLock(repoRoot, "wrong-state", 1_000);
		await writeCurrentLock(repoRoot, "no-slice", 1_000);

		const wrong = await blockPawReviewerResult({
			repoRoot,
			sessionId: "wrong-state",
			reviewerOutput: createBlockedReviewerOutput({ session_id: "wrong-state" }),
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});
		const noSlice = await blockPawReviewerResult({
			repoRoot,
			sessionId: "no-slice",
			reviewerOutput: createBlockedReviewerOutput({ session_id: "no-slice", slice_id: null }),
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(wrong.status).toBe("invalid_state");
		if (wrong.status !== "invalid_state") return;
		expect(wrong.previousState).toEqual(wrongState);
		expect(wrong.issues).toEqual([
			{
				path: "/name",
				message: "Reviewer blocked result requires REVIEWING state.",
			},
		]);
		expect(noSlice.status).toBe("no_selected_slice");
		if (noSlice.status !== "no_selected_slice") return;
		expect(noSlice.previousState).toEqual(noSliceState);
		await expect(readPawSessionState(repoRoot, "wrong-state")).resolves.toEqual(wrongState);
		await expect(readPawSessionState(repoRoot, "no-slice")).resolves.toEqual(noSliceState);
	});

	test("returns no-write results for output mismatch, non-blocked status, and invalid blocked reason", async () => {
		const repoRoot = await createTempRepo();
		const mismatchState = createReviewingState("mismatch", "slice-1");
		const nonBlockedState = createReviewingState("non-blocked", "slice-1");
		const invalidReasonState = createReviewingState("invalid-reason", "slice-1");
		await writePawSessionState(repoRoot, mismatchState);
		await writePawSessionState(repoRoot, nonBlockedState);
		await writePawSessionState(repoRoot, invalidReasonState);
		await writeCurrentLock(repoRoot, "mismatch", 1_000);
		await writeCurrentLock(repoRoot, "non-blocked", 1_000);
		await writeCurrentLock(repoRoot, "invalid-reason", 1_000);

		const mismatch = await blockPawReviewerResult({
			repoRoot,
			sessionId: "mismatch",
			reviewerOutput: createBlockedReviewerOutput({
				agent: "worker",
				session_id: "other-session",
				slice_id: "slice-2",
			}),
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});
		const nonBlocked = await blockPawReviewerResult({
			repoRoot,
			sessionId: "non-blocked",
			reviewerOutput: createBlockedReviewerOutput({ session_id: "non-blocked", status: "pass" }),
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});
		const invalidReason = await blockPawReviewerResult({
			repoRoot,
			sessionId: "invalid-reason",
			reviewerOutput: createBlockedReviewerOutput({
				session_id: "invalid-reason",
				blocked_reason: {
					code: "TEST_FAILURE",
					message: "",
					suggested_action: "",
				},
			}),
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(mismatch.status).toBe("invalid_reviewer_output");
		if (mismatch.status !== "invalid_reviewer_output") return;
		expect(mismatch.issues.map((issue) => issue.path)).toEqual(["/agent", "/session_id", "/slice_id"]);
		expect(nonBlocked.status).toBe("reviewer_not_blocked");
		if (nonBlocked.status !== "reviewer_not_blocked") return;
		expect(nonBlocked.reviewerOutput.status).toBe("pass");
		expect(invalidReason.status).toBe("invalid_blocked_reason");
		if (invalidReason.status !== "invalid_blocked_reason") return;
		expect(invalidReason.issues).toEqual([
			{
				path: "/blocked_reason/message",
				message: "Reviewer blocked reason message is required.",
			},
			{
				path: "/blocked_reason/suggested_action",
				message: "Reviewer blocked reason suggested action is required.",
			},
		]);
		await expect(readPawSessionState(repoRoot, "mismatch")).resolves.toEqual(mismatchState);
		await expect(readPawSessionState(repoRoot, "non-blocked")).resolves.toEqual(nonBlockedState);
		await expect(readPawSessionState(repoRoot, "invalid-reason")).resolves.toEqual(invalidReasonState);
	});
});
