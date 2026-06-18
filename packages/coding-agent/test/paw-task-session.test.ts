
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import {
	advancePawTaskSession,
	createInitialPawSessionState,
	type PawSessionLock,
	type PawSessionState,
	readPawSessionState,
	resolvePawSessionPaths,
	startPawTaskSession,
	transitionPawSessionState,
	writePawJsonAtomic,
	writePawSessionState,
} from "../src/paw/index.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");
const sourceConfigPath = join(repoRoot, "paw-spec", "config.yaml");
const tempRoots: string[] = [];

async function createTempProject(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-task-session-"));
	tempRoots.push(root);
	await mkdir(join(root, "paw-spec"), { recursive: true });
	await writeFile(join(root, "paw-spec", "config.yaml"), await readFile(sourceConfigPath, "utf-8"), "utf-8");
	return root;
}

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Paw task session start", () => {
	test("initializes Paw, acquires the lock, creates state, and starts intake", async () => {
		const projectRoot = await createTempProject();

		const result = await startPawTaskSession({
			repoRoot: projectRoot,
			sessionId: "session-1",
			lockOptions: { nowMs: 1_000, ttlSec: 120 },
		});

		expect(result.status).toBe("started");
		if (result.status !== "started") return;
		expect(result.state).toEqual({
			session_id: "session-1",
			name: "INTAKE",
			current_slice_id: null,
			pending_slice_ids: [],
			completed_slice_ids: [],
			blocked_reason: null,
		});
		expect(result.lock).toEqual({
			pid: process.pid,
			host: hostname(),
			heartbeat_ts: 1_000,
			ttl: 120,
		});
		expect(result.reclaimed).toBeNull();
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toEqual(result.state);
		expect(existsSync(join(projectRoot, ".paw", "config.yaml"))).toBe(true);
	});

	test("resumes an existing valid session without overwriting state", async () => {
		const projectRoot = await createTempProject();
		const classified = transitionPawSessionState(createInitialPawSessionState("session-1"), { to: "INTAKE" });
		expect(classified.ok).toBe(true);
		if (!classified.ok) return;
		const existing = transitionPawSessionState(classified.value, { to: "CLASSIFYING" });
		expect(existing.ok).toBe(true);
		if (!existing.ok) return;
		await writePawSessionState(projectRoot, existing.value);

		const result = await startPawTaskSession({
			repoRoot: projectRoot,
			sessionId: "session-1",
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result.status).toBe("existing");
		if (result.status !== "existing") return;
		expect(result.state).toEqual(existing.value);
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toEqual(existing.value);
	});

	test("returns locked for a live lock without writing state", async () => {
		const projectRoot = await createTempProject();
		const first = await startPawTaskSession({
			repoRoot: projectRoot,
			sessionId: "session-1",
			lockOptions: { nowMs: 1_000, ttlSec: 120 },
		});
		expect(first.status).toBe("started");
		const paths = resolvePawSessionPaths(projectRoot, "session-2");
		const liveLock: PawSessionLock = {
			pid: process.pid,
			host: hostname(),
			heartbeat_ts: 3_000,
			ttl: 120,
		};
		await writePawJsonAtomic(paths.lockFile, liveLock);

		const result = await startPawTaskSession({
			repoRoot: projectRoot,
			sessionId: "session-2",
			lockOptions: { nowMs: 4_000, ttlSec: 120 },
		});

		expect(result).toMatchObject({
			status: "locked",
			lock: liveLock,
		});
		expect(existsSync(paths.stateFile)).toBe(false);
	});

	test("reclaims a stale lock and starts a missing session", async () => {
		const projectRoot = await createTempProject();
		const paths = resolvePawSessionPaths(projectRoot, "session-1");
		const expiredLock: PawSessionLock = {
			pid: process.pid,
			host: hostname(),
			heartbeat_ts: 1_000,
			ttl: 1,
		};
		await writePawJsonAtomic(paths.lockFile, expiredLock);

		const result = await startPawTaskSession({
			repoRoot: projectRoot,
			sessionId: "session-1",
			lockOptions: { nowMs: 2_001, ttlSec: 120 },
		});

		expect(result.status).toBe("started");
		if (result.status !== "started") return;
		expect(result.reclaimed).toEqual({
			reason: "expired_heartbeat",
			lock: expiredLock,
		});
		expect(result.state.name).toBe("INTAKE");
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toEqual(result.state);
	});

	test("throws a useful error for malformed existing state", async () => {
		const projectRoot = await createTempProject();
		const paths = resolvePawSessionPaths(projectRoot, "session-1");
		await mkdir(paths.sessionDir, { recursive: true });
		await writeFile(paths.stateFile, "{ not json\n", "utf-8");

		await expect(
			startPawTaskSession({
				repoRoot: projectRoot,
				sessionId: "session-1",
				lockOptions: { nowMs: 1_000, ttlSec: 120 },
			}),
		).rejects.toThrow(`Invalid existing Paw session state at ${paths.stateFile}`);
	});
});

