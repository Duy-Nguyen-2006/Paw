
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
	createPawBlockVerifierCommandResult,
	formatPawBlockVerifierCommandResult,
	parsePawBlockVerifierArgs,
	runPawBlockVerifierCommand,
} from "../src/paw/verifier-blocked-command.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");
const sourceConfigPath = join(repoRoot, "paw-spec", "config.yaml");
const tempRoots: string[] = [];

let originalCwd: string;
let originalExitCode: typeof process.exitCode;

async function createTempProject(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-verifier-blocked-command-"));
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

function createBlockedReasonPayload() {
	return {
		blocked_reason: {
			code: "TEST_FAILURE",
			message: "Verification gate failed: unit tests did not pass.",
			suggested_action: "Fix the failing tests and resume verification.",
		},
	};
}

function createUnverifiedGateDecisions() {
	return [
		{
			status: "unverified",
			gate: "unit",
			verified: false,
			applicable: true,
			gateSet: "v1",
			reason: "tests failed",
		},
	];
}

async function writeVerifierDecisionFile(projectRoot: string, sessionId: string, payload: unknown): Promise<string> {
	const decisionFile = join(projectRoot, `${sessionId}-decisions.json`);
	await writeFile(decisionFile, `${JSON.stringify(payload)}\n`, "utf-8");
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

describe("parsePawBlockVerifierArgs", () => {
	test("parses required options and reports validation errors without throwing", () => {
		expect(parsePawBlockVerifierArgs(["session-1", "--decision-file", "decisions.json"])).toEqual({
			kind: "ok",
			sessionId: "session-1",
			input: { decisionFile: "decisions.json" },
		});
		expect(parsePawBlockVerifierArgs([])).toEqual({
			kind: "error",
			message: 'Missing required session id for "paw block-verifier".',
		});
		expect(parsePawBlockVerifierArgs(["--decision-file", "decisions.json"])).toEqual({
			kind: "error",
			message: 'Missing required session id for "paw block-verifier".',
		});
		expect(parsePawBlockVerifierArgs(["-session", "--decision-file", "decisions.json"])).toEqual({
			kind: "error",
			message: 'Missing required session id for "paw block-verifier".',
		});
		expect(parsePawBlockVerifierArgs(["session-1"])).toEqual({
			kind: "error",
			message: 'Missing required option for "paw block-verifier": --decision-file',
		});
		expect(parsePawBlockVerifierArgs(["session-1", "--decision-file"])).toEqual({
			kind: "error",
			message: 'Missing value for "paw block-verifier" option: --decision-file',
		});
		expect(
			parsePawBlockVerifierArgs(["session-1", "--decision-file", "a.json", "--decision-file", "b.json"]),
		).toEqual({
			kind: "error",
			message: 'Duplicate option for "paw block-verifier": --decision-file',
		});
		expect(parsePawBlockVerifierArgs(["session-1", "extra", "--decision-file", "a.json"])).toEqual({
			kind: "error",
			message: 'Unknown option for "paw block-verifier": extra',
		});
		expect(parsePawBlockVerifierArgs(["session-1", "--decision-file", "a.json", "--bogus", "x"])).toEqual({
			kind: "error",
			message: 'Unknown option for "paw block-verifier": --bogus',
		});
		expect(parsePawBlockVerifierArgs(["--help"])).toEqual({ kind: "help" });
	});
});

describe("Paw block-verifier command", () => {
	test("blocks VERIFYING to BLOCKED_TEST_FAILURE from blocked_reason and releases lock", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const state = createVerifyingState("session-1", "slice-1");
		await writePawSessionState(projectRoot, state);
		const decisionFile = await writeVerifierDecisionFile(projectRoot, "session-1", createBlockedReasonPayload());

		const result = await createPawBlockVerifierCommandResult(
			projectRoot,
			"session-1",
			{ decisionFile },
			{ lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);

		expect(result.status).toBe("blocked");
		if (result.status !== "blocked") return;
		expect(result.selectedSliceId).toBe("slice-1");
		expect(result.previousStateName).toBe("VERIFYING");
		expect(result.nextStateName).toBe("BLOCKED_TEST_FAILURE");
		expect(result.blockedReasonCode).toBe("TEST_FAILURE");
		expect(result.lockReleased).toBe(true);
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toMatchObject({
			name: "BLOCKED_TEST_FAILURE",
			current_slice_id: "slice-1",
		});
		expect(formatPawBlockVerifierCommandResult(result)).toContain("VERIFYING -> BLOCKED_TEST_FAILURE");
		expect(await getPawSessionLockStatus(projectRoot, "session-1", { nowMs: 2_500 })).toEqual({
			status: "unlocked",
		});
	});

	test("reports missing project, session, and decision file without acquiring lock", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);

		const missingProject = await createPawBlockVerifierCommandResult(projectRoot, "session-1", {
			decisionFile: join(projectRoot, "decision.json"),
		});
		expect(missingProject).toEqual({ status: "missing_project", pawDir: ".paw" });
		expect(existsSync(join(projectRoot, ".paw"))).toBe(false);

		vi.spyOn(console, "log").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);

		const missingSession = await createPawBlockVerifierCommandResult(projectRoot, "missing", {
			decisionFile: join(projectRoot, "decision.json"),
		});
		expect(missingSession).toEqual({
			status: "missing_session",
			sessionId: "missing",
			stateFile: ".paw/sessions/missing/state.json",
		});

		await writePawSessionState(projectRoot, createVerifyingState("session-1", "slice-1"));
		const missingOutput = await createPawBlockVerifierCommandResult(projectRoot, "session-1", {
			decisionFile: join(projectRoot, "missing-decision.json"),
		});
		expect(missingOutput).toEqual({
			status: "missing_decision_file",
			sessionId: "session-1",
			decisionFile: "missing-decision.json",
		});
	});

	test("reports invalid decision file before acquiring lock", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		await writePawSessionState(projectRoot, createVerifyingState("session-1", "slice-1"));
		const decisionFile = join(projectRoot, "invalid-decision.json");
		await writeFile(decisionFile, "{not-json", "utf-8");

		const result = await createPawBlockVerifierCommandResult(projectRoot, "session-1", { decisionFile });

		expect(result.status).toBe("invalid_decision_file");
		if (result.status !== "invalid_decision_file") return;
		expect(result.decisionFile).toBe("invalid-decision.json");
		expect(result.issues[0]?.path).toBe("/");
		expect(await getPawSessionLockStatus(projectRoot, "session-1", { nowMs: 2_500 })).toEqual({
			status: "unlocked",
		});
	});

	test("reports live foreign locks without releasing them", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		await writePawSessionState(projectRoot, createVerifyingState("locked-session", "slice-1"));
		const decisionFile = await writeVerifierDecisionFile(projectRoot, "locked-session", createBlockedReasonPayload());
		const liveForeignLock: PawSessionLock = { pid: process.pid, host: "other-host", heartbeat_ts: 2_000, ttl: 120 };
		await writeLock(projectRoot, "locked-session", liveForeignLock);

		const locked = await createPawBlockVerifierCommandResult(
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
		const wrongOutput = await writeVerifierDecisionFile(projectRoot, "wrong-state", createBlockedReasonPayload());
		const noSliceOutput = await writeVerifierDecisionFile(projectRoot, "no-slice", createBlockedReasonPayload());

		const wrong = await createPawBlockVerifierCommandResult(
			projectRoot,
			"wrong-state",
			{ decisionFile: wrongOutput },
			{ lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);
		const noSlice = await createPawBlockVerifierCommandResult(
			projectRoot,
			"no-slice",
			{ decisionFile: noSliceOutput },
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

	test("verified-only and empty blocked_reason decision files fail before acquiring lock", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const verifiedOnlyState = createVerifyingState("verified-only", "slice-1");
		const invalidReasonState = createVerifyingState("invalid-reason", "slice-1");
		await writePawSessionState(projectRoot, verifiedOnlyState);
		await writePawSessionState(projectRoot, invalidReasonState);
		const verifiedOnlyOutput = await writeVerifierDecisionFile(projectRoot, "verified-only", [
			{
				status: "verified",
				gate: "unit",
				verified: true,
				applicable: true,
				gateSet: "v1",
			},
		]);
		const invalidReasonOutput = await writeVerifierDecisionFile(projectRoot, "invalid-reason", {
			blocked_reason: { code: "TEST_FAILURE", message: "", suggested_action: "" },
		});

		const verifiedOnly = await createPawBlockVerifierCommandResult(
			projectRoot,
			"verified-only",
			{ decisionFile: verifiedOnlyOutput },
			{ lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);
		const invalidReason = await createPawBlockVerifierCommandResult(
			projectRoot,
			"invalid-reason",
			{ decisionFile: invalidReasonOutput },
			{ lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);

		expect(verifiedOnly.status).toBe("invalid_decision_file");
		if (verifiedOnly.status !== "invalid_decision_file") return;
		expect(await getPawSessionLockStatus(projectRoot, "verified-only", { nowMs: 2_500 })).toEqual({
			status: "unlocked",
		});
		expect(invalidReason.status).toBe("invalid_decision_file");
		if (invalidReason.status !== "invalid_decision_file") return;
		expect(await getPawSessionLockStatus(projectRoot, "invalid-reason", { nowMs: 2_500 })).toEqual({
			status: "unlocked",
		});
		await expect(readPawSessionState(projectRoot, "verified-only")).resolves.toEqual(verifiedOnlyState);
		await expect(readPawSessionState(projectRoot, "invalid-reason")).resolves.toEqual(invalidReasonState);
	});

	test("blocks VERIFYING from applicable unverified gate decisions array", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		await writePawSessionState(projectRoot, createVerifyingState("session-2", "slice-1"));
		const decisionFile = await writeVerifierDecisionFile(projectRoot, "session-2", createUnverifiedGateDecisions());

		const result = await createPawBlockVerifierCommandResult(
			projectRoot,
			"session-2",
			{ decisionFile },
			{ lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);

		expect(result.status).toBe("blocked");
		if (result.status !== "blocked") return;
		expect(result.nextStateName).toBe("BLOCKED_TEST_FAILURE");
	});

	test("routes paw block-verifier and validates command arguments", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createVerifyingState("session-1", "slice-1"));
		const decisionFile = await writeVerifierDecisionFile(projectRoot, "session-1", createBlockedReasonPayload());

		await expect(
			handlePawCommand(["paw", "block-verifier", "session-1", "--decision-file", decisionFile]),
		).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "block-verifier"])).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "block-verifier", "--help"])).resolves.toBe(true);

		const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
		const stderr = errorSpy.mock.calls.map(([message]) => String(message)).join("\n");
		expect(stdout).toContain("Paw block-verifier");
		expect(stdout).toContain("BLOCKED_TEST_FAILURE");
		expect(stdout).toContain("pi paw block-verifier");
		expect(stderr).toContain('Missing required session id for "paw block-verifier".');
		expect(process.exitCode).toBe(1);
	});

	test("main routes paw block-verifier before normal agent runtime", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
			throw new Error(`process.exit(${code ?? ""})`);
		}) as typeof process.exit);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createVerifyingState("session-1", "slice-1"));
		const decisionFile = await writeVerifierDecisionFile(projectRoot, "session-1", createBlockedReasonPayload());

		await expect(
			main(["paw", "block-verifier", "session-1", "--decision-file", decisionFile]),
		).resolves.toBeUndefined();

		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toMatchObject({
			name: "BLOCKED_TEST_FAILURE",
			current_slice_id: "slice-1",
		});
		expect(process.exitCode).toBeUndefined();
	});

	test("runPawBlockVerifierCommand surfaces parser errors via exit code", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "error").mockImplementation(() => {});

		await runPawBlockVerifierCommand([]);

		expect(process.exitCode).toBe(1);
	});
});
