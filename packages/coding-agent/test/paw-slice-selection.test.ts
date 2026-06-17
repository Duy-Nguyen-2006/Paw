import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import {
	createInitialPawSessionState,
	type PawSessionLock,
	type PawSessionState,
	readPawSessionState,
	resolvePawSessionPaths,
	selectNextPawPlanSlice,
	transitionPawSessionState,
	writePawJsonAtomic,
	writePawSessionState,
} from "../src/paw/index.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");
const sourceConfigPath = join(repoRoot, "paw-spec", "config.yaml");
const tempRoots: string[] = [];

async function createTempProject(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-slice-selection-"));
	tempRoots.push(root);
	await mkdir(join(root, "paw-spec"), { recursive: true });
	await writeFile(join(root, "paw-spec", "config.yaml"), await readFile(sourceConfigPath, "utf-8"), "utf-8");
	return root;
}

function createPlanApprovedState(sessionId: string, sliceIds: readonly string[]): PawSessionState {
	let state = createInitialPawSessionState(sessionId);

	for (const next of [
		"INTAKE",
		"CLASSIFYING",
		"CLARIFYING",
		"SPEC_DRAFTED",
		"SPEC_APPROVED",
		"SCOUTING",
		"PLAN_DRAFTED",
	] as const) {
		const result = transitionPawSessionState(state, { to: next });
		expect(result.ok).toBe(true);
		if (result.ok) {
			state = result.value;
		}
	}

	const approved = transitionPawSessionState(state, { to: "PLAN_APPROVED", slice_ids: sliceIds });
	expect(approved.ok).toBe(true);
	if (approved.ok) {
		state = approved.value;
	}
	return state;
}

async function writeCurrentLock(repoRootInput: string, sessionId: string, nowMs: number): Promise<PawSessionLock> {
	const lock: PawSessionLock = {
		pid: process.pid,
		host: hostname(),
		heartbeat_ts: nowMs,
		ttl: 120,
	};
	await writePawJsonAtomic(resolvePawSessionPaths(repoRootInput, sessionId).lockFile, lock);
	return lock;
}

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("selectNextPawPlanSlice", () => {
	test("persists the first pending slice after plan approval when the caller owns the lock", async () => {
		const projectRoot = await createTempProject();
		const state = createPlanApprovedState("session-1", ["slice-1", "slice-2"]);
		await writePawSessionState(projectRoot, state);
		const lock = await writeCurrentLock(projectRoot, "session-1", 1_000);

		const result = await selectNextPawPlanSlice({
			repoRoot: projectRoot,
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
			name: "SLICE_SELECT",
			current_slice_id: "slice-1",
			pending_slice_ids: ["slice-2"],
		});
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toEqual(result.advance.nextState);
	});

	test("selects the next pending slice after SLICE_DONE without clearing completed slices", async () => {
		const projectRoot = await createTempProject();
		const state: PawSessionState = {
			...createInitialPawSessionState("session-1"),
			name: "SLICE_DONE",
			pending_slice_ids: ["slice-2", "slice-3"],
			completed_slice_ids: ["slice-1"],
		};
		await writePawSessionState(projectRoot, state);
		await writeCurrentLock(projectRoot, "session-1", 1_000);

		const result = await selectNextPawPlanSlice({
			repoRoot: projectRoot,
			sessionId: "session-1",
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result.status).toBe("advanced");
		if (result.status !== "advanced") return;
		expect(result.selectedSliceId).toBe("slice-2");
		expect(result.advance.nextState).toEqual({
			...state,
			name: "SLICE_SELECT",
			current_slice_id: "slice-2",
			pending_slice_ids: ["slice-3"],
			completed_slice_ids: ["slice-1"],
		});
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toEqual(result.advance.nextState);
	});

	test("returns no_pending_slices without writing state when no slice is queued", async () => {
		const projectRoot = await createTempProject();
		const state: PawSessionState = {
			...createInitialPawSessionState("session-1"),
			name: "SLICE_DONE",
			completed_slice_ids: ["slice-1"],
		};
		await writePawSessionState(projectRoot, state);
		await writeCurrentLock(projectRoot, "session-1", 1_000);

		const result = await selectNextPawPlanSlice({
			repoRoot: projectRoot,
			sessionId: "session-1",
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result).toEqual({
			status: "no_pending_slices",
			previousState: state,
		});
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toEqual(state);
	});

	test("propagates a missing-lock result without writing state", async () => {
		const projectRoot = await createTempProject();
		const state = createPlanApprovedState("session-1", ["slice-1"]);
		await writePawSessionState(projectRoot, state);

		const result = await selectNextPawPlanSlice({
			repoRoot: projectRoot,
			sessionId: "session-1",
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result).toEqual({
			status: "not_locked",
			advance: { status: "not_locked", reason: "unlocked" },
		});
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toEqual(state);
	});

	test("propagates stale and foreign lock results without writing state", async () => {
		const projectRoot = await createTempProject();
		const staleLockState = createPlanApprovedState("stale-lock", ["slice-1"]);
		const otherOwnerState = createPlanApprovedState("other-owner", ["slice-1"]);
		await writePawSessionState(projectRoot, staleLockState);
		await writePawSessionState(projectRoot, otherOwnerState);

		const staleLock: PawSessionLock = {
			pid: process.pid,
			host: hostname(),
			heartbeat_ts: 1_000,
			ttl: 1,
		};
		await writePawJsonAtomic(resolvePawSessionPaths(projectRoot, "stale-lock").lockFile, staleLock);

		const otherOwnerLock: PawSessionLock = {
			pid: process.pid,
			host: "other-host",
			heartbeat_ts: 1_000,
			ttl: 120,
		};
		await writePawJsonAtomic(resolvePawSessionPaths(projectRoot, "other-owner").lockFile, otherOwnerLock);

		const stale = await selectNextPawPlanSlice({
			repoRoot: projectRoot,
			sessionId: "stale-lock",
			lockOptions: { nowMs: 2_001, ttlSec: 120 },
		});
		const otherOwner = await selectNextPawPlanSlice({
			repoRoot: projectRoot,
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
		await expect(readPawSessionState(projectRoot, "stale-lock")).resolves.toEqual(staleLockState);
		await expect(readPawSessionState(projectRoot, "other-owner")).resolves.toEqual(otherOwnerState);
	});

	test("propagates invalid transitions without writing state", async () => {
		const projectRoot = await createTempProject();
		const state: PawSessionState = {
			...createInitialPawSessionState("session-1"),
			name: "INTAKE",
			pending_slice_ids: ["slice-1"],
		};
		await writePawSessionState(projectRoot, state);
		await writeCurrentLock(projectRoot, "session-1", 1_000);

		const result = await selectNextPawPlanSlice({
			repoRoot: projectRoot,
			sessionId: "session-1",
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result.status).toBe("invalid_transition");
		if (result.status !== "invalid_transition") return;
		expect(result.advance.previousState).toEqual(state);
		expect(result.advance.issues).toEqual([
			{
				path: "/transition/to",
				message: "Cannot transition from INTAKE to SLICE_SELECT.",
			},
		]);
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toEqual(state);
	});
});
