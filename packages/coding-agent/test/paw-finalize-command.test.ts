import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { main } from "../src/main.ts";
import {
	createPawFinalizeCommandResult,
	formatPawFinalizeCommandResult,
	parsePawFinalizeArgs,
	runPawFinalizeCommand,
} from "../src/paw/finalize-command.ts";
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

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");
const sourceConfigPath = join(repoRoot, "paw-spec", "config.yaml");
const tempRoots: string[] = [];

let originalCwd: string;
let originalExitCode: typeof process.exitCode;

async function createTempProject(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-finalize-command-"));
	tempRoots.push(root);
	await mkdir(join(root, "paw-spec"), { recursive: true });
	await writeFile(join(root, "paw-spec", "config.yaml"), await readFile(sourceConfigPath, "utf-8"), "utf-8");
	return root;
}

function createSliceDoneState(sessionId: string): PawSessionState {
	return {
		session_id: sessionId,
		name: "SLICE_DONE",
		current_slice_id: null,
		pending_slice_ids: [],
		completed_slice_ids: ["slice-1"],
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

describe("parsePawFinalizeArgs", () => {
	test("parses session id, summary, and repeated evidence", () => {
		expect(parsePawFinalizeArgs(["session-1", "--summary", "done", "--evidence", "a", "--evidence", "b"])).toEqual({
			kind: "ok",
			sessionId: "session-1",
			summary: "done",
			evidence: ["a", "b"],
		});
	});

	test("reports validation errors without throwing", () => {
		expect(parsePawFinalizeArgs([])).toEqual({
			kind: "error",
			message: 'Missing required session id for "paw finalize".',
		});
		expect(parsePawFinalizeArgs(["session-1"])).toEqual({
			kind: "error",
			message: 'Missing required option for "paw finalize": --summary',
		});
		expect(parsePawFinalizeArgs(["session-1", "--summary"])).toEqual({
			kind: "error",
			message: 'Missing value for "paw finalize" option: --summary',
		});
		expect(parsePawFinalizeArgs(["session-1", "--summary", "   "])).toEqual({
			kind: "error",
			message: 'Option --summary for "paw finalize" must be a non-empty string.',
		});
		expect(parsePawFinalizeArgs(["session-1", "--summary", "ok", "--evidence"])).toEqual({
			kind: "error",
			message: 'Missing value for "paw finalize" option: --evidence',
		});
		expect(parsePawFinalizeArgs(["session-1", "--summary", "ok", "--evidence", "   "])).toEqual({
			kind: "error",
			message: 'Option --evidence for "paw finalize" must be a non-empty string.',
		});
		expect(parsePawFinalizeArgs(["session-1", "--summary", "ok", "--bogus"])).toEqual({
			kind: "error",
			message: 'Unknown option for "paw finalize": --bogus',
		});
		expect(parsePawFinalizeArgs(["--help"])).toEqual({ kind: "help" });
	});
});

describe("Paw finalize command", () => {
	test("writes summary.md and report.json and advances SLICE_DONE to FINAL_REPORT", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "log").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createSliceDoneState("session-1"));

		const result = await createPawFinalizeCommandResult(
			projectRoot,
			"session-1",
			"All slices complete.",
			["focused tests passed"],
			{ lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);

		expect(result.status).toBe("completed");
		if (result.status !== "completed") return;
		expect(result.reportStatus).toBe("done");
		expect(result.previousStateName).toBe("SLICE_DONE");
		expect(result.nextStateName).toBe("FINAL_REPORT");
		expect(result.lockReleased).toBe(true);
		expect(existsSync(result.summaryFile)).toBe(true);
		expect(existsSync(result.reportJsonFile)).toBe(true);
		const markdown = await readFile(result.summaryFile, "utf-8");
		expect(markdown).toContain("All slices complete.");
		expect(markdown).toContain("- focused tests passed");
		const reportJson = JSON.parse(await readFile(result.reportJsonFile, "utf-8")) as {
			status: string;
			evidence: string[];
		};
		expect(reportJson.status).toBe("done");
		expect(reportJson.evidence).toEqual(["focused tests passed"]);
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toMatchObject({
			name: "FINAL_REPORT",
		});
		expect(await getPawSessionLockStatus(projectRoot, "session-1", { nowMs: 2_500 })).toEqual({
			status: "unlocked",
		});
		expect(formatPawFinalizeCommandResult(result)).toContain("report json file:");
	});

	test("uses default evidence when --evidence is omitted", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "log").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createSliceDoneState("session-2"));

		const result = await createPawFinalizeCommandResult(projectRoot, "session-2", "Manual close.", [], {
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result.status).toBe("completed");
		if (result.status !== "completed") return;
		const reportJson = JSON.parse(await readFile(result.reportJsonFile, "utf-8")) as { evidence: string[] };
		expect(reportJson.evidence).toEqual(["manual finalization requested"]);
	});

	test("reports missing project or missing session without creating state", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);

		const missingProject = await createPawFinalizeCommandResult(projectRoot, "missing", "summary", [], {
			lockOptions: { nowMs: 1_000 },
		});
		expect(missingProject).toEqual({ status: "missing_project", pawDir: ".paw" });
		expect(existsSync(join(projectRoot, ".paw"))).toBe(false);

		vi.spyOn(console, "log").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		const missingSession = await createPawFinalizeCommandResult(projectRoot, "missing", "summary", [], {
			lockOptions: { nowMs: 1_000 },
		});
		expect(missingSession).toEqual({
			status: "missing_session",
			sessionId: "missing",
			stateFile: ".paw/sessions/missing/state.json",
		});
	});

	test("reports live locks without releasing foreign locks or writing reports", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "log").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		const state = createSliceDoneState("locked-session");
		await writePawSessionState(projectRoot, state);
		const liveForeignLock: PawSessionLock = { pid: process.pid, host: "other-host", heartbeat_ts: 2_000, ttl: 120 };
		await writeLock(projectRoot, "locked-session", liveForeignLock);
		const paths = resolvePawSessionPaths(projectRoot, "locked-session");

		const locked = await createPawFinalizeCommandResult(projectRoot, "locked-session", "summary", ["e"], {
			lockOptions: { nowMs: 3_000, ttlSec: 120 },
		});

		expect(locked).toEqual({ status: "locked", sessionId: "locked-session", lock: liveForeignLock });
		expect(await readPawSessionState(projectRoot, "locked-session")).toEqual(state);
		expect(existsSync(paths.summaryFile)).toBe(false);
		expect(existsSync(paths.reportJsonFile)).toBe(false);
		expect(await getPawSessionLockStatus(projectRoot, "locked-session", { nowMs: 3_000 })).toEqual({
			status: "locked",
			lock: liveForeignLock,
		});
	});

	test("wrong state does not write report artifacts", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "log").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		const wrongState: PawSessionState = { ...createSliceDoneState("wrong-state"), name: "VERIFYING" };
		await writePawSessionState(projectRoot, wrongState);
		const paths = resolvePawSessionPaths(projectRoot, "wrong-state");

		const invalid = await createPawFinalizeCommandResult(projectRoot, "wrong-state", "summary", ["e"], {
			lockOptions: { nowMs: 3_000, ttlSec: 120 },
		});

		expect(invalid.status).toBe("invalid_state");
		if (invalid.status !== "invalid_state") return;
		expect(invalid.previousStateName).toBe("VERIFYING");
		expect(invalid.lockReleased).toBe(true);
		expect(existsSync(paths.summaryFile)).toBe(false);
		expect(existsSync(paths.reportJsonFile)).toBe(false);
		await expect(readPawSessionState(projectRoot, "wrong-state")).resolves.toEqual(wrongState);
	});

	test("routes paw finalize and validates command arguments", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createSliceDoneState("session-1"));

		await expect(handlePawCommand(["paw", "finalize", "session-1", "--summary", "Ship it"])).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "finalize"])).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "finalize", "session-1", "--summary", "   "])).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "finalize", "--help"])).resolves.toBe(true);

		const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
		const stderr = errorSpy.mock.calls.map(([message]) => String(message)).join("\n");
		expect(stdout).toContain("Paw finalize");
		expect(stdout).toContain("FINAL_REPORT");
		expect(stdout).toContain("pi paw finalize");
		expect(stderr).toContain('Missing required session id for "paw finalize".');
		expect(stderr).toContain("must be a non-empty string");
		expect(process.exitCode).toBe(1);
	});

	test("main routes paw finalize before normal agent runtime", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
			throw new Error(`process.exit(${code ?? ""})`);
		}) as typeof process.exit);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createSliceDoneState("session-1"));

		await expect(main(["paw", "finalize", "session-1", "--summary", "via main"])).resolves.toBeUndefined();

		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toMatchObject({
			name: "FINAL_REPORT",
		});
		expect(process.exitCode).toBeUndefined();
	});

	test("runPawFinalizeCommand sets exitCode on parser errors", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "error").mockImplementation(() => {});

		await runPawFinalizeCommand(["session-1", "--bogus"]);
		expect(process.exitCode).toBe(1);
	});
});
