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
	startPawTaskSession,
	transitionPawSessionState,
	writePawJsonAtomic,
	writePawSessionState,
} from "../src/paw/index.ts";
import { handlePawCommand } from "../src/paw/init-command.ts";
import { createPawStartCommandResult, formatPawStartCommandResult } from "../src/paw/start-command.ts";
import { createInitialPawSessionState } from "../src/paw/state.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");
const sourceConfigPath = join(repoRoot, "paw-spec", "config.yaml");
const tempRoots: string[] = [];

let originalCwd: string;
let originalExitCode: typeof process.exitCode;

async function createTempProject(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-start-command-"));
	tempRoots.push(root);
	await mkdir(join(root, "paw-spec"), { recursive: true });
	await writeFile(join(root, "paw-spec", "config.yaml"), await readFile(sourceConfigPath, "utf-8"), "utf-8");
	return root;
}

function createClassifyingState(sessionId: string): PawSessionState {
	const intake = transitionPawSessionState(createInitialPawSessionState(sessionId), { to: "INTAKE" });
	expect(intake.ok).toBe(true);
	if (!intake.ok) {
		throw new Error("failed to build intake state");
	}
	const classified = transitionPawSessionState(intake.value, { to: "CLASSIFYING" });
	expect(classified.ok).toBe(true);
	if (!classified.ok) {
		throw new Error("failed to build classifying state");
	}
	return classified.value;
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

describe("Paw start command", () => {
	test("creates .paw, starts INTAKE state, and releases the acquired lock", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);

		const result = await createPawStartCommandResult(projectRoot, "session-1", {
			lockOptions: { nowMs: 1_000, ttlSec: 120 },
		});

		expect(result).toMatchObject({
			status: "started",
			sessionId: "session-1",
			stateName: "INTAKE",
			reclaimed: null,
			lockReleased: true,
		});
		if (result.status !== "started") return;
		expect(result.created).toBeGreaterThan(0);
		expect(result.existing).toBe(0);
		expect(formatPawStartCommandResult(result)).toContain("state: INTAKE");
		expect(formatPawStartCommandResult(result)).toContain("lock released: yes");
		expect(existsSync(join(projectRoot, ".paw", "config.yaml"))).toBe(true);
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toMatchObject({
			name: "INTAKE",
		});
		expect(await getPawSessionLockStatus(projectRoot, "session-1", { nowMs: 1_500 })).toEqual({
			status: "unlocked",
		});
	});

	test("reports an existing session without overwriting state", async () => {
		const projectRoot = await createTempProject();
		const existing = createClassifyingState("session-1");
		await writePawSessionState(projectRoot, existing);

		const result = await createPawStartCommandResult(projectRoot, "session-1", {
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result).toMatchObject({
			status: "existing",
			sessionId: "session-1",
			stateName: "CLASSIFYING",
			lockReleased: true,
		});
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toEqual(existing);
	});

	test("reports a live foreign lock without releasing it", async () => {
		const projectRoot = await createTempProject();
		const liveForeignLock: PawSessionLock = {
			pid: process.pid,
			host: "other-host",
			heartbeat_ts: 2_000,
			ttl: 120,
		};
		await writeLock(projectRoot, "locked-session", liveForeignLock);

		const result = await createPawStartCommandResult(projectRoot, "locked-session", {
			lockOptions: { nowMs: 3_000, ttlSec: 120 },
		});

		expect(result).toMatchObject({
			status: "locked",
			sessionId: "locked-session",
			lock: liveForeignLock,
		});
		if (result.status === "locked") {
			expect(result.created).toBeGreaterThan(0);
		}
		expect(formatPawStartCommandResult(result)).toContain("lock released: no");
		expect(await getPawSessionLockStatus(projectRoot, "locked-session", { nowMs: 3_500 })).toEqual({
			status: "locked",
			lock: liveForeignLock,
		});
		expect(existsSync(resolvePawSessionPaths(projectRoot, "locked-session").stateFile)).toBe(false);
	});

	test("reclaims stale locks when starting a missing session", async () => {
		const projectRoot = await createTempProject();
		const staleLock: PawSessionLock = { pid: process.pid, host: hostname(), heartbeat_ts: 1_000, ttl: 1 };
		await writeLock(projectRoot, "stale-session", staleLock);

		const result = await createPawStartCommandResult(projectRoot, "stale-session", {
			lockOptions: { nowMs: 3_000, ttlSec: 120 },
		});

		expect(result.status).toBe("started");
		if (result.status !== "started") return;
		expect(result.reclaimed).toEqual({ reason: "expired_heartbeat", lock: staleLock });
		expect(result.lockReleased).toBe(true);
		expect(await getPawSessionLockStatus(projectRoot, "stale-session", { nowMs: 3_500 })).toEqual({
			status: "unlocked",
		});
	});

	test("routes paw start and validates command arguments", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await expect(handlePawCommand(["paw", "start", "session-1"])).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "start"])).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "start", "session-1", "extra"])).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "start", "--help"])).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "start", "-unknown"])).resolves.toBe(true);

		const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
		const stderr = errorSpy.mock.calls.map(([message]) => String(message)).join("\n");
		expect(stdout).toContain("Paw start");
		expect(stdout).toContain("state: INTAKE");
		expect(stdout).toContain("pi paw start <session-id>");
		expect(stderr).toContain('Missing required session id for "paw start".');
		expect(stderr).toContain('Unknown option for "paw start": extra');
		expect(process.exitCode).toBe(1);
	});

	test("main routes paw start before normal agent runtime", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
			throw new Error(`process.exit(${code ?? ""})`);
		}) as typeof process.exit);

		await expect(main(["paw", "start", "session-1"])).resolves.toBeUndefined();

		expect(process.exitCode).toBeUndefined();
		expect(existsSync(join(projectRoot, ".paw", "sessions", "session-1", "state.json"))).toBe(true);
	});

	test("startPawTaskSession leaves lock held until CLI releases it", async () => {
		const projectRoot = await createTempProject();
		const core = await startPawTaskSession({
			repoRoot: projectRoot,
			sessionId: "session-core",
			lockOptions: { nowMs: 1_000, ttlSec: 120 },
		});
		expect(core.status).toBe("started");
		expect(await getPawSessionLockStatus(projectRoot, "session-core", { nowMs: 1_500 })).toMatchObject({
			status: "locked",
		});
	});
});
