
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { main } from "../src/main.ts";
import {
	getPawSessionLockStatus,
	type PawSessionLock,
	type PawSessionState,
	readPawSessionState,
	resolvePawSessionPaths,
	writePawJsonAtomic,
	writePawSessionState,
} from "../src/paw/index.ts";
import { handlePawCommand } from "../src/paw/init-command.ts";
import {
	createPawBeginImplementationCommandResult,
	formatPawBeginImplementationCommandResult,
	parsePawBeginImplementationArgs,
	runPawBeginImplementationCommand,
} from "../src/paw/slice-implementation-command.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");
const sourceConfigPath = join(repoRoot, "paw-spec", "config.yaml");
const tempRoots: string[] = [];

let originalCwd: string;
let originalExitCode: typeof process.exitCode;

async function createTempProject(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-slice-implementation-command-"));
	tempRoots.push(root);
	await mkdir(join(root, "paw-spec"), { recursive: true });
	await writeFile(join(root, "paw-spec", "config.yaml"), await readFile(sourceConfigPath, "utf-8"), "utf-8");
	return root;
}

function createSliceSelectState(sessionId: string, sliceId = "slice-1"): PawSessionState {
	return {
		session_id: sessionId,
		name: "SLICE_SELECT",
		current_slice_id: sliceId,
		pending_slice_ids: ["slice-2"],
		completed_slice_ids: [],
		blocked_reason: null,
	};
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

describe("parsePawBeginImplementationArgs", () => {
	test("parses session id and reports validation errors without throwing", () => {
		expect(parsePawBeginImplementationArgs(["session-1"])).toEqual({ kind: "ok", sessionId: "session-1" });
		expect(parsePawBeginImplementationArgs([])).toEqual({
			kind: "error",
			message: 'Missing required session id for "paw begin-implementation".',
		});
		expect(parsePawBeginImplementationArgs(["--slice", "x"])).toEqual({
			kind: "error",
			message: 'Missing required session id for "paw begin-implementation".',
		});
		expect(parsePawBeginImplementationArgs(["-session"])).toEqual({
			kind: "error",
			message: 'Missing required session id for "paw begin-implementation".',
		});
		expect(parsePawBeginImplementationArgs(["session-1", "extra"])).toEqual({
			kind: "error",
			message: 'Unknown option for "paw begin-implementation": extra',
		});
		expect(parsePawBeginImplementationArgs(["session-1", "--bogus"])).toEqual({
			kind: "error",
			message: 'Unknown option for "paw begin-implementation": --bogus',
		});
		expect(parsePawBeginImplementationArgs(["--help"])).toEqual({ kind: "help" });
	});
});

describe("Paw begin-implementation command", () => {
	test("advances SLICE_SELECT to IMPLEMENTING with selected slice and releases lock", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const state = createSliceSelectState("session-1", "slice-1");
		await writePawSessionState(projectRoot, state);

		const result = await createPawBeginImplementationCommandResult(projectRoot, "session-1", {
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result.status).toBe("advanced");
		if (result.status !== "advanced") return;
		expect(result.selectedSliceId).toBe("slice-1");
		expect(result.previousStateName).toBe("SLICE_SELECT");
		expect(result.nextStateName).toBe("IMPLEMENTING");
		expect(result.lockReleased).toBe(true);
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toEqual({
			...state,
			name: "IMPLEMENTING",
			current_slice_id: "slice-1",
		});
		expect(await getPawSessionLockStatus(projectRoot, "session-1", { nowMs: 2_500 })).toEqual({
			status: "unlocked",
		});
		expect(formatPawBeginImplementationCommandResult(result)).toContain("SLICE_SELECT -> IMPLEMENTING");
	});

	test("returns no_selected_slice without mutating session and releases acquired lock", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const state: PawSessionState = {
			...createSliceSelectState("session-1", "slice-1"),
			current_slice_id: null,
		};
		await writePawSessionState(projectRoot, state);

		const result = await createPawBeginImplementationCommandResult(projectRoot, "session-1", {
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result).toEqual({
			status: "no_selected_slice",
			sessionId: "session-1",
			previousStateName: "SLICE_SELECT",
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
			session_id: "session-1",
			name: "PLAN_APPROVED",
			current_slice_id: null,
			pending_slice_ids: ["slice-1"],
			completed_slice_ids: [],
			blocked_reason: null,
		};
		await writePawSessionState(projectRoot, state);

		const result = await createPawBeginImplementationCommandResult(projectRoot, "session-1", {
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result.status).toBe("invalid_transition");
		if (result.status !== "invalid_transition") return;
		expect(result.previousStateName).toBe("PLAN_APPROVED");
		expect(result.lockReleased).toBe(true);
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toEqual(state);
	});

	test("reports missing project or missing session without creating state", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);

		const missingProject = await createPawBeginImplementationCommandResult(projectRoot, "missing", {
			lockOptions: { nowMs: 1_000 },
		});
		expect(missingProject).toEqual({ status: "missing_project", pawDir: ".paw" });
		expect(existsSync(join(projectRoot, ".paw"))).toBe(false);

		vi.spyOn(console, "log").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		const missingSession = await createPawBeginImplementationCommandResult(projectRoot, "missing", {
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
		const state = createSliceSelectState("locked-session", "slice-1");
		await writePawSessionState(projectRoot, state);
		const liveForeignLock: PawSessionLock = { pid: process.pid, host: "other-host", heartbeat_ts: 2_000, ttl: 120 };
		await writeLock(projectRoot, "locked-session", liveForeignLock);

		const locked = await createPawBeginImplementationCommandResult(projectRoot, "locked-session", {
			lockOptions: { nowMs: 3_000, ttlSec: 120, host: hostname() },
		});

		expect(locked).toEqual({ status: "locked", sessionId: "locked-session", lock: liveForeignLock });
		await expect(readPawSessionState(projectRoot, "locked-session")).resolves.toEqual(state);
		expect(await getPawSessionLockStatus(projectRoot, "locked-session", { nowMs: 3_000 })).toEqual({
			status: "locked",
			lock: liveForeignLock,
		});
	});

	test("routes paw begin-implementation and validates command arguments", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createSliceSelectState("session-1", "slice-1"));

		await expect(handlePawCommand(["paw", "begin-implementation", "session-1"])).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "begin-implementation"])).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "begin-implementation", "--help"])).resolves.toBe(true);

		const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
		const stderr = errorSpy.mock.calls.map(([message]) => String(message)).join("\n");
		expect(stdout).toContain("Paw begin-implementation");
		expect(stdout).toContain("IMPLEMENTING");
		expect(stdout).toContain("pi paw begin-implementation");
		expect(stderr).toContain('Missing required session id for "paw begin-implementation".');
		expect(process.exitCode).toBe(1);
	});

	test("main routes paw begin-implementation before normal agent runtime", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
			throw new Error(`process.exit(${code ?? ""})`);
		}) as typeof process.exit);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createSliceSelectState("session-1", "slice-1"));

		await expect(main(["paw", "begin-implementation", "session-1"])).resolves.toBeUndefined();

		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toMatchObject({
			name: "IMPLEMENTING",
			current_slice_id: "slice-1",
		});
		expect(process.exitCode).toBeUndefined();
	});

	test("runPawBeginImplementationCommand surfaces parser errors via exit code", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "error").mockImplementation(() => {});

		await runPawBeginImplementationCommand([]);

		expect(process.exitCode).toBe(1);
	});
});
