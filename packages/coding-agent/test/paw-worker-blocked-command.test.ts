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
	type PawSubAgentOutput,
	readPawSessionState,
	resolvePawSessionPaths,
	writePawJsonAtomic,
	writePawSessionState,
} from "../src/paw/index.ts";
import { handlePawCommand } from "../src/paw/init-command.ts";
import {
	createPawBlockWorkerCommandResult,
	formatPawBlockWorkerCommandResult,
	parsePawBlockWorkerArgs,
	runPawBlockWorkerCommand,
} from "../src/paw/worker-blocked-command.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");
const sourceConfigPath = join(repoRoot, "paw-spec", "config.yaml");
const tempRoots: string[] = [];

let originalCwd: string;
let originalExitCode: typeof process.exitCode;

async function createTempProject(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-worker-blocked-command-"));
	tempRoots.push(root);
	await mkdir(join(root, "paw-spec"), { recursive: true });
	await writeFile(join(root, "paw-spec", "config.yaml"), await readFile(sourceConfigPath, "utf-8"), "utf-8");
	return root;
}

function createImplementingState(sessionId: string, sliceId = "slice-1"): PawSessionState {
	return {
		session_id: sessionId,
		name: "IMPLEMENTING",
		current_slice_id: sliceId,
		pending_slice_ids: ["slice-2"],
		completed_slice_ids: [],
		blocked_reason: null,
	};
}

function createBlockedWorkerOutput(overrides: Partial<PawSubAgentOutput> = {}): PawSubAgentOutput {
	return {
		status: "blocked",
		confidence: "medium",
		agent: "worker",
		session_id: "session-1",
		slice_id: "slice-1",
		artifact_ref: ".paw/artifacts/session-1/worker/report.md",
		changed_files: [],
		inspected_files: [],
		risks: [],
		next_actions: ["Fix the patch conflict and resume."],
		blocked_reason: {
			code: "PATCH_APPLY_FAILED",
			message: "Patch failed to apply.",
			suggested_action: "Re-derive the patch for the current file contents.",
		},
		tokens_used: 42,
		usd_cost: 0.01,
		degraded: false,
		model_used: "model-1",
		...overrides,
	};
}

