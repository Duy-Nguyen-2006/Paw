import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { main } from "../src/main.ts";
import {
	createInitialPawSessionState,
	getPawSessionLockStatus,
	type PawSessionLock,
	type PawSessionState,
	readPawSessionState,
	resolvePawSessionPaths,
	transitionPawSessionState,
	writePawJsonAtomic,
	writePawSessionState,
} from "../src/paw/index.ts";
import { handlePawCommand } from "../src/paw/init-command.ts";
import {
	createPawSelectSliceCommandResult,
	formatPawSelectSliceCommandResult,
	parsePawSelectSliceArgs,
	runPawSelectSliceCommand,
} from "../src/paw/slice-selection-command.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");
const sourceConfigPath = join(repoRoot, "paw-spec", "config.yaml");
const tempRoots: string[] = [];

let originalCwd: string;
let originalExitCode: typeof process.exitCode;

async function createTempProject(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-slice-selection-command-"));
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

async function writeLock(repoRoot: string, sessionId: string, lock: PawSessionLock): Promise<void> {
	await writePawJsonAtomic(resolvePawSessionPaths(repoRoot, sessionId).lockFile, lock);
}

beforeEach(() => {
	originalCwd = process.cwd();
	originalExitCode = process.exitCode;
	process.exitCode = undefined;
});

afterEach(async () => {
	vi.restoreAllMocks();
	process.chdir(originalCwd);
	process.exitCode = originalExitCode;
	await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("parsePawSelectSliceArgs", () => {
	test("parses session id and reports validation errors without throwing", () => {
		expect(parsePawSelectSliceArgs(["session-1"])).toEqual({ kind: "ok", sessionId: "session-1" });
		expect(parsePawSelectSliceArgs([])).toEqual({
			kind: "error",
			message: 'Missing required session id for "paw select-slice".',
		});
		expect(parsePawSelectSliceArgs(["--slice", "x"])).toEqual({
			kind: "error",
			message: 'Missing required session id for "paw select-slice".',
		});
		expect(parsePawSelectSliceArgs(["-session"])).toEqual({
			kind: "error",
			message: 'Missing required session id for "paw select-slice".',
		});
		expect(parsePawSelectSliceArgs(["session-1", "extra"])).toEqual({
			kind: "error",
			message: 'Unknown option for "paw select-slice": extra',
		});
		expect(parsePawSelectSliceArgs(["session-1", "--bogus"])).toEqual({
			kind: "error",
			message: 'Unknown option for "paw select-slice": --bogus',
		});
		expect(parsePawSelectSliceArgs(["--help"])).toEqual({ kind: "help" });
	});
});

describe("Paw select-slice command", () => {
	test("advances PLAN_APPROVED to SLICE_SELECT with first pending slice and releases lock", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const state = createPlanApprovedState("session-1", ["slice-1", "slice-2"]);
		await writePawSessionState(projectRoot, state);

		const result = await createPawSelectSliceCommandResult(projectRoot, "session-1", {
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result.status).toBe("advanced");
		if (result.status !== "advanced") return;
		expect(result.selectedSliceId).toBe("slice-1");
		expect(result.previousStateName).toBe("PLAN_APPROVED");
		expect(result.nextStateName).toBe("SLICE_SELECT");
		expect(result.lockReleased).toBe(true);
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toEqual({
			...state,
			name: "SLICE_SELECT",
			current_slice_id: "slice-1",
			pending_slice_ids: ["slice-2"],
		});
		expect(await getPawSessionLockStatus(projectRoot, "session-1", { nowMs: 2_500 })).toEqual({
			status: "unlocked",
		});
		expect(formatPawSelectSliceCommandResult(result)).toContain("PLAN_APPROVED -> SLICE_SELECT");
	});

	test("returns no_pending_slices without mutating session and releases acquired lock", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const state: PawSessionState = {
			...createInitialPawSessionState("session-1"),
			name: "SLICE_DONE",
			completed_slice_ids: ["slice-1"],
		};
		await writePawSessionState(projectRoot, state);

		const result = await createPawSelectSliceCommandResult(projectRoot, "session-1", {
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result).toEqual({
			status: "no_pending_slices",
			sessionId: "session-1",
			previousStateName: "SLICE_DONE",
			lockReleased: true,
		});
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toEqual(state);
		expect(await getPawSessionLockStatus(projectRoot, "session-1", { nowMs: 2_500 })).toEqual({
			status: "unlocked",
		});
	});

	test("invalid source state does not mutate session and releases acquired lock", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const state: PawSessionState = {
			...createInitialPawSessionState("session-1"),
			name: "INTAKE",
			pending_slice_ids: ["slice-1"],
		};
		await writePawSessionState(projectRoot, state);

		const result = await createPawSelectSliceCommandResult(projectRoot, "session-1", {
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result.status).toBe("invalid_transition");
		if (result.status !== "invalid_transition") return;
		expect(result.previousStateName).toBe("INTAKE");
		expect(result.lockReleased).toBe(true);
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toEqual(state);
	});

	test("reports missing project or missing session without creating state", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);

		const missingProject = await createPawSelectSliceCommandResult(projectRoot, "missing", {
			lockOptions: { nowMs: 1_000 },
		});
		expect(missingProject).toEqual({ status: "missing_project", pawDir: ".paw" });
		expect(existsSync(join(projectRoot, ".paw"))).toBe(false);

		vi.spyOn(console, "log").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		const missingSession = await createPawSelectSliceCommandResult(projectRoot, "missing", {
			lockOptions: { nowMs: 1_000 },
		});
		expect(missingSession).toEqual({
			status: "missing_session",
			sessionId: "missing",
			stateFile: ".paw/sessions/missing/state.json",
		});
	});

	test("reports live foreign locks without releasing them", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const state = createPlanApprovedState("locked-session", ["slice-1"]);
		await writePawSessionState(projectRoot, state);
		const liveForeignLock: PawSessionLock = { pid: process.pid, host: "other-host", heartbeat_ts: 2_000, ttl: 120 };
		await writeLock(projectRoot, "locked-session", liveForeignLock);

		const locked = await createPawSelectSliceCommandResult(projectRoot, "locked-session", {
			lockOptions: { nowMs: 3_000, ttlSec: 120, host: hostname() },
		});

		expect(locked).toEqual({ status: "locked", sessionId: "locked-session", lock: liveForeignLock });
		await expect(readPawSessionState(projectRoot, "locked-session")).resolves.toEqual(state);
		expect(await getPawSessionLockStatus(projectRoot, "locked-session", { nowMs: 3_000 })).toEqual({
			status: "locked",
			lock: liveForeignLock,
		});
	});

	test("routes paw select-slice and validates command arguments", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createPlanApprovedState("session-1", ["slice-1"]));

		await expect(handlePawCommand(["paw", "select-slice", "session-1"])).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "select-slice"])).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "select-slice", "--help"])).resolves.toBe(true);

		const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
		const stderr = errorSpy.mock.calls.map(([message]) => String(message)).join("\n");
		expect(stdout).toContain("Paw select-slice");
		expect(stdout).toContain("SLICE_SELECT");
		expect(stdout).toContain("pi paw select-slice");
		expect(stderr).toContain('Missing required session id for "paw select-slice".');
		expect(process.exitCode).toBe(1);
	});

	test("main routes paw select-slice before normal agent runtime", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
			throw new Error(`process.exit(${code ?? ""})`);
		}) as typeof process.exit);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createPlanApprovedState("session-1", ["slice-1"]));

		await expect(main(["paw", "select-slice", "session-1"])).resolves.toBeUndefined();

		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toMatchObject({
			name: "SLICE_SELECT",
			current_slice_id: "slice-1",
		});
		expect(process.exitCode).toBeUndefined();
	});

	test("runPawSelectSliceCommand surfaces parser errors via exit code", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "error").mockImplementation(() => {});

		await runPawSelectSliceCommand([]);

		expect(process.exitCode).toBe(1);
	});
});
