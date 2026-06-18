
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
	readPawSliceJournal,
	resolvePawSessionPaths,
	writePawJsonAtomic,
	writePawSessionState,
} from "../src/paw/index.ts";
import { handlePawCommand } from "../src/paw/init-command.ts";
import {
	createPawCompleteWorkerCommandResult,
	formatPawCompleteWorkerCommandResult,
	parsePawCompleteWorkerArgs,
	runPawCompleteWorkerCommand,
} from "../src/paw/worker-result-command.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");
const sourceConfigPath = join(repoRoot, "paw-spec", "config.yaml");
const tempRoots: string[] = [];
const timestamp = "2026-06-16T00:00:00.000Z";

let originalCwd: string;
let originalExitCode: typeof process.exitCode;

async function createTempProject(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-worker-result-command-"));
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

function createWorkerOutput(overrides: Partial<PawSubAgentOutput> = {}): PawSubAgentOutput {
	return {
		status: "pass",
		confidence: "high",
		agent: "worker",
		session_id: "session-1",
		slice_id: "slice-1",
		artifact_ref: ".paw/artifacts/session-1/worker/report.md",
		changed_files: [
			{
				path: "src/a.ts",
				change_type: "modify",
				content_hash: "sha256:first",
				apply_method: "diff",
			},
			{
				path: "src/b.ts",
				change_type: "create",
				content_hash: "sha256:second",
			},
		],
		inspected_files: [],
		risks: [],
		next_actions: [],
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

describe("parsePawCompleteWorkerArgs", () => {
	test("parses required options and reports validation errors without throwing", () => {
		expect(parsePawCompleteWorkerArgs(["session-1", "--output-file", "worker.json"])).toEqual({
			kind: "ok",
			sessionId: "session-1",
			input: { outputFile: "worker.json" },
		});
		expect(
			parsePawCompleteWorkerArgs(["session-1", "--output-file", "worker.json", "--timestamp", timestamp]),
		).toEqual({
			kind: "ok",
			sessionId: "session-1",
			input: { outputFile: "worker.json", timestamp },
		});
		expect(parsePawCompleteWorkerArgs([])).toEqual({
			kind: "error",
			message: 'Missing required session id for "paw complete-worker".',
		});
		expect(parsePawCompleteWorkerArgs(["--output-file", "worker.json"])).toEqual({
			kind: "error",
			message: 'Missing required session id for "paw complete-worker".',
		});
		expect(parsePawCompleteWorkerArgs(["-session", "--output-file", "worker.json"])).toEqual({
			kind: "error",
			message: 'Missing required session id for "paw complete-worker".',
		});
		expect(parsePawCompleteWorkerArgs(["session-1"])).toEqual({
			kind: "error",
			message: 'Missing required option for "paw complete-worker": --output-file',
		});
		expect(parsePawCompleteWorkerArgs(["session-1", "--output-file"])).toEqual({
			kind: "error",
			message: 'Missing value for "paw complete-worker" option: --output-file',
		});
		expect(parsePawCompleteWorkerArgs(["session-1", "--output-file", "a.json", "--output-file", "b.json"])).toEqual({
			kind: "error",
			message: 'Duplicate option for "paw complete-worker": --output-file',
		});
		expect(
			parsePawCompleteWorkerArgs([
				"session-1",
				"--output-file",
				"a.json",
				"--timestamp",
				timestamp,
				"--timestamp",
				timestamp,
			]),
		).toEqual({
			kind: "error",
			message: 'Duplicate option for "paw complete-worker": --timestamp',
		});
		expect(parsePawCompleteWorkerArgs(["session-1", "--output-file", "a.json", "--timestamp", "not-a-date"])).toEqual(
			{
				kind: "error",
				message: 'Invalid timestamp for "paw complete-worker": not-a-date',
			},
		);
		expect(parsePawCompleteWorkerArgs(["session-1", "extra", "--output-file", "a.json"])).toEqual({
			kind: "error",
			message: 'Unknown option for "paw complete-worker": extra',
		});
		expect(parsePawCompleteWorkerArgs(["session-1", "--output-file", "a.json", "--bogus", "x"])).toEqual({
			kind: "error",
			message: 'Unknown option for "paw complete-worker": --bogus',
		});
		expect(parsePawCompleteWorkerArgs(["--help"])).toEqual({ kind: "help" });
	});
});

describe("Paw complete-worker command", () => {
	test("completes IMPLEMENTING to REVIEWING with journal entries and releases lock", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const state = createImplementingState("session-1", "slice-1");
		await writePawSessionState(projectRoot, state);
		const outputFile = await writeWorkerOutputFile(projectRoot, "session-1", createWorkerOutput());

		const result = await createPawCompleteWorkerCommandResult(
			projectRoot,
			"session-1",
			{ outputFile, timestamp },
			{ lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);

		expect(result.status).toBe("completed");
		if (result.status !== "completed") return;
		expect(result.selectedSliceId).toBe("slice-1");
		expect(result.previousStateName).toBe("IMPLEMENTING");
		expect(result.nextStateName).toBe("REVIEWING");
		expect(result.journalEntryCount).toBe(2);
		expect(result.lockReleased).toBe(true);
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toEqual({
			...state,
			name: "REVIEWING",
		});
		await expect(readPawSliceJournal(projectRoot, "session-1")).resolves.toHaveLength(2);
		expect(formatPawCompleteWorkerCommandResult(result)).toContain("IMPLEMENTING -> REVIEWING");
		expect(await getPawSessionLockStatus(projectRoot, "session-1", { nowMs: 2_500 })).toEqual({
			status: "unlocked",
		});
	});

	test("reports missing project, session, and output file without acquiring lock", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);

		const missingProject = await createPawCompleteWorkerCommandResult(projectRoot, "session-1", {
			outputFile: join(projectRoot, "worker-output.json"),
		});
		expect(missingProject).toEqual({ status: "missing_project", pawDir: ".paw" });
		expect(existsSync(join(projectRoot, ".paw"))).toBe(false);

		vi.spyOn(console, "log").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);

		const missingSession = await createPawCompleteWorkerCommandResult(projectRoot, "missing", {
			outputFile: join(projectRoot, "worker-output.json"),
		});
		expect(missingSession).toEqual({
			status: "missing_session",
			sessionId: "missing",
			stateFile: ".paw/sessions/missing/state.json",
		});

		await writePawSessionState(projectRoot, createImplementingState("session-1", "slice-1"));
		const missingOutput = await createPawCompleteWorkerCommandResult(projectRoot, "session-1", {
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

		const result = await createPawCompleteWorkerCommandResult(projectRoot, "session-1", { outputFile });

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
			createWorkerOutput({ session_id: "locked-session" }),
		);
		const liveForeignLock: PawSessionLock = { pid: process.pid, host: "other-host", heartbeat_ts: 2_000, ttl: 120 };
		await writeLock(projectRoot, "locked-session", liveForeignLock);

		const locked = await createPawCompleteWorkerCommandResult(
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
			createWorkerOutput({ session_id: "wrong-state" }),
		);
		const noSliceOutput = await writeWorkerOutputFile(
			projectRoot,
			"no-slice",
			createWorkerOutput({ session_id: "no-slice" }),
		);

		const wrong = await createPawCompleteWorkerCommandResult(
			projectRoot,
			"wrong-state",
			{ outputFile: wrongOutput },
			{ lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);
		const noSlice = await createPawCompleteWorkerCommandResult(
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

	test("worker_not_passed and invalid_worker_output release acquired lock without mutation", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const nonPassState = createImplementingState("non-pass", "slice-1");
		const mismatchState = createImplementingState("mismatch", "slice-1");
		await writePawSessionState(projectRoot, nonPassState);
		await writePawSessionState(projectRoot, mismatchState);
		const nonPassOutput = await writeWorkerOutputFile(
			projectRoot,
			"non-pass",
			createWorkerOutput({
				session_id: "non-pass",
				status: "blocked",
				blocked_reason: { code: "TEST_FAILURE", message: "tests failed" },
			}),
		);
		const mismatchOutput = await writeWorkerOutputFile(
			projectRoot,
			"mismatch",
			createWorkerOutput({ session_id: "mismatch", agent: "reviewer", slice_id: "slice-2" }),
		);

		const nonPass = await createPawCompleteWorkerCommandResult(
			projectRoot,
			"non-pass",
			{ outputFile: nonPassOutput },
			{ lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);
		const mismatch = await createPawCompleteWorkerCommandResult(
			projectRoot,
			"mismatch",
			{ outputFile: mismatchOutput },
			{ lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);

		expect(nonPass.status).toBe("worker_not_passed");
		if (nonPass.status !== "worker_not_passed") return;
		expect(nonPass.lockReleased).toBe(true);
		expect(mismatch.status).toBe("invalid_worker_output");
		if (mismatch.status !== "invalid_worker_output") return;
		expect(mismatch.lockReleased).toBe(true);
		await expect(readPawSessionState(projectRoot, "non-pass")).resolves.toEqual(nonPassState);
		await expect(readPawSessionState(projectRoot, "mismatch")).resolves.toEqual(mismatchState);
	});

	test("routes paw complete-worker and validates command arguments", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createImplementingState("session-1", "slice-1"));
		const outputFile = await writeWorkerOutputFile(projectRoot, "session-1", createWorkerOutput());

		await expect(
			handlePawCommand([
				"paw",
				"complete-worker",
				"session-1",
				"--output-file",
				outputFile,
				"--timestamp",
				timestamp,
			]),
		).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "complete-worker"])).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "complete-worker", "--help"])).resolves.toBe(true);

		const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
		const stderr = errorSpy.mock.calls.map(([message]) => String(message)).join("\n");
		expect(stdout).toContain("Paw complete-worker");
		expect(stdout).toContain("REVIEWING");
		expect(stdout).toContain("pi paw complete-worker");
		expect(stderr).toContain('Missing required session id for "paw complete-worker".');
		expect(process.exitCode).toBe(1);
	});

	test("main routes paw complete-worker before normal agent runtime", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
			throw new Error(`process.exit(${code ?? ""})`);
		}) as typeof process.exit);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createImplementingState("session-1", "slice-1"));
		const outputFile = await writeWorkerOutputFile(projectRoot, "session-1", createWorkerOutput());

		await expect(
			main(["paw", "complete-worker", "session-1", "--output-file", outputFile, "--timestamp", timestamp]),
		).resolves.toBeUndefined();

		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toMatchObject({
			name: "REVIEWING",
			current_slice_id: "slice-1",
		});
		expect(process.exitCode).toBeUndefined();
	});

	test("runPawCompleteWorkerCommand surfaces parser errors via exit code", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "error").mockImplementation(() => {});

		await runPawCompleteWorkerCommand([]);

		expect(process.exitCode).toBe(1);
	});
});
