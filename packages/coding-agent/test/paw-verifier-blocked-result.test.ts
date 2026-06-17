import { mkdtemp, rm } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
	blockPawVerifierResult,
	type PawBlockedReasonInput,
	type PawSessionLock,
	type PawSessionState,
	readPawSessionState,
	resolvePawSessionPaths,
	writePawJsonAtomic,
	writePawSessionState,
} from "../src/paw/index.ts";

const tempRoots: string[] = [];

async function createTempRepo(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-verifier-blocked-result-"));
	tempRoots.push(root);
	return root;
}

function createVerifyingState(sessionId: string, sliceId = "slice-1"): PawSessionState {
	return {
		session_id: sessionId,
		name: "VERIFYING",
		current_slice_id: sliceId,
		pending_slice_ids: ["slice-2"],
		completed_slice_ids: ["slice-0"],
		blocked_reason: null,
	};
}

function createBlockedReason(overrides: Partial<PawBlockedReasonInput> = {}): PawBlockedReasonInput {
	return {
		code: "TEST_FAILURE",
		message: "Verification gate failed: unit tests did not pass.",
		suggested_action: "Fix the failing tests and resume verification.",
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

describe("blockPawVerifierResult", () => {
	test("persists a matching blocked state for a verifier blocked reason under the current lock", async () => {
		const repoRoot = await createTempRepo();
		const state = createVerifyingState("session-1", "slice-1");
		await writePawSessionState(repoRoot, state);
		const lock = await writeCurrentLock(repoRoot, "session-1", 1_000);
		const blockedReason = createBlockedReason();

		const result = await blockPawVerifierResult({
			repoRoot,
			sessionId: "session-1",
			blockedReason,
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
				message: "Verification gate failed: unit tests did not pass.",
				suggested_action: "Fix the failing tests and resume verification.",
				slice_id: "slice-1",
				resume_state: "VERIFYING",
			},
		});
		await expect(readPawSessionState(repoRoot, "session-1")).resolves.toEqual(result.nextState);
	});

	test("maps BUILD_FAILURE code to BLOCKED_BUILD_FAILURE", async () => {
		const repoRoot = await createTempRepo();
		const state = createVerifyingState("session-1", "slice-1");
		await writePawSessionState(repoRoot, state);
		await writeCurrentLock(repoRoot, "session-1", 1_000);

		const result = await blockPawVerifierResult({
			repoRoot,
			sessionId: "session-1",
			blockedReason: createBlockedReason({
				code: "BUILD_FAILURE",
				message: "Build failed during verification.",
				suggested_action: "Fix the build error and resume.",
			}),
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result.status).toBe("blocked");
		if (result.status !== "blocked") return;
		expect(result.nextState.name).toBe("BLOCKED_BUILD_FAILURE");
		expect(result.nextState.blocked_reason).toMatchObject({
			code: "BUILD_FAILURE",
			slice_id: "slice-1",
			resume_state: "VERIFYING",
		});
		await expect(readPawSessionState(repoRoot, "session-1")).resolves.toEqual(result.nextState);
	});

	test("returns not_locked for missing and stale locks without writing state", async () => {
		const repoRoot = await createTempRepo();
		const missingState = createVerifyingState("missing-lock", "slice-1");
		const staleState = createVerifyingState("stale-lock", "slice-1");
		await writePawSessionState(repoRoot, missingState);
		await writePawSessionState(repoRoot, staleState);
		const staleLock: PawSessionLock = {
			pid: process.pid,
			host: hostname(),
			heartbeat_ts: 1_000,
			ttl: 1,
		};
		await writeLock(repoRoot, "stale-lock", staleLock);

		const missing = await blockPawVerifierResult({
			repoRoot,
			sessionId: "missing-lock",
			blockedReason: createBlockedReason(),
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});
		const stale = await blockPawVerifierResult({
			repoRoot,
			sessionId: "stale-lock",
			blockedReason: createBlockedReason(),
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
		const state = createVerifyingState("session-1", "slice-1");
		const otherOwnerLock: PawSessionLock = {
			pid: process.pid,
			host: "other-host",
			heartbeat_ts: 1_000,
			ttl: 120,
		};
		await writePawSessionState(repoRoot, state);
		await writeLock(repoRoot, "session-1", otherOwnerLock);

		const result = await blockPawVerifierResult({
			repoRoot,
			sessionId: "session-1",
			blockedReason: createBlockedReason(),
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
			...createVerifyingState("wrong-state", "slice-1"),
			name: "REVIEWING",
		};
		const noSliceState: PawSessionState = {
			...createVerifyingState("no-slice", "slice-1"),
			current_slice_id: null,
		};
		await writePawSessionState(repoRoot, wrongState);
		await writePawSessionState(repoRoot, noSliceState);
		await writeCurrentLock(repoRoot, "wrong-state", 1_000);
		await writeCurrentLock(repoRoot, "no-slice", 1_000);

		const wrong = await blockPawVerifierResult({
			repoRoot,
			sessionId: "wrong-state",
			blockedReason: createBlockedReason(),
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});
		const noSlice = await blockPawVerifierResult({
			repoRoot,
			sessionId: "no-slice",
			blockedReason: createBlockedReason(),
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(wrong.status).toBe("invalid_state");
		if (wrong.status !== "invalid_state") return;
		expect(wrong.previousState).toEqual(wrongState);
		expect(wrong.issues).toEqual([
			{
				path: "/name",
				message: "Verifier blocked result requires VERIFYING state.",
			},
		]);
		expect(noSlice.status).toBe("no_selected_slice");
		if (noSlice.status !== "no_selected_slice") return;
		expect(noSlice.previousState).toEqual(noSliceState);
		await expect(readPawSessionState(repoRoot, "wrong-state")).resolves.toEqual(wrongState);
		await expect(readPawSessionState(repoRoot, "no-slice")).resolves.toEqual(noSliceState);
	});

	test("returns no-write results for invalid blocked reason", async () => {
		const repoRoot = await createTempRepo();
		const invalidReasonState = createVerifyingState("invalid-reason", "slice-1");
		await writePawSessionState(repoRoot, invalidReasonState);
		await writeCurrentLock(repoRoot, "invalid-reason", 1_000);

		const invalidReason = await blockPawVerifierResult({
			repoRoot,
			sessionId: "invalid-reason",
			blockedReason: {
				code: "TEST_FAILURE",
				message: "",
				suggested_action: "",
			},
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(invalidReason.status).toBe("invalid_blocked_reason");
		if (invalidReason.status !== "invalid_blocked_reason") return;
		expect(invalidReason.issues).toEqual([
			{
				path: "/blocked_reason/message",
				message: "Verifier blocked reason message is required.",
			},
			{
				path: "/blocked_reason/suggested_action",
				message: "Verifier blocked reason suggested action is required.",
			},
		]);
		await expect(readPawSessionState(repoRoot, "invalid-reason")).resolves.toEqual(invalidReasonState);
	});
});
