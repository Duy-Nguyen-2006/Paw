import { mkdtemp, rm } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
	completePawVerification,
	type PawSessionLock,
	type PawSessionState,
	type PawVerifyGateDecision,
	readPawSessionState,
	resolvePawSessionPaths,
	writePawJsonAtomic,
	writePawSessionState,
} from "../src/paw/index.ts";

const tempRoots: string[] = [];

const verifiedUnitGate: PawVerifyGateDecision = {
	status: "verified",
	gate: "unit_tests",
	verified: true,
	applicable: true,
	gateSet: "v1",
};

const unverifiedLintGate: PawVerifyGateDecision = {
	status: "unverified",
	gate: "lint",
	verified: false,
	applicable: true,
	gateSet: "v1",
	reason: "lint command unavailable",
};

async function createTempRepo(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-verifier-result-"));
	tempRoots.push(root);
	return root;
}

function createVerifyingState(sessionId: string, sliceId = "slice-1"): PawSessionState {
	return {
		session_id: sessionId,
		name: "VERIFYING",
		current_slice_id: sliceId,
		pending_slice_ids: ["slice-2", "slice-3"],
		completed_slice_ids: ["slice-0"],
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

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("completePawVerification", () => {
	test("advances VERIFYING to SLICE_DONE with verified decisions under the current lock", async () => {
		const repoRoot = await createTempRepo();
		const state = createVerifyingState("session-1", "slice-1");
		await writePawSessionState(repoRoot, state);
		const lock = await writeCurrentLock(repoRoot, "session-1", 1_000);

		const result = await completePawVerification({
			repoRoot,
			sessionId: "session-1",
			verifyDecisions: [verifiedUnitGate],
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result.status).toBe("completed");
		if (result.status !== "completed") return;
		expect(result.lock).toEqual(lock);
		expect(result.previousState).toEqual(state);
		expect(result.nextState).toEqual({
			...state,
			name: "SLICE_DONE",
			current_slice_id: null,
			completed_slice_ids: ["slice-0", "slice-1"],
		});
		expect(result.verifyDecisions).toEqual([verifiedUnitGate]);
		expect(result.unverifiedDecisions).toEqual([]);
		await expect(readPawSessionState(repoRoot, "session-1")).resolves.toEqual(result.nextState);
	});

	test("advances with unverified decisions while preserving disclosure metadata", async () => {
		const repoRoot = await createTempRepo();
		const state = createVerifyingState("session-1", "slice-1");
		await writePawSessionState(repoRoot, state);
		await writeCurrentLock(repoRoot, "session-1", 1_000);

		const result = await completePawVerification({
			repoRoot,
			sessionId: "session-1",
			verifyDecisions: [verifiedUnitGate, unverifiedLintGate],
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result.status).toBe("completed_with_unverified");
		if (result.status !== "completed_with_unverified") return;
		expect(result.verifyDecisions).toEqual([verifiedUnitGate, unverifiedLintGate]);
		expect(result.unverifiedDecisions).toEqual([unverifiedLintGate]);
		expect(result.nextState.name).toBe("SLICE_DONE");
		await expect(readPawSessionState(repoRoot, "session-1")).resolves.toEqual(result.nextState);
	});

	test("returns invalid_verify_decisions without writing state when no decisions are supplied", async () => {
		const repoRoot = await createTempRepo();
		const state = createVerifyingState("session-1", "slice-1");
		await writePawSessionState(repoRoot, state);
		await writeCurrentLock(repoRoot, "session-1", 1_000);

		const result = await completePawVerification({
			repoRoot,
			sessionId: "session-1",
			verifyDecisions: [],
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result).toEqual({
			status: "invalid_verify_decisions",
			previousState: state,
			issues: [
				{
					path: "/verify_decisions",
					message: "Verification completion requires at least one gate decision.",
				},
			],
		});
		await expect(readPawSessionState(repoRoot, "session-1")).resolves.toEqual(state);
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

		const missing = await completePawVerification({
			repoRoot,
			sessionId: "missing-lock",
			verifyDecisions: [verifiedUnitGate],
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});
		const stale = await completePawVerification({
			repoRoot,
			sessionId: "stale-lock",
			verifyDecisions: [verifiedUnitGate],
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

		const result = await completePawVerification({
			repoRoot,
			sessionId: "session-1",
			verifyDecisions: [verifiedUnitGate],
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

		const wrong = await completePawVerification({
			repoRoot,
			sessionId: "wrong-state",
			verifyDecisions: [verifiedUnitGate],
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});
		const noSlice = await completePawVerification({
			repoRoot,
			sessionId: "no-slice",
			verifyDecisions: [verifiedUnitGate],
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(wrong.status).toBe("invalid_state");
		if (wrong.status !== "invalid_state") return;
		expect(wrong.previousState).toEqual(wrongState);
		expect(wrong.issues).toEqual([
			{
				path: "/name",
				message: "Verification completion requires VERIFYING state.",
			},
		]);
		expect(noSlice.status).toBe("no_selected_slice");
		if (noSlice.status !== "no_selected_slice") return;
		expect(noSlice.previousState).toEqual(noSliceState);
		await expect(readPawSessionState(repoRoot, "wrong-state")).resolves.toEqual(wrongState);
		await expect(readPawSessionState(repoRoot, "no-slice")).resolves.toEqual(noSliceState);
	});
});
