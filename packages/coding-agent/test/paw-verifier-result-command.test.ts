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
	type PawVerifyGateDecision,
	readPawSessionState,
	resolvePawSessionPaths,
	writePawJsonAtomic,
	writePawSessionState,
} from "../src/paw/index.ts";
import { handlePawCommand } from "../src/paw/init-command.ts";
import * as verifierResult from "../src/paw/verifier-result.ts";
import {
	createPawCompleteVerificationCommandResult,
	formatPawCompleteVerificationCommandResult,
	parsePawCompleteVerificationArgs,
	runPawCompleteVerificationCommand,
} from "../src/paw/verifier-result-command.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");
const sourceConfigPath = join(repoRoot, "paw-spec", "config.yaml");
const tempRoots: string[] = [];

let originalCwd: string;
let originalExitCode: typeof process.exitCode;

const verifiedUnitGate: PawVerifyGateDecision = {
	status: "verified",
	gate: "unit_tests",
	verified: true,
	applicable: true,
	gateSet: "v1",
};

const unverifiedLintGate: PawVerifyGateDecision = {
	status: "unverified",
	gate: "lint",
	verified: false,
	applicable: true,
	gateSet: "v1",
	reason: "lint command unavailable",
};

async function createTempProject(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-verifier-result-command-"));
	tempRoots.push(root);
	await mkdir(join(root, "paw-spec"), { recursive: true });
	await writeFile(join(root, "paw-spec", "config.yaml"), await readFile(sourceConfigPath, "utf-8"), "utf-8");
	return root;
}

function createVerifyingState(sessionId: string, sliceId = "slice-1"): PawSessionState {
	return {
		session_id: sessionId,
		name: "VERIFYING",
		current_slice_id: sliceId,
		pending_slice_ids: ["slice-2"],
		completed_slice_ids: [],
		blocked_reason: null,
	};
}

