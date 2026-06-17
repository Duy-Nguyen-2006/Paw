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
import * as verificationCommandPolicyModule from "../src/paw/verification-command-policy.ts";
import * as verificationExecutorModule from "../src/paw/verification-executor.ts";
import type { PawNativeVerificationExecutor } from "../src/paw/verification-runner.ts";
import {
	createPawVerifyCommandResult,
	formatPawVerifyCommandResult,
	parsePawVerifyArgs,
	runPawVerifyCommand,
} from "../src/paw/verify-command.ts";

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

describe("Paw verify command with injected native executor", () => {
	test("runs native verification through injected executor and records verified decisions", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "log").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createVerifyingState("session-native"));

		const executedGates: string[] = [];
		const executor: PawNativeVerificationExecutor = async (input) => {
			executedGates.push(input.gate);
			if (input.gate === "working_tree_baseline" || input.gate === "unit_tests") {
				return { exitCode: 0, stdout: "", stderr: "" };
			}
			return { exitCode: 1, stdout: "fail output", stderr: "" };
		};

		const result = await createPawVerifyCommandResult(projectRoot, "session-native", {
			lockOptions: { nowMs: 5_000, ttlSec: 120 },
			nativeVerificationExecutor: executor,
		});

		expect(result.status).toBe("completed_with_unverified");
		if (result.status !== "completed_with_unverified") return;
		expect(result.sessionId).toBe("session-native");
		expect(result.previousStateName).toBe("VERIFYING");
		expect(result.nextStateName).toBe("SLICE_DONE");

		const verifiedGates = result.verifyDecisions.filter((d) => d.status === "verified");
		expect(verifiedGates.map((d) => d.gate)).toContain("working_tree_baseline");
		expect(verifiedGates.map((d) => d.gate)).toContain("unit_tests");

		const unverifiedGates = result.unverifiedDecisions;
		expect(unverifiedGates.length).toBeGreaterThan(0);

		const formatted = formatPawVerifyCommandResult(result);
		expect(formatted).toContain("verified gates:");
		expect(formatted).toContain("working_tree_baseline");
		expect(formatted).toContain("unverified gates:");

		expect(await readPawSessionState(projectRoot, "session-native")).toMatchObject({
			name: "SLICE_DONE",
			current_slice_id: null,
			completed_slice_ids: ["slice-1"],
		});
	});

	test("with all gates verified by executor, result status is completed", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "log").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createVerifyingState("session-all-pass"));

		const executor: PawNativeVerificationExecutor = async () => {
			return { exitCode: 0, stdout: "", stderr: "" };
		};

		const result = await createPawVerifyCommandResult(projectRoot, "session-all-pass", {
			lockOptions: { nowMs: 6_000, ttlSec: 120 },
			nativeVerificationExecutor: executor,
		});

		expect(result.status).toBe("completed");
		if (result.status !== "completed") return;
		expect(result.unverifiedDecisions).toHaveLength(0);
		expect(result.verifyDecisions.every((d) => d.status === "verified")).toBe(true);
		expect(formatPawVerifyCommandResult(result)).toContain("status: completed");
	});

	test("without executor, default path still produces planned-but-not-executed unverified decisions", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "log").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createVerifyingState("session-default"));

		const result = await createPawVerifyCommandResult(projectRoot, "session-default", {
			lockOptions: { nowMs: 7_000, ttlSec: 120 },
		});

		expect(result.status).toBe("completed_with_unverified");
		if (result.status !== "completed_with_unverified") return;
		expect(result.verifyDecisions.every((d) => d.status === "unverified")).toBe(true);
		expect(formatPawVerifyCommandResult(result)).toContain("verified gates: none");
	});
});

