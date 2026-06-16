import { mkdtemp, readFile, rm } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
	acquirePawSessionLock,
	createInitialPawSessionState,
	getPawSessionLockStatus,
	type PawSessionLock,
	readPawSessionState,
	refreshPawSessionLockHeartbeat,
	releasePawSessionLock,
	resolvePawSessionPaths,
	writePawJsonAtomic,
	writePawSessionState,
} from "../src/paw/index.ts";

const tempRoots: string[] = [];

async function createTempRepo(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-session-store-"));
	tempRoots.push(root);
	return root;
}

function deadPid(): number {
	for (const pid of [999_999, 888_888, 777_777, 666_666]) {
		try {
			process.kill(pid, 0);
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ESRCH") {
				return pid;
			}
		}
	}

	throw new Error("Could not find an unused PID for the dead PID lock test.");
}

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Paw session store", () => {
	test("rejects session ids that are not safe path segments", async () => {
		const repoRoot = await createTempRepo();

		expect(() => resolvePawSessionPaths(repoRoot, "../escape")).toThrow(
			"Paw session id must be non-empty, contain only alphanumeric characters",
		);
		expect(() => resolvePawSessionPaths(repoRoot, "session one")).toThrow(
			"Paw session id must be non-empty, contain only alphanumeric characters",
		);
	});

	test("writes and reads validated session state under .paw/sessions/<id>", async () => {
		const repoRoot = await createTempRepo();
		const state = {
			...createInitialPawSessionState("session-1"),
			name: "PLAN_APPROVED" as const,
			pending_slice_ids: ["slice-1"],
		};
		const paths = resolvePawSessionPaths(repoRoot, state.session_id);

		await writePawSessionState(repoRoot, state);

		await expect(readPawSessionState(repoRoot, state.session_id)).resolves.toEqual(state);
		expect(JSON.parse(await readFile(paths.stateFile, "utf-8"))).toEqual(state);
		expect(paths.sessionDir).toBe(join(repoRoot, ".paw", "sessions", "session-1"));
	});

	test("blocks non-waiting acquisition when a live fresh lock exists", async () => {
		const repoRoot = await createTempRepo();

		const first = await acquirePawSessionLock(repoRoot, "session-1", { nowMs: 1_000, ttlSec: 120 });
		expect(first.acquired).toBe(true);

		const second = await acquirePawSessionLock(repoRoot, "session-1", { nowMs: 2_000, ttlSec: 120 });

		expect(second).toEqual({
			acquired: false,
			reason: "live_lock",
			lock: {
				pid: process.pid,
				host: hostname(),
				heartbeat_ts: 1_000,
				ttl: 120,
			},
		});
	});

	test("reclaims a lock whose heartbeat has expired", async () => {
		const repoRoot = await createTempRepo();
		const paths = resolvePawSessionPaths(repoRoot, "session-1");
		const expiredLock: PawSessionLock = {
			pid: process.pid,
			host: hostname(),
			heartbeat_ts: 1_000,
			ttl: 1,
		};
		await writePawJsonAtomic(paths.lockFile, expiredLock);

		const result = await acquirePawSessionLock(repoRoot, "session-1", { nowMs: 2_001, ttlSec: 120 });

		expect(result.acquired).toBe(true);
		if (!result.acquired) return;
		expect(result.reclaimed).toEqual({
			reason: "expired_heartbeat",
			lock: expiredLock,
		});
		expect(result.lock).toEqual({
			pid: process.pid,
			host: hostname(),
			heartbeat_ts: 2_001,
			ttl: 120,
		});
	});

	test("reclaims a lock whose owning PID is dead", async () => {
		const repoRoot = await createTempRepo();
		const paths = resolvePawSessionPaths(repoRoot, "session-1");
		const abandonedLock: PawSessionLock = {
			pid: deadPid(),
			host: hostname(),
			heartbeat_ts: 1_000,
			ttl: 120,
		};
		await writePawJsonAtomic(paths.lockFile, abandonedLock);

		const result = await acquirePawSessionLock(repoRoot, "session-1", { nowMs: 2_000, ttlSec: 120 });

		expect(result.acquired).toBe(true);
		if (!result.acquired) return;
		expect(result.reclaimed).toEqual({
			reason: "dead_pid",
			lock: abandonedLock,
		});
	});

	test("refreshes the heartbeat for the current lock owner", async () => {
		const repoRoot = await createTempRepo();
		const paths = resolvePawSessionPaths(repoRoot, "session-1");
		await acquirePawSessionLock(repoRoot, "session-1", { nowMs: 1_000, ttlSec: 120 });

		const refreshed = await refreshPawSessionLockHeartbeat(repoRoot, "session-1", { nowMs: 5_000 });

		expect(refreshed).toEqual({
			pid: process.pid,
			host: hostname(),
			heartbeat_ts: 5_000,
			ttl: 120,
		});
		expect(JSON.parse(await readFile(paths.lockFile, "utf-8"))).toEqual(refreshed);
	});

	test("releases the current lock owner and reports unlocked status", async () => {
		const repoRoot = await createTempRepo();
		await acquirePawSessionLock(repoRoot, "session-1", { nowMs: 1_000, ttlSec: 120 });

		await expect(releasePawSessionLock(repoRoot, "session-1")).resolves.toBe(true);
		await expect(getPawSessionLockStatus(repoRoot, "session-1")).resolves.toEqual({ status: "unlocked" });
		await expect(releasePawSessionLock(repoRoot, "session-1")).resolves.toBe(false);
	});
});
