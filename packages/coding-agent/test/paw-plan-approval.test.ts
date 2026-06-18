
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import {
	approvePawPlanSlices,
	createInitialPawSessionState,
	type PawSessionLock,
	type PawSessionState,
	readPawSessionState,
	resolvePawSessionPaths,
	transitionPawSessionState,
	writePawJsonAtomic,
	writePawSessionState,
} from "../src/paw/index.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");
const sourceConfigPath = join(repoRoot, "paw-spec", "config.yaml");
const tempRoots: string[] = [];

async function createTempProject(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-plan-approval-"));
	tempRoots.push(root);
	await mkdir(join(root, "paw-spec"), { recursive: true });
	await writeFile(join(root, "paw-spec", "config.yaml"), await readFile(sourceConfigPath, "utf-8"), "utf-8");
	return root;
}

function createPlanDraftedState(sessionId: string): PawSessionState {
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

describe("approvePawPlanSlices", () => {
	test("persists ordered pending slice ids from PLAN_DRAFTED when the caller owns the lock", async () => {
		const projectRoot = await createTempProject();
		const state = createPlanDraftedState("session-1");
		await writePawSessionState(projectRoot, state);
		const lock = await writeCurrentLock(projectRoot, "session-1", 1_000);

		const result = await approvePawPlanSlices({
			repoRoot: projectRoot,
			sessionId: "session-1",
			plannerSlices: [
				{ slice_id: "slice-2", title: "Second slice", order: 1 },
				{ slice_id: "slice-1", title: "First slice", order: 0 },
			],
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result.status).toBe("advanced");
		if (result.status !== "advanced") return;
		expect(result.queue.slice_ids).toEqual(["slice-1", "slice-2"]);
		expect(result.advance.lock).toEqual(lock);
		expect(result.advance.previousState).toEqual(state);
		expect(result.advance.nextState).toEqual({
			...state,
			name: "PLAN_APPROVED",
			pending_slice_ids: ["slice-1", "slice-2"],
		});
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toEqual(result.advance.nextState);
	});

	test("returns invalid_plan without writing state for invalid planner slices", async () => {
		const projectRoot = await createTempProject();
		const state = createPlanDraftedState("session-1");
		await writePawSessionState(projectRoot, state);
		await writeCurrentLock(projectRoot, "session-1", 1_000);

		const result = await approvePawPlanSlices({
			repoRoot: projectRoot,
			sessionId: "session-1",
			plannerSlices: [],
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result).toEqual({
			status: "invalid_plan",
			issues: [{ path: "/", message: "Planner slice input must be a non-empty array." }],
		});
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toEqual(state);
	});

	test("propagates a missing-lock result without writing state", async () => {
		const projectRoot = await createTempProject();
		const state = createPlanDraftedState("session-1");
		await writePawSessionState(projectRoot, state);

		const result = await approvePawPlanSlices({
			repoRoot: projectRoot,
			sessionId: "session-1",
			plannerSlices: [{ slice_id: "slice-1", title: "First slice", order: 0 }],
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result.status).toBe("not_locked");
		if (result.status !== "not_locked") return;
		expect(result.queue.slice_ids).toEqual(["slice-1"]);
		expect(result.advance).toEqual({ status: "not_locked", reason: "unlocked" });
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toEqual(state);
	});

	test("returns invalid_transition from the wrong source state without writing state", async () => {
		const projectRoot = await createTempProject();
		const state: PawSessionState = {
			...createInitialPawSessionState("session-1"),
			name: "INTAKE",
		};
		await writePawSessionState(projectRoot, state);
		await writeCurrentLock(projectRoot, "session-1", 1_000);

		const result = await approvePawPlanSlices({
			repoRoot: projectRoot,
			sessionId: "session-1",
			plannerSlices: [{ slice_id: "slice-1", title: "First slice", order: 0 }],
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result.status).toBe("invalid_transition");
		if (result.status !== "invalid_transition") return;
		expect(result.queue.slice_ids).toEqual(["slice-1"]);
		expect(result.advance.previousState).toEqual(state);
		expect(result.advance.issues).toEqual([
			{
				path: "/transition/to",
				message: "Cannot transition from INTAKE to PLAN_APPROVED.",
			},
		]);
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toEqual(state);
		expect(existsSync(resolvePawSessionPaths(projectRoot, "session-1").stateFile)).toBe(true);
	});
});
