
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
	buildPawPlannerSlicesFromCliSliceValues,
	createPawApprovePlanCommandResult,
	formatPawApprovePlanCommandResult,
	parsePawApprovePlanArgs,
	runPawApprovePlanCommand,
} from "../src/paw/plan-approval-command.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");
const sourceConfigPath = join(repoRoot, "paw-spec", "config.yaml");
const tempRoots: string[] = [];

let originalCwd: string;
let originalExitCode: typeof process.exitCode;

async function createTempProject(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-plan-approval-command-"));
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

describe("buildPawPlannerSlicesFromCliSliceValues", () => {
	test("uses slice id as title and preserves positional order", () => {
		expect(buildPawPlannerSlicesFromCliSliceValues(["slice-b", "slice-a:First"])).toEqual([
			{ slice_id: "slice-b", title: "slice-b", order: 0 },
			{ slice_id: "slice-a", title: "First", order: 1 },
		]);
	});

	test("uses slice id when title after colon is empty", () => {
		expect(buildPawPlannerSlicesFromCliSliceValues(["slice-1:"])).toEqual([
			{ slice_id: "slice-1", title: "slice-1", order: 0 },
		]);
	});
});

describe("parsePawApprovePlanArgs", () => {
	test("parses session id and repeated slice values", () => {
		expect(parsePawApprovePlanArgs(["session-1", "--slice", "a", "--slice", "b:Two"])).toEqual({
			kind: "ok",
			sessionId: "session-1",
			sliceValues: ["a", "b:Two"],
		});
	});

	test("reports validation errors without throwing", () => {
		expect(parsePawApprovePlanArgs([])).toEqual({
			kind: "error",
			message: 'Missing required session id for "paw approve-plan".',
		});
		expect(parsePawApprovePlanArgs(["--slice", "a"])).toEqual({
			kind: "error",
			message: 'Missing required session id for "paw approve-plan".',
		});
		expect(parsePawApprovePlanArgs(["session-1"])).toEqual({
			kind: "error",
			message: 'Missing required option for "paw approve-plan": --slice',
		});
		expect(parsePawApprovePlanArgs(["session-1", "--slice"])).toEqual({
			kind: "error",
			message: 'Missing value for "paw approve-plan" option: --slice',
		});
		expect(parsePawApprovePlanArgs(["session-1", "--slice", "   "])).toEqual({
			kind: "error",
			message: 'Option --slice for "paw approve-plan" must be a non-empty string.',
		});
		expect(parsePawApprovePlanArgs(["session-1", "--slice", ":Title"])).toEqual({
			kind: "error",
			message: 'Option --slice for "paw approve-plan" must include a non-empty slice id.',
		});
		expect(parsePawApprovePlanArgs(["session-1", "--slice", "a", "--bogus"])).toEqual({
			kind: "error",
			message: 'Unknown option for "paw approve-plan": --bogus',
		});
		expect(parsePawApprovePlanArgs(["session-1", "--slice", "a", "extra"])).toEqual({
			kind: "error",
			message: 'Unknown option for "paw approve-plan": extra',
		});
		expect(parsePawApprovePlanArgs(["--help"])).toEqual({ kind: "help" });
	});
});

describe("Paw approve-plan command", () => {
	test("advances PLAN_DRAFTED to PLAN_APPROVED with ordered pending ids and releases lock", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "log").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		const state = createPlanDraftedState("session-1");
		await writePawSessionState(projectRoot, state);

		const result = await createPawApprovePlanCommandResult(
			projectRoot,
			"session-1",
			["slice-2:Second", "slice-1:First"],
			{ lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);

		expect(result.status).toBe("advanced");
		if (result.status !== "advanced") return;
		expect(result.queueSliceIds).toEqual(["slice-2", "slice-1"]);
		expect(result.previousStateName).toBe("PLAN_DRAFTED");
		expect(result.nextStateName).toBe("PLAN_APPROVED");
		expect(result.lockReleased).toBe(true);
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toEqual({
			...state,
			name: "PLAN_APPROVED",
			pending_slice_ids: ["slice-2", "slice-1"],
		});
		expect(await getPawSessionLockStatus(projectRoot, "session-1", { nowMs: 2_500 })).toEqual({
			status: "unlocked",
		});
		expect(formatPawApprovePlanCommandResult(result)).toContain("PLAN_DRAFTED -> PLAN_APPROVED");
	});

	test("invalid source state does not mutate session and releases acquired lock", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "log").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		const state: PawSessionState = {
			...createInitialPawSessionState("session-1"),
			name: "INTAKE",
		};
		await writePawSessionState(projectRoot, state);

		const result = await createPawApprovePlanCommandResult(projectRoot, "session-1", ["slice-1"], {
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result.status).toBe("invalid_transition");
		if (result.status !== "invalid_transition") return;
		expect(result.queueSliceIds).toEqual(["slice-1"]);
		expect(result.previousStateName).toBe("INTAKE");
		expect(result.lockReleased).toBe(true);
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toEqual(state);
		expect(await getPawSessionLockStatus(projectRoot, "session-1", { nowMs: 2_500 })).toEqual({
			status: "unlocked",
		});
	});

	test("reports missing project or missing session without creating state", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);

		const missingProject = await createPawApprovePlanCommandResult(projectRoot, "missing", ["slice-1"], {
			lockOptions: { nowMs: 1_000 },
		});
		expect(missingProject).toEqual({ status: "missing_project", pawDir: ".paw" });
		expect(existsSync(join(projectRoot, ".paw"))).toBe(false);

		vi.spyOn(console, "log").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		const missingSession = await createPawApprovePlanCommandResult(projectRoot, "missing", ["slice-1"], {
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
		vi.spyOn(console, "log").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		const state = createPlanDraftedState("locked-session");
		await writePawSessionState(projectRoot, state);
		const liveForeignLock: PawSessionLock = { pid: process.pid, host: "other-host", heartbeat_ts: 2_000, ttl: 120 };
		await writeLock(projectRoot, "locked-session", liveForeignLock);

		const locked = await createPawApprovePlanCommandResult(projectRoot, "locked-session", ["slice-1"], {
			lockOptions: { nowMs: 3_000, ttlSec: 120, host: hostname() },
		});

		expect(locked).toEqual({ status: "locked", sessionId: "locked-session", lock: liveForeignLock });
		await expect(readPawSessionState(projectRoot, "locked-session")).resolves.toEqual(state);
		expect(await getPawSessionLockStatus(projectRoot, "locked-session", { nowMs: 3_000 })).toEqual({
			status: "locked",
			lock: liveForeignLock,
		});
	});

	test("routes paw approve-plan and validates command arguments", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createPlanDraftedState("session-1"));

		await expect(handlePawCommand(["paw", "approve-plan", "session-1", "--slice", "slice-1:First"])).resolves.toBe(
			true,
		);
		await expect(handlePawCommand(["paw", "approve-plan"])).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "approve-plan", "session-1", "--slice", "   "])).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "approve-plan", "--help"])).resolves.toBe(true);

		const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
		const stderr = errorSpy.mock.calls.map(([message]) => String(message)).join("\n");
		expect(stdout).toContain("Paw approve-plan");
		expect(stdout).toContain("PLAN_APPROVED");
		expect(stdout).toContain("pi paw approve-plan");
		expect(stderr).toContain('Missing required session id for "paw approve-plan".');
		expect(stderr).toContain("must be a non-empty string");
		expect(process.exitCode).toBe(1);
	});

	test("main routes paw approve-plan before normal agent runtime", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
			throw new Error(`process.exit(${code ?? ""})`);
		}) as typeof process.exit);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createPlanDraftedState("session-1"));

		await expect(main(["paw", "approve-plan", "session-1", "--slice", "slice-1:Via main"])).resolves.toBeUndefined();

		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toMatchObject({
			name: "PLAN_APPROVED",
			pending_slice_ids: ["slice-1"],
		});
		expect(process.exitCode).toBeUndefined();
	});

	test("runPawApprovePlanCommand surfaces parser errors via exit code", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "error").mockImplementation(() => {});

		await runPawApprovePlanCommand(["session-1"]);

		expect(process.exitCode).toBe(1);
	});
});