describe("Paw task session advance", () => {
	test("persists a valid transition when the current process owns the lock", async () => {
		const projectRoot = await createTempProject();
		const started = await startPawTaskSession({
			repoRoot: projectRoot,
			sessionId: "session-1",
			lockOptions: { nowMs: 1_000, ttlSec: 120 },
		});
		expect(started.status).toBe("started");
		if (started.status !== "started") return;

		const result = await advancePawTaskSession({
			repoRoot: projectRoot,
			sessionId: "session-1",
			transition: { to: "CLASSIFYING" },
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result.status).toBe("advanced");
		if (result.status !== "advanced") return;
		expect(result.previousState).toEqual(started.state);
		expect(result.nextState).toEqual({
			...started.state,
			name: "CLASSIFYING",
		});
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toEqual(result.nextState);
	});

	test("returns invalid_transition without writing state", async () => {
		const projectRoot = await createTempProject();
		const started = await startPawTaskSession({
			repoRoot: projectRoot,
			sessionId: "session-1",
			lockOptions: { nowMs: 1_000, ttlSec: 120 },
		});
		expect(started.status).toBe("started");
		if (started.status !== "started") return;

		const result = await advancePawTaskSession({
			repoRoot: projectRoot,
			sessionId: "session-1",
			transition: { to: "VERIFYING" },
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result.status).toBe("invalid_transition");
		if (result.status !== "invalid_transition") return;
		expect(result.previousState).toEqual(started.state);
		expect(result.issues).toEqual([
			{
				path: "/transition/to",
				message: "Cannot transition from INTAKE to VERIFYING.",
			},
		]);
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toEqual(started.state);
	});

	test("does not write when the lock is missing, stale, or owned by another process", async () => {
		const projectRoot = await createTempProject();
		const missingLockState: PawSessionState = {
			...createInitialPawSessionState("missing-lock"),
			name: "INTAKE",
		};
		const staleLockState: PawSessionState = {
			...createInitialPawSessionState("stale-lock"),
			name: "INTAKE",
		};
		const otherOwnerState: PawSessionState = {
			...createInitialPawSessionState("other-owner"),
			name: "INTAKE",
		};
		await writePawSessionState(projectRoot, missingLockState);
		await writePawSessionState(projectRoot, staleLockState);
		await writePawSessionState(projectRoot, otherOwnerState);

		const stalePaths = resolvePawSessionPaths(projectRoot, "stale-lock");
		const staleLock: PawSessionLock = {
			pid: process.pid,
			host: hostname(),
			heartbeat_ts: 1_000,
			ttl: 1,
		};
		await writePawJsonAtomic(stalePaths.lockFile, staleLock);

		const otherOwnerPaths = resolvePawSessionPaths(projectRoot, "other-owner");
		const otherOwnerLock: PawSessionLock = {
			pid: process.pid,
			host: "other-host",
			heartbeat_ts: 1_000,
			ttl: 120,
		};
		await writePawJsonAtomic(otherOwnerPaths.lockFile, otherOwnerLock);

		const missingLock = await advancePawTaskSession({
			repoRoot: projectRoot,
			sessionId: "missing-lock",
			transition: { to: "CLASSIFYING" },
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});
		const stale = await advancePawTaskSession({
			repoRoot: projectRoot,
			sessionId: "stale-lock",
			transition: { to: "CLASSIFYING" },
			lockOptions: { nowMs: 2_001, ttlSec: 120 },
		});
		const otherOwner = await advancePawTaskSession({
			repoRoot: projectRoot,
			sessionId: "other-owner",
			transition: { to: "CLASSIFYING" },
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(missingLock).toEqual({ status: "not_locked", reason: "unlocked" });
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
		await expect(readPawSessionState(projectRoot, "missing-lock")).resolves.toEqual(missingLockState);
		await expect(readPawSessionState(projectRoot, "stale-lock")).resolves.toEqual(staleLockState);
		await expect(readPawSessionState(projectRoot, "other-owner")).resolves.toEqual(otherOwnerState);
	});

	test("persists blocked transitions and exact resume transitions under the current lock", async () => {
		const projectRoot = await createTempProject();
		const state: PawSessionState = {
			...createInitialPawSessionState("session-1"),
			name: "VERIFYING",
			current_slice_id: "slice-1",
			pending_slice_ids: ["slice-2"],
		};
		await writePawSessionState(projectRoot, state);
		await writePawJsonAtomic(resolvePawSessionPaths(projectRoot, "session-1").lockFile, {
			pid: process.pid,
			host: hostname(),
			heartbeat_ts: 1_000,
			ttl: 120,
		});

		const blocked = await advancePawTaskSession({
			repoRoot: projectRoot,
			sessionId: "session-1",
			transition: {
				to: "BLOCKED_TEST_FAILURE",
				blocked_reason: {
					message: "Unit test failed.",
					suggested_action: "Fix the failing test and resume verification.",
				},
			},
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});
		expect(blocked.status).toBe("advanced");
		if (blocked.status !== "advanced") return;
		expect(blocked.nextState.blocked_reason).toEqual({
			code: "TEST_FAILURE",
			message: "Unit test failed.",
			suggested_action: "Fix the failing test and resume verification.",
			slice_id: "slice-1",
			resume_state: "VERIFYING",
		});
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toEqual(blocked.nextState);

		const resumed = await advancePawTaskSession({
			repoRoot: projectRoot,
			sessionId: "session-1",
			transition: { to: "VERIFYING" },
			lockOptions: { nowMs: 3_000, ttlSec: 120 },
		});

		expect(resumed.status).toBe("advanced");
		if (resumed.status !== "advanced") return;
		expect(resumed.previousState).toEqual(blocked.nextState);
		expect(resumed.nextState).toEqual({
			...blocked.nextState,
			name: "VERIFYING",
			blocked_reason: null,
		});
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toEqual(resumed.nextState);
	});
});