async function writeDecisionFile(
	projectRoot: string,
	sessionId: string,
	decisions: readonly PawVerifyGateDecision[] | { verify_decisions: readonly PawVerifyGateDecision[] },
): Promise<string> {
	const decisionFile = join(projectRoot, `${sessionId}-verify-decisions.json`);
	await writeFile(decisionFile, `${JSON.stringify(decisions)}\n`, "utf-8");
	return decisionFile;
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

describe("parsePawCompleteVerificationArgs", () => {
	test("parses required options and reports validation errors without throwing", () => {
		expect(parsePawCompleteVerificationArgs(["session-1", "--decision-file", "decisions.json"])).toEqual({
			kind: "ok",
			sessionId: "session-1",
			input: { decisionFile: "decisions.json" },
		});
		expect(parsePawCompleteVerificationArgs([])).toEqual({
			kind: "error",
			message: 'Missing required session id for "paw complete-verification".',
		});
		expect(parsePawCompleteVerificationArgs(["--decision-file", "decisions.json"])).toEqual({
			kind: "error",
			message: 'Missing required session id for "paw complete-verification".',
		});
		expect(parsePawCompleteVerificationArgs(["-session", "--decision-file", "decisions.json"])).toEqual({
			kind: "error",
			message: 'Missing required session id for "paw complete-verification".',
		});
		expect(parsePawCompleteVerificationArgs(["session-1"])).toEqual({
			kind: "error",
			message: 'Missing required option for "paw complete-verification": --decision-file',
		});
		expect(parsePawCompleteVerificationArgs(["session-1", "--decision-file"])).toEqual({
			kind: "error",
			message: 'Missing value for "paw complete-verification" option: --decision-file',
		});
		expect(
			parsePawCompleteVerificationArgs(["session-1", "--decision-file", "a.json", "--decision-file", "b.json"]),
		).toEqual({
			kind: "error",
			message: 'Duplicate option for "paw complete-verification": --decision-file',
		});
		expect(parsePawCompleteVerificationArgs(["session-1", "extra", "--decision-file", "a.json"])).toEqual({
			kind: "error",
			message: 'Unknown option for "paw complete-verification": extra',
		});
		expect(parsePawCompleteVerificationArgs(["session-1", "--decision-file", "a.json", "--bogus", "x"])).toEqual({
			kind: "error",
			message: 'Unknown option for "paw complete-verification": --bogus',
		});
		expect(parsePawCompleteVerificationArgs(["--help"])).toEqual({ kind: "help" });
	});
});

describe("Paw complete-verification command", () => {
	test("completes VERIFYING to SLICE_DONE and releases lock", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const state = createVerifyingState("session-1", "slice-1");
		await writePawSessionState(projectRoot, state);
		const decisionFile = await writeDecisionFile(projectRoot, "session-1", [verifiedUnitGate]);

		const result = await createPawCompleteVerificationCommandResult(
			projectRoot,
			"session-1",
			{ decisionFile },
			{ lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);

		expect(result.status).toBe("completed");
		if (result.status !== "completed") return;
		expect(result.selectedSliceId).toBe("slice-1");
		expect(result.previousStateName).toBe("VERIFYING");
		expect(result.nextStateName).toBe("SLICE_DONE");
		expect(result.decisionCount).toBe(1);
		expect(result.unverifiedCount).toBe(0);
		expect(result.lockReleased).toBe(true);
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toMatchObject({
			name: "SLICE_DONE",
			current_slice_id: null,
		});
		expect(formatPawCompleteVerificationCommandResult(result)).toContain("VERIFYING -> SLICE_DONE");
		expect(await getPawSessionLockStatus(projectRoot, "session-1", { nowMs: 2_500 })).toEqual({
			status: "unlocked",
		});
	});

	test("completes with unverified decisions and accepts verify_decisions wrapper", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		await writePawSessionState(projectRoot, createVerifyingState("session-1", "slice-1"));
		const decisionFile = await writeDecisionFile(projectRoot, "session-1", {
			verify_decisions: [verifiedUnitGate, unverifiedLintGate],
		});

		const result = await createPawCompleteVerificationCommandResult(
			projectRoot,
			"session-1",
			{ decisionFile },
			{ lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);

		expect(result.status).toBe("completed_with_unverified");
		if (result.status !== "completed_with_unverified") return;
		expect(result.decisionCount).toBe(2);
		expect(result.unverifiedCount).toBe(1);
		expect(result.lockReleased).toBe(true);
	});

	test("reports missing project, session, and decision file without acquiring lock", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);

		const missingProject = await createPawCompleteVerificationCommandResult(projectRoot, "session-1", {
			decisionFile: join(projectRoot, "verify-decisions.json"),
		});
		expect(missingProject).toEqual({ status: "missing_project", pawDir: ".paw" });
		expect(existsSync(join(projectRoot, ".paw"))).toBe(false);

		vi.spyOn(console, "log").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);

		const missingSession = await createPawCompleteVerificationCommandResult(projectRoot, "missing", {
			decisionFile: join(projectRoot, "verify-decisions.json"),
		});
		expect(missingSession).toEqual({
			status: "missing_session",
			sessionId: "missing",
			stateFile: ".paw/sessions/missing/state.json",
		});

		await writePawSessionState(projectRoot, createVerifyingState("session-1", "slice-1"));
		const missingDecision = await createPawCompleteVerificationCommandResult(projectRoot, "session-1", {
			decisionFile: join(projectRoot, "missing-verify-decisions.json"),
		});
		expect(missingDecision).toEqual({
			status: "missing_decision_file",
			sessionId: "session-1",
			decisionFile: "missing-verify-decisions.json",
		});
	});

	test("reports invalid decision file before acquiring lock", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		await writePawSessionState(projectRoot, createVerifyingState("session-1", "slice-1"));
		const decisionFile = join(projectRoot, "invalid-verify-decisions.json");
		await writeFile(decisionFile, "[]", "utf-8");

		const empty = await createPawCompleteVerificationCommandResult(projectRoot, "session-1", { decisionFile });
		expect(empty.status).toBe("invalid_decision_file");
		if (empty.status !== "invalid_decision_file") return;
		expect(empty.issues[0]?.path).toBe("/verify_decisions");

		await writeFile(decisionFile, "{not-json", "utf-8");
		const invalidJson = await createPawCompleteVerificationCommandResult(projectRoot, "session-1", { decisionFile });
		expect(invalidJson.status).toBe("invalid_decision_file");
		expect(await getPawSessionLockStatus(projectRoot, "session-1", { nowMs: 2_500 })).toEqual({
			status: "unlocked",
		});
	});

	test("reports live foreign locks without releasing them", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		await writePawSessionState(projectRoot, createVerifyingState("locked-session", "slice-1"));
		const decisionFile = await writeDecisionFile(projectRoot, "locked-session", [verifiedUnitGate]);
		const liveForeignLock: PawSessionLock = { pid: process.pid, host: "other-host", heartbeat_ts: 2_000, ttl: 120 };
		await writeLock(projectRoot, "locked-session", liveForeignLock);

		const locked = await createPawCompleteVerificationCommandResult(
			projectRoot,
			"locked-session",
			{ decisionFile },
			{ lockOptions: { nowMs: 3_000, ttlSec: 120, host: hostname() } },
		);

		expect(locked).toEqual({ status: "locked", sessionId: "locked-session", lock: liveForeignLock });
		expect(await getPawSessionLockStatus(projectRoot, "locked-session", { nowMs: 3_000 })).toEqual({
			status: "locked",
			lock: liveForeignLock,
		});
	});

	test("invalid source state and no selected slice release acquired lock without mutation", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const wrongState: PawSessionState = {
			...createVerifyingState("wrong-state", "slice-1"),
			name: "REVIEWING",
		};
		const noSliceState: PawSessionState = {
			...createVerifyingState("no-slice", "slice-1"),
			current_slice_id: null,
		};
		await writePawSessionState(projectRoot, wrongState);
		await writePawSessionState(projectRoot, noSliceState);
		const wrongDecision = await writeDecisionFile(projectRoot, "wrong-state", [verifiedUnitGate]);
		const noSliceDecision = await writeDecisionFile(projectRoot, "no-slice", [verifiedUnitGate]);

		const wrong = await createPawCompleteVerificationCommandResult(
			projectRoot,
			"wrong-state",
			{ decisionFile: wrongDecision },
			{ lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);
		const noSlice = await createPawCompleteVerificationCommandResult(
			projectRoot,
			"no-slice",
			{ decisionFile: noSliceDecision },
			{ lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);

		expect(wrong.status).toBe("invalid_state");
		if (wrong.status !== "invalid_state") return;
		expect(wrong.lockReleased).toBe(true);
		expect(noSlice.status).toBe("no_selected_slice");
		if (noSlice.status !== "no_selected_slice") return;
		expect(noSlice.lockReleased).toBe(true);
		await expect(readPawSessionState(projectRoot, "wrong-state")).resolves.toEqual(wrongState);
		await expect(readPawSessionState(projectRoot, "no-slice")).resolves.toEqual(noSliceState);
	});

	test("maps invalid_verify_decisions from core and releases acquired lock", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const state = createVerifyingState("session-1", "slice-1");
		await writePawSessionState(projectRoot, state);
		const decisionFile = await writeDecisionFile(projectRoot, "session-1", [verifiedUnitGate]);
		vi.spyOn(verifierResult, "completePawVerification").mockResolvedValue({
			status: "invalid_verify_decisions",
			previousState: state,
			issues: [
				{
					path: "/verify_decisions",
					message: "Verification completion requires at least one gate decision.",
				},
			],
		});

		const result = await createPawCompleteVerificationCommandResult(
			projectRoot,
			"session-1",
			{ decisionFile },
			{ lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);

		expect(result.status).toBe("invalid_verify_decisions");
		if (result.status !== "invalid_verify_decisions") return;
		expect(result.lockReleased).toBe(true);
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toEqual(state);
	});

	test("routes paw complete-verification and validates command arguments", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createVerifyingState("session-1", "slice-1"));
		const decisionFile = await writeDecisionFile(projectRoot, "session-1", [verifiedUnitGate]);

		await expect(
			handlePawCommand(["paw", "complete-verification", "session-1", "--decision-file", decisionFile]),
		).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "complete-verification"])).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "complete-verification", "--help"])).resolves.toBe(true);

		const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
		const stderr = errorSpy.mock.calls.map(([message]) => String(message)).join("\n");
		expect(stdout).toContain("Paw complete-verification");
		expect(stdout).toContain("SLICE_DONE");
		expect(stdout).toContain("pi paw complete-verification");
		expect(stderr).toContain('Missing required session id for "paw complete-verification".');
		expect(process.exitCode).toBe(1);
	});

	test("main routes paw complete-verification before normal agent runtime", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
			throw new Error(`process.exit(${code ?? ""})`);
		}) as typeof process.exit);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createVerifyingState("session-1", "slice-1"));
		const decisionFile = await writeDecisionFile(projectRoot, "session-1", [verifiedUnitGate]);

		await expect(
			main(["paw", "complete-verification", "session-1", "--decision-file", decisionFile]),
		).resolves.toBeUndefined();

		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toMatchObject({
			name: "SLICE_DONE",
		});
		expect(process.exitCode).toBeUndefined();
	});

	test("runPawCompleteVerificationCommand surfaces parser errors via exit code", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "error").mockImplementation(() => {});

		await runPawCompleteVerificationCommand([]);

		expect(process.exitCode).toBe(1);
	});
});