describe("parsePawVerifyArgs", () => {
	test("returns ok with session id and native=false for a single session argument", () => {
		expect(parsePawVerifyArgs(["session-1"])).toEqual({
			kind: "ok",
			native: false,
			sessionId: "session-1",
		});
	});

	test("returns ok with native=true when --native follows session id", () => {
		expect(parsePawVerifyArgs(["session-1", "--native"])).toEqual({
			kind: "ok",
			native: true,
			sessionId: "session-1",
		});
	});

	test("returns ok with native=true when --native precedes session id", () => {
		expect(parsePawVerifyArgs(["--native", "session-1"])).toEqual({
			kind: "ok",
			native: true,
			sessionId: "session-1",
		});
	});

	test("returns help for --help", () => {
		expect(parsePawVerifyArgs(["--help"])).toEqual({ kind: "help", native: false });
		expect(parsePawVerifyArgs(["-h"])).toEqual({ kind: "help", native: false });
	});

	test("returns help with native=true when --native is combined with --help", () => {
		expect(parsePawVerifyArgs(["--help", "--native"])).toEqual({ kind: "help", native: true });
		expect(parsePawVerifyArgs(["--native", "-h"])).toEqual({ kind: "help", native: true });
	});

	test("returns error for no arguments", () => {
		expect(parsePawVerifyArgs([])).toEqual({
			kind: "error",
			native: false,
			message: 'Missing required session id for "paw verify".',
		});
	});

	test("returns error for --native with no session id", () => {
		expect(parsePawVerifyArgs(["--native"])).toEqual({
			kind: "error",
			native: true,
			message: 'Missing required session id for "paw verify".',
		});
	});

	test("returns error for extra arguments", () => {
		expect(parsePawVerifyArgs(["session-1", "extra"])).toEqual({
			kind: "error",
			native: false,
			message: 'Unknown option for "paw verify": extra',
		});
	});

	test("returns error for extra arguments even when --native is present", () => {
		expect(parsePawVerifyArgs(["session-1", "--native", "extra"])).toEqual({
			kind: "error",
			native: true,
			message: 'Unknown option for "paw verify": extra',
		});
	});

	test("returns error for unknown flag-like arg", () => {
		expect(parsePawVerifyArgs(["--bad"])).toEqual({
			kind: "error",
			native: false,
			message: 'Unknown option for "paw verify": --bad',
		});
	});

	test("returns error for unknown flag-like arg alongside session id", () => {
		expect(parsePawVerifyArgs(["session-1", "--bad"])).toEqual({
			kind: "error",
			native: false,
			message: 'Unknown option for "paw verify": --bad',
		});
	});

	test("returns error for unknown flag-like arg alongside --native and session id", () => {
		expect(parsePawVerifyArgs(["session-1", "--native", "--bad"])).toEqual({
			kind: "error",
			native: true,
			message: 'Unknown option for "paw verify": --bad',
		});
	});

	test("returns help when --help accompanies session id", () => {
		expect(parsePawVerifyArgs(["session-1", "--help"])).toEqual({ kind: "help", native: false });
	});

	test("returns help with native=true when session id, --native, and --help are all present", () => {
		expect(parsePawVerifyArgs(["--native", "session-1", "--help"])).toEqual({ kind: "help", native: true });
		expect(parsePawVerifyArgs(["session-1", "--native", "-h"])).toEqual({ kind: "help", native: true });
	});
});

describe("runPawVerifyCommand --native wiring", () => {
	test("--native flag wraps subprocess executor with policy derived from verification plan", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createVerifyingState("session-wired"));

		vi.spyOn(verificationExecutorModule, "createPawNativeSubprocessExecutor").mockReturnValue(async () => ({
			exitCode: 0,
			stdout: "",
			stderr: "",
		}));
		const policySpy = vi.spyOn(verificationCommandPolicyModule, "createPawNativeVerificationCommandPolicy");
		const policyCheckedSpy = vi.spyOn(
			verificationCommandPolicyModule,
			"createPawPolicyCheckedNativeVerificationExecutor",
		);

		await runPawVerifyCommand(["session-wired", "--native"]);

		expect(verificationExecutorModule.createPawNativeSubprocessExecutor).toHaveBeenCalledWith({ cwd: projectRoot });
		expect(policySpy).toHaveBeenCalledOnce();
		// Policy is derived from a plan with at least one planned entry
		const planArg = policySpy.mock.calls[0][0];
		const plannedEntries = planArg.filter((entry) => entry.status === "planned");
		expect(plannedEntries.length).toBeGreaterThan(0);
		expect(policyCheckedSpy).toHaveBeenCalledOnce();
		// The first arg to policyChecked is the subprocess executor return value
		// and the second is the policy return value
		const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
		expect(stdout).toContain("status: completed");
		expect(stdout).toContain("unverified gates: none");
	});

	test("--native policy-blocked command does not reach subprocess executor", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createVerifyingState("session-policy-block"));

		let subprocessCallCount = 0;
		vi.spyOn(verificationExecutorModule, "createPawNativeSubprocessExecutor").mockReturnValue(async () => {
			subprocessCallCount++;
			return { exitCode: 0, stdout: "", stderr: "" };
		});

		// Wrap with a policy that blocks all commands
		vi.spyOn(verificationCommandPolicyModule, "createPawNativeVerificationCommandPolicy").mockReturnValue({
			isAllowed: () => false,
		});

		await runPawVerifyCommand(["session-policy-block", "--native"]);

		// The subprocess executor factory is called to create the executor,
		// but the policy blocks all invocations so no subprocess calls happen
		expect(verificationExecutorModule.createPawNativeSubprocessExecutor).toHaveBeenCalledOnce();
		expect(subprocessCallCount).toBe(0);
		const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
		expect(stdout).toContain("status: completed_with_unverified");
		expect(stdout).toContain("verified gates: none");
	});

	test("default path without --native produces unverified gates and does not construct subprocess executor", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createVerifyingState("session-default"));

		const executorSpy = vi.spyOn(verificationExecutorModule, "createPawNativeSubprocessExecutor");

		await runPawVerifyCommand(["session-default"]);

		expect(executorSpy).not.toHaveBeenCalled();
		const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
		expect(stdout).toContain("verified gates: none");
		expect(stdout).toContain("status: completed_with_unverified");
	});

	test("help text mentions --native flag", async () => {
		vi.spyOn(console, "log").mockImplementation(() => {});

		await runPawVerifyCommand(["--help"]);

		const stdout = vi
			.mocked(console.log)
			.mock.calls.map(([message]) => String(message))
			.join("\n");
		expect(stdout).toContain("--native");
		expect(stdout).toContain("Execute verification gates via native subprocess");
	});
});