async function writeWorkerOutputFile(
	projectRoot: string,
	sessionId: string,
	output: PawSubAgentOutput,
): Promise<string> {
	const outputFile = join(projectRoot, `${sessionId}-worker-output.json`);
	await writeFile(outputFile, `${JSON.stringify(output)}\n`, "utf-8");
	return outputFile;
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

describe("parsePawBlockWorkerArgs", () => {
	test("parses required options and reports validation errors without throwing", () => {
		expect(parsePawBlockWorkerArgs(["session-1", "--output-file", "worker.json"])).toEqual({
			kind: "ok",
			sessionId: "session-1",
			input: { outputFile: "worker.json" },
		});
		expect(parsePawBlockWorkerArgs([])).toEqual({
			kind: "error",
			message: 'Missing required session id for "paw block-worker".',
		});
		expect(parsePawBlockWorkerArgs(["--output-file", "worker.json"])).toEqual({
			kind: "error",
			message: 'Missing required session id for "paw block-worker".',
		});
		expect(parsePawBlockWorkerArgs(["-session", "--output-file", "worker.json"])).toEqual({
			kind: "error",
			message: 'Missing required session id for "paw block-worker".',
		});
		expect(parsePawBlockWorkerArgs(["session-1"])).toEqual({
			kind: "error",
			message: 'Missing required option for "paw block-worker": --output-file',
		});
		expect(parsePawBlockWorkerArgs(["session-1", "--output-file"])).toEqual({
			kind: "error",
			message: 'Missing value for "paw block-worker" option: --output-file',
		});
		expect(parsePawBlockWorkerArgs(["session-1", "--output-file", "a.json", "--output-file", "b.json"])).toEqual({
			kind: "error",
			message: 'Duplicate option for "paw block-worker": --output-file',
		});
		expect(parsePawBlockWorkerArgs(["session-1", "extra", "--output-file", "a.json"])).toEqual({
			kind: "error",
			message: 'Unknown option for "paw block-worker": extra',
		});
		expect(parsePawBlockWorkerArgs(["session-1", "--output-file", "a.json", "--bogus", "x"])).toEqual({
			kind: "error",
			message: 'Unknown option for "paw block-worker": --bogus',
		});
		expect(parsePawBlockWorkerArgs(["--help"])).toEqual({ kind: "help" });
	});
});

describe("Paw block-worker command", () => {
	test("blocks IMPLEMENTING to BLOCKED_PATCH_APPLY_FAILED and releases lock", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const state = createImplementingState("session-1", "slice-1");
		await writePawSessionState(projectRoot, state);
		const outputFile = await writeWorkerOutputFile(
			projectRoot,
			"session-1",
			createBlockedWorkerOutput({ session_id: "session-1" }),
		);

		const result = await createPawBlockWorkerCommandResult(
			projectRoot,
			"session-1",
			{ outputFile },
			{ lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);

		expect(result.status).toBe("blocked");
		if (result.status !== "blocked") return;
		expect(result.selectedSliceId).toBe("slice-1");
		expect(result.previousStateName).toBe("IMPLEMENTING");
		expect(result.nextStateName).toBe("BLOCKED_PATCH_APPLY_FAILED");
		expect(result.blockedReasonCode).toBe("PATCH_APPLY_FAILED");
		expect(result.lockReleased).toBe(true);
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toMatchObject({
			name: "BLOCKED_PATCH_APPLY_FAILED",
			current_slice_id: "slice-1",
		});
		expect(formatPawBlockWorkerCommandResult(result)).toContain("IMPLEMENTING -> BLOCKED_PATCH_APPLY_FAILED");
		expect(await getPawSessionLockStatus(projectRoot, "session-1", { nowMs: 2_500 })).toEqual({
			status: "unlocked",
		});
	});

	test("reports missing project, session, and output file without acquiring lock", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);

		const missingProject = await createPawBlockWorkerCommandResult(projectRoot, "session-1", {
			outputFile: join(projectRoot, "worker-output.json"),
		});
		expect(missingProject).toEqual({ status: "missing_project", pawDir: ".paw" });
		expect(existsSync(join(projectRoot, ".paw"))).toBe(false);

		vi.spyOn(console, "log").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);

		const missingSession = await createPawBlockWorkerCommandResult(projectRoot, "missing", {
			outputFile: join(projectRoot, "worker-output.json"),
		});
		expect(missingSession).toEqual({
			status: "missing_session",
			sessionId: "missing",
			stateFile: ".paw/sessions/missing/state.json",
		});

		await writePawSessionState(projectRoot, createImplementingState("session-1", "slice-1"));
		const missingOutput = await createPawBlockWorkerCommandResult(projectRoot, "session-1", {
			outputFile: join(projectRoot, "missing-worker-output.json"),
		});
		expect(missingOutput).toEqual({
			status: "missing_output_file",
			sessionId: "session-1",
			outputFile: "missing-worker-output.json",
		});
	});

	test("reports invalid output file before acquiring lock", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		await writePawSessionState(projectRoot, createImplementingState("session-1", "slice-1"));
		const outputFile = join(projectRoot, "invalid-worker-output.json");
		await writeFile(outputFile, "{not-json", "utf-8");

		const result = await createPawBlockWorkerCommandResult(projectRoot, "session-1", { outputFile });

		expect(result.status).toBe("invalid_output_file");
		if (result.status !== "invalid_output_file") return;
		expect(result.outputFile).toBe("invalid-worker-output.json");
		expect(result.issues[0]?.path).toBe("/");
		expect(await getPawSessionLockStatus(projectRoot, "session-1", { nowMs: 2_500 })).toEqual({
			status: "unlocked",
		});
	});

	test("reports live foreign locks without releasing them", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		await writePawSessionState(projectRoot, createImplementingState("locked-session", "slice-1"));
		const outputFile = await writeWorkerOutputFile(
			projectRoot,
			"locked-session",
			createBlockedWorkerOutput({ session_id: "locked-session" }),
		);
		const liveForeignLock: PawSessionLock = { pid: process.pid, host: "other-host", heartbeat_ts: 2_000, ttl: 120 };
		await writeLock(projectRoot, "locked-session", liveForeignLock);

		const locked = await createPawBlockWorkerCommandResult(
			projectRoot,
			"locked-session",
			{ outputFile },
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
			...createImplementingState("wrong-state", "slice-1"),
			name: "REVIEWING",
		};
		const noSliceState: PawSessionState = {
			...createImplementingState("no-slice", "slice-1"),
			current_slice_id: null,
		};
		await writePawSessionState(projectRoot, wrongState);
		await writePawSessionState(projectRoot, noSliceState);
		const wrongOutput = await writeWorkerOutputFile(
			projectRoot,
			"wrong-state",
			createBlockedWorkerOutput({ session_id: "wrong-state" }),
		);
		const noSliceOutput = await writeWorkerOutputFile(
			projectRoot,
			"no-slice",
			createBlockedWorkerOutput({ session_id: "no-slice" }),
		);

		const wrong = await createPawBlockWorkerCommandResult(
			projectRoot,
			"wrong-state",
			{ outputFile: wrongOutput },
			{ lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);
		const noSlice = await createPawBlockWorkerCommandResult(
			projectRoot,
			"no-slice",
			{ outputFile: noSliceOutput },
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

	test("worker_not_blocked, invalid_worker_output, and invalid_blocked_reason release acquired lock without mutation", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const nonBlockedState = createImplementingState("non-blocked", "slice-1");
		const mismatchState = createImplementingState("mismatch", "slice-1");
		const invalidReasonState = createImplementingState("invalid-reason", "slice-1");
		await writePawSessionState(projectRoot, nonBlockedState);
		await writePawSessionState(projectRoot, mismatchState);
		await writePawSessionState(projectRoot, invalidReasonState);
		const nonBlockedOutput = await writeWorkerOutputFile(
			projectRoot,
			"non-blocked",
			createBlockedWorkerOutput({ session_id: "non-blocked", status: "pass" }),
		);
		const mismatchOutput = await writeWorkerOutputFile(
			projectRoot,
			"mismatch",
			createBlockedWorkerOutput({
				session_id: "mismatch",
				agent: "reviewer",
				slice_id: "slice-2",
			}),
		);
		const invalidReasonOutput = await writeWorkerOutputFile(
			projectRoot,
			"invalid-reason",
			createBlockedWorkerOutput({
				session_id: "invalid-reason",
				blocked_reason: {
					code: "PATCH_APPLY_FAILED",
					message: "",
					suggested_action: "",
				},
			}),
		);

		const nonBlocked = await createPawBlockWorkerCommandResult(
			projectRoot,
			"non-blocked",
			{ outputFile: nonBlockedOutput },
			{ lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);
		const mismatch = await createPawBlockWorkerCommandResult(
			projectRoot,
			"mismatch",
			{ outputFile: mismatchOutput },
			{ lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);
		const invalidReason = await createPawBlockWorkerCommandResult(
			projectRoot,
			"invalid-reason",
			{ outputFile: invalidReasonOutput },
			{ lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);

		expect(nonBlocked.status).toBe("worker_not_blocked");
		if (nonBlocked.status !== "worker_not_blocked") return;
		expect(nonBlocked.lockReleased).toBe(true);
		expect(mismatch.status).toBe("invalid_worker_output");
		if (mismatch.status !== "invalid_worker_output") return;
		expect(mismatch.lockReleased).toBe(true);
		expect(invalidReason.status).toBe("invalid_blocked_reason");
		if (invalidReason.status !== "invalid_blocked_reason") return;
		expect(invalidReason.lockReleased).toBe(true);
		await expect(readPawSessionState(projectRoot, "non-blocked")).resolves.toEqual(nonBlockedState);
		await expect(readPawSessionState(projectRoot, "mismatch")).resolves.toEqual(mismatchState);
		await expect(readPawSessionState(projectRoot, "invalid-reason")).resolves.toEqual(invalidReasonState);
	});

	test("routes paw block-worker and validates command arguments", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createImplementingState("session-1", "slice-1"));
		const outputFile = await writeWorkerOutputFile(
			projectRoot,
			"session-1",
			createBlockedWorkerOutput({ session_id: "session-1" }),
		);

		await expect(handlePawCommand(["paw", "block-worker", "session-1", "--output-file", outputFile])).resolves.toBe(
			true,
		);
		await expect(handlePawCommand(["paw", "block-worker"])).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "block-worker", "--help"])).resolves.toBe(true);

		const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
		const stderr = errorSpy.mock.calls.map(([message]) => String(message)).join("\n");
		expect(stdout).toContain("Paw block-worker");
		expect(stdout).toContain("BLOCKED_PATCH_APPLY_FAILED");
		expect(stdout).toContain("pi paw block-worker");
		expect(stderr).toContain('Missing required session id for "paw block-worker".');
		expect(process.exitCode).toBe(1);
	});

	test("main routes paw block-worker before normal agent runtime", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
			throw new Error(`process.exit(${code ?? ""})`);
		}) as typeof process.exit);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createImplementingState("session-1", "slice-1"));
		const outputFile = await writeWorkerOutputFile(
			projectRoot,
			"session-1",
			createBlockedWorkerOutput({ session_id: "session-1" }),
		);

		await expect(main(["paw", "block-worker", "session-1", "--output-file", outputFile])).resolves.toBeUndefined();

		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toMatchObject({
			name: "BLOCKED_PATCH_APPLY_FAILED",
			current_slice_id: "slice-1",
		});
		expect(process.exitCode).toBeUndefined();
	});

	test("runPawBlockWorkerCommand surfaces parser errors via exit code", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "error").mockImplementation(() => {});

		await runPawBlockWorkerCommand([]);

		expect(process.exitCode).toBe(1);
	});
});
