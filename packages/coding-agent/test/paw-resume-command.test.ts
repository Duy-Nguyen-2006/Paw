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
	resolvePawSessionPaths,
	writePawJsonAtomic,
	writePawSessionState,
} from "../src/paw/index.ts";
import { handlePawCommand } from "../src/paw/init-command.ts";
import { createPawResumeCommandResult, formatPawResumeCommandResult } from "../src/paw/resume-command.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");
const sourceConfigPath = join(repoRoot, "paw-spec", "config.yaml");
const tempRoots: string[] = [];

let originalCwd: string;
let originalExitCode: typeof process.exitCode;

async function createTempProject(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-resume-command-"));
	tempRoots.push(root);
	await mkdir(join(root, "paw-spec"), { recursive: true });
	await writeFile(join(root, "paw-spec", "config.yaml"), await readFile(sourceConfigPath, "utf-8"), "utf-8");
	return root;
}

function createReviewingState(sessionId: string): PawSessionState {
	return {
		session_id: sessionId,
		name: "REVIEWING",
		current_slice_id: "slice-1",
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

describe("Paw resume command", () => {
	test("acquires and releases the session lock while reporting current resume state", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "log").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		const state = createReviewingState("session-1");
		await writePawSessionState(projectRoot, state);

		const result = await createPawResumeCommandResult(projectRoot, "session-1", {
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result).toMatchObject({
			status: "ready",
			sessionId: "session-1",
			stateName: "REVIEWING",
			currentSliceId: "slice-1",
			pendingSliceCount: 1,
			completedSliceCount: 0,
			reclaimed: null,
			lockReleased: true,
		});
		expect(formatPawResumeCommandResult(result)).toContain("state: REVIEWING");
		expect(formatPawResumeCommandResult(result)).toContain("next action: resume orchestrator from REVIEWING");
		expect(await getPawSessionLockStatus(projectRoot, "session-1", { nowMs: 2_500 })).toEqual({
			status: "unlocked",
		});
	});

	test("reclaims stale locks and reports live locks without releasing another owner", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "log").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createReviewingState("stale-session"));
		await writePawSessionState(projectRoot, createReviewingState("locked-session"));
		const staleLock: PawSessionLock = { pid: process.pid, host: hostname(), heartbeat_ts: 1_000, ttl: 1 };
		const liveForeignLock: PawSessionLock = { pid: process.pid, host: "other-host", heartbeat_ts: 2_000, ttl: 120 };
		await writeLock(projectRoot, "stale-session", staleLock);
		await writeLock(projectRoot, "locked-session", liveForeignLock);

		const stale = await createPawResumeCommandResult(projectRoot, "stale-session", {
			lockOptions: { nowMs: 3_000, ttlSec: 120 },
		});
		const locked = await createPawResumeCommandResult(projectRoot, "locked-session", {
			lockOptions: { nowMs: 3_000, ttlSec: 120 },
		});

		expect(stale.status).toBe("ready");
		if (stale.status !== "ready") return;
		expect(stale.reclaimed).toEqual({ reason: "expired_heartbeat", lock: staleLock });
		expect(await getPawSessionLockStatus(projectRoot, "stale-session", { nowMs: 3_500 })).toEqual({
			status: "unlocked",
		});
		expect(locked).toEqual({ status: "locked", sessionId: "locked-session", lock: liveForeignLock });
		expect(await getPawSessionLockStatus(projectRoot, "locked-session", { nowMs: 3_500 })).toEqual({
			status: "locked",
			lock: liveForeignLock,
		});
	});

	test("reports missing project or missing session without creating state", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);

		const missingProject = await createPawResumeCommandResult(projectRoot, "missing-session", {
			lockOptions: { nowMs: 1_000 },
		});
		expect(missingProject).toEqual({ status: "missing_project", pawDir: ".paw" });
		expect(existsSync(join(projectRoot, ".paw"))).toBe(false);

		vi.spyOn(console, "log").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		const missingSession = await createPawResumeCommandResult(projectRoot, "missing-session", {
			lockOptions: { nowMs: 1_000 },
		});

		expect(missingSession).toEqual({
			status: "missing_session",
			sessionId: "missing-session",
			stateFile: ".paw/sessions/missing-session/state.json",
		});
		expect(existsSync(join(projectRoot, ".paw", "sessions", "missing-session", "state.json"))).toBe(false);
	});

	test("routes paw resume and validates command arguments", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createReviewingState("session-1"));

		await expect(handlePawCommand(["paw", "resume", "session-1"])).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "resume"])).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "resume", "session-1", "extra"])).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "resume", "--help"])).resolves.toBe(true);

		const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
		const stderr = errorSpy.mock.calls.map(([message]) => String(message)).join("\n");
		expect(stdout).toContain("Paw resume");
		expect(stdout).toContain("state: REVIEWING");
		expect(stdout).toContain("pi paw resume <session-id>");
		expect(stderr).toContain('Missing required session id for "paw resume".');
		expect(stderr).toContain('Unknown option for "paw resume": extra');
		expect(process.exitCode).toBe(1);
	});

	test("main routes paw resume before normal agent runtime", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
			throw new Error(`process.exit(${code ?? ""})`);
		}) as typeof process.exit);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createReviewingState("session-1"));

		await expect(main(["paw", "resume", "session-1"])).resolves.toBeUndefined();

		expect(process.exitCode).toBeUndefined();
	});
});
