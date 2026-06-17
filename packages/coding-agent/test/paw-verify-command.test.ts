import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
import { createPawVerifyCommandResult, formatPawVerifyCommandResult } from "../src/paw/verify-command.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");
const sourceConfigPath = join(repoRoot, "paw-spec", "config.yaml");
const tempRoots: string[] = [];

let originalCwd: string;
let originalExitCode: typeof process.exitCode;

async function createTempProject(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-verify-command-"));
	tempRoots.push(root);
	await mkdir(join(root, "paw-spec"), { recursive: true });
	await writeFile(join(root, "paw-spec", "config.yaml"), await readFile(sourceConfigPath, "utf-8"), "utf-8");
	return root;
}

function createVerifyingState(sessionId: string): PawSessionState {
	return {
		session_id: sessionId,
		name: "VERIFYING",
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

describe("Paw verify command", () => {
	test("acquires the lock, records unverified configured gates, advances VERIFYING to SLICE_DONE, and releases the lock", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "log").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createVerifyingState("session-1"));

		const result = await createPawVerifyCommandResult(projectRoot, "session-1", {
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result.status).toBe("completed_with_unverified");
		if (result.status !== "completed_with_unverified") return;
		expect(result.sessionId).toBe("session-1");
		expect(result.previousStateName).toBe("VERIFYING");
		expect(result.nextStateName).toBe("SLICE_DONE");
		expect(result.currentSliceId).toBe("slice-1");
		expect(result.nativeVerificationPlan.find((entry) => entry.gate === "unit_tests")).toMatchObject({
			status: "planned",
			command: ["./test.sh"],
			executed: false,
		});
		expect(result.verifyDecisions.length).toBeGreaterThan(0);
		expect(result.verifyDecisions.every((decision) => decision.status === "unverified")).toBe(true);
		expect(result.unverifiedDecisions.map((decision) => decision.gate)).toContain("unit_tests");
		expect(result.unverifiedDecisions.find((decision) => decision.gate === "unit_tests")).toMatchObject({
			reason: "Native verification command is planned but not executed in this foundation slice: ./test.sh.",
		});
		expect(result.lockReleased).toBe(true);
		expect(formatPawVerifyCommandResult(result)).toContain("status: completed_with_unverified");
		expect(formatPawVerifyCommandResult(result)).toContain("planned native gates:");
		expect(formatPawVerifyCommandResult(result)).toContain("unverified gates:");
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toMatchObject({
			name: "SLICE_DONE",
			current_slice_id: null,
			completed_slice_ids: ["slice-1"],
		});
		expect(await getPawSessionLockStatus(projectRoot, "session-1", { nowMs: 2_500 })).toEqual({
			status: "unlocked",
		});
	});

	test("reports missing project or missing session without creating state", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);

		const missingProject = await createPawVerifyCommandResult(projectRoot, "missing-session", {
			lockOptions: { nowMs: 1_000 },
		});
		expect(missingProject).toEqual({ status: "missing_project", pawDir: ".paw" });
		expect(existsSync(join(projectRoot, ".paw"))).toBe(false);

		vi.spyOn(console, "log").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		const missingSession = await createPawVerifyCommandResult(projectRoot, "missing-session", {
			lockOptions: { nowMs: 1_000 },
		});

		expect(missingSession).toEqual({
			status: "missing_session",
			sessionId: "missing-session",
			stateFile: ".paw/sessions/missing-session/state.json",
		});
		expect(existsSync(join(projectRoot, ".paw", "sessions", "missing-session", "state.json"))).toBe(false);
	});

	test("reports live locks and invalid state without corrupting session state", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "log").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		const lockedState = createVerifyingState("locked-session");
		const wrongState: PawSessionState = { ...createVerifyingState("wrong-state"), name: "REVIEWING" };
		await writePawSessionState(projectRoot, lockedState);
		await writePawSessionState(projectRoot, wrongState);
		const liveForeignLock: PawSessionLock = { pid: process.pid, host: "other-host", heartbeat_ts: 2_000, ttl: 120 };
		await writeLock(projectRoot, "locked-session", liveForeignLock);

		const locked = await createPawVerifyCommandResult(projectRoot, "locked-session", {
			lockOptions: { nowMs: 3_000, ttlSec: 120 },
		});
		const invalid = await createPawVerifyCommandResult(projectRoot, "wrong-state", {
			lockOptions: { nowMs: 3_000, ttlSec: 120 },
		});

		expect(locked).toEqual({ status: "locked", sessionId: "locked-session", lock: liveForeignLock });
		expect(await readPawSessionState(projectRoot, "locked-session")).toEqual(lockedState);
		expect(invalid.status).toBe("invalid_state");
		if (invalid.status !== "invalid_state") return;
		expect(invalid.sessionId).toBe("wrong-state");
		expect(invalid.previousStateName).toBe("REVIEWING");
		expect(invalid.lockReleased).toBe(true);
		expect(await readPawSessionState(projectRoot, "wrong-state")).toEqual(wrongState);
	});

	test("routes paw verify and validates command arguments", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createVerifyingState("session-1"));

		await expect(handlePawCommand(["paw", "verify", "session-1"])).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "verify"])).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "verify", "session-1", "extra"])).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "verify", "--help"])).resolves.toBe(true);

		const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
		const stderr = errorSpy.mock.calls.map(([message]) => String(message)).join("\n");
		expect(stdout).toContain("Paw verify");
		expect(stdout).toContain("completed_with_unverified");
		expect(stdout).toContain("pi paw verify <session-id>");
		expect(stderr).toContain('Missing required session id for "paw verify".');
		expect(stderr).toContain('Unknown option for "paw verify": extra');
		expect(process.exitCode).toBe(1);
	});

	test("main routes paw verify before normal agent runtime", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
			throw new Error(`process.exit(${code ?? ""})`);
		}) as typeof process.exit);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createVerifyingState("session-1"));

		await expect(main(["paw", "verify", "session-1"])).resolves.toBeUndefined();

		expect(process.exitCode).toBeUndefined();
	});
});
