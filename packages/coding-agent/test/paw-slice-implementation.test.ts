
import { mkdtemp, rm } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
	beginPawSliceImplementation,
	type PawSessionLock,
	type PawSessionState,
	readPawSessionState,
	resolvePawSessionPaths,
	writePawJsonAtomic,
	writePawSessionState,
} from "../src/paw/index.ts";

const tempRoots: string[] = [];

async function createTempRepo(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-slice-implementation-"));
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

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("beginPawSliceImplementation", () => {
	test("advances the selected slice into IMPLEMENTING under the current lock", async () => {
		const repoRoot = await createTempRepo();
		const state: PawSessionState = {
			...createSelectedSliceState("session-1", "slice-1"),
			pending_slice_ids: ["slice-2", "slice-3"],
			completed_slice_ids: ["slice-0"],
		};
		await writePawSessionState(repoRoot, state);
		const lock = await writeCurrentLock(repoRoot, "session-1", 1_000);

		const result = await beginPawSliceImplementation({
			repoRoot,
			sessionId: "session-1",
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result.status).toBe("advanced");
		if (result.status !== "advanced") return;
		expect(result.selectedSliceId).toBe("slice-1");
		expect(result.advance.lock).toEqual(lock);
		expect(result.advance.previousState).toEqual(state);
		expect(result.advance.nextState).toEqual({
			...state,
			name: "IMPLEMENTING",
			current_slice_id: "slice-1",
			pending_slice_ids: ["slice-2", "slice-3"],
			completed_slice_ids: ["slice-0"],
		});
		await expect(readPawSessionState(repoRoot, "session-1")).resolves.toEqual(result.advance.nextState);
	});

	test("propagates a missing lock without writing state", async () => {
		const repoRoot = await createTempRepo();
		const state = createSelectedSliceState("session-1", "slice-1");
		await writePawSessionState(repoRoot, state);

		const result = await beginPawSliceImplementation({
			repoRoot,
			sessionId: "session-1",
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result).toEqual({
			status: "not_locked",
			advance: { status: "not_locked", reason: "unlocked" },
		});
		await expect(readPawSessionState(repoRoot, "session-1")).resolves.toEqual(state);
	});

	test("propagates stale and foreign locks without writing state", async () => {
		const repoRoot = await createTempRepo();
		const staleLockState = createSelectedSliceState("stale-lock", "slice-1");
		const otherOwnerState = createSelectedSliceState("other-owner", "slice-1");
		await writePawSessionState(repoRoot, staleLockState);
		await writePawSessionState(repoRoot, otherOwnerState);

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

		const stale = await beginPawSliceImplementation({
			repoRoot,
			sessionId: "stale-lock",
			lockOptions: { nowMs: 2_001, ttlSec: 120 },
		});
		const otherOwner = await beginPawSliceImplementation({
			repoRoot,
			sessionId: "other-owner",
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(stale).toEqual({
			status: "not_locked",
			advance: {
				status: "not_locked",
				reason: "stale",
				staleReason: "expired_heartbeat",
				lock: staleLock,
			},
		});
		expect(otherOwner).toEqual({
			status: "locked_by_other",
			advance: {
				status: "locked_by_other",
				lock: otherOwnerLock,
				expectedOwner: {
					pid: process.pid,
					host: hostname(),
				},
			},
		});
		await expect(readPawSessionState(repoRoot, "stale-lock")).resolves.toEqual(staleLockState);
		await expect(readPawSessionState(repoRoot, "other-owner")).resolves.toEqual(otherOwnerState);
	});

	test("returns no_selected_slice without writing state when SLICE_SELECT has no current slice", async () => {
		const repoRoot = await createTempRepo();
		const state: PawSessionState = {
			...createSelectedSliceState("session-1", "slice-1"),
			current_slice_id: null,
		};
		await writePawSessionState(repoRoot, state);
		await writeCurrentLock(repoRoot, "session-1", 1_000);

		const result = await beginPawSliceImplementation({
			repoRoot,
			sessionId: "session-1",
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result.status).toBe("no_selected_slice");
		if (result.status !== "no_selected_slice") return;
		expect(result.previousState).toEqual(state);
		expect(result.advance.issues).toEqual([
			{
				path: "/current_slice_id",
				message: "IMPLEMENTING requires a current slice.",
			},
		]);
		await expect(readPawSessionState(repoRoot, "session-1")).resolves.toEqual(state);
	});

	test("propagates invalid source states without writing state", async () => {
		const repoRoot = await createTempRepo();
		const planApprovedState: PawSessionState = {
			session_id: "plan-approved",
			name: "PLAN_APPROVED",
			current_slice_id: null,
			pending_slice_ids: ["slice-1"],
			completed_slice_ids: [],
			blocked_reason: null,
		};
		const intakeState: PawSessionState = {
			session_id: "intake",
			name: "INTAKE",
			current_slice_id: null,
			pending_slice_ids: [],
			completed_slice_ids: [],
			blocked_reason: null,
		};
		await writePawSessionState(repoRoot, planApprovedState);
		await writePawSessionState(repoRoot, intakeState);
		await writeCurrentLock(repoRoot, "plan-approved", 1_000);
		await writeCurrentLock(repoRoot, "intake", 1_000);

		const planApproved = await beginPawSliceImplementation({
			repoRoot,
			sessionId: "plan-approved",
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});
		const intake = await beginPawSliceImplementation({
			repoRoot,
			sessionId: "intake",
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(planApproved.status).toBe("invalid_transition");
		if (planApproved.status !== "invalid_transition") return;
		expect(planApproved.advance.previousState).toEqual(planApprovedState);
		expect(planApproved.advance.issues).toEqual([
			{
				path: "/transition/to",
				message: "Cannot transition from PLAN_APPROVED to IMPLEMENTING.",
			},
		]);
		expect(intake.status).toBe("invalid_transition");
		if (intake.status !== "invalid_transition") return;
		expect(intake.advance.previousState).toEqual(intakeState);
		expect(intake.advance.issues).toEqual([
			{
				path: "/transition/to",
				message: "Cannot transition from INTAKE to IMPLEMENTING.",
			},
		]);
		await expect(readPawSessionState(repoRoot, "plan-approved")).resolves.toEqual(planApprovedState);
		await expect(readPawSessionState(repoRoot, "intake")).resolves.toEqual(intakeState);
	});
});
