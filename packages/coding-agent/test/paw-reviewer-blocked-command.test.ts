
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
	createPawBlockReviewerCommandResult,
	formatPawBlockReviewerCommandResult,
	parsePawBlockReviewerArgs,
	runPawBlockReviewerCommand,
} from "../src/paw/reviewer-blocked-command.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");
const sourceConfigPath = join(repoRoot, "paw-spec", "config.yaml");
const tempRoots: string[] = [];

let originalCwd: string;
let originalExitCode: typeof process.exitCode;

async function createTempProject(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-reviewer-blocked-command-"));
	tempRoots.push(root);
	await mkdir(join(root, "paw-spec"), { recursive: true });
	await writeFile(join(root, "paw-spec", "config.yaml"), await readFile(sourceConfigPath, "utf-8"), "utf-8");
	return root;
}

function createReviewingState(sessionId: string, sliceId = "slice-1"): PawSessionState {
	return {
		session_id: sessionId,
		name: "REVIEWING",
		current_slice_id: sliceId,
		pending_slice_ids: ["slice-2"],
		completed_slice_ids: [],
		blocked_reason: null,
	};
}

function createBlockedReviewerOutput(overrides: Partial<PawSubAgentOutput> = {}): PawSubAgentOutput {
	return {
		status: "blocked",
		confidence: "medium",
		agent: "reviewer",
		session_id: "session-1",
		slice_id: "slice-1",
		artifact_ref: ".paw/artifacts/session-1/reviewer/report.md",
		changed_files: [],
		inspected_files: [],
		risks: [],
		next_actions: ["Address the review findings and resume."],
		blocked_reason: {
			code: "TEST_FAILURE",
			message: "Reviewer found failing tests.",
			suggested_action: "Fix the failing tests identified during review.",
		},
		tokens_used: 42,
		usd_cost: 0.01,
		degraded: false,
		model_used: "model-1",
		...overrides,
	};
}

async function writeReviewerOutputFile(
	projectRoot: string,
	sessionId: string,
	output: PawSubAgentOutput,
): Promise<string> {
	const outputFile = join(projectRoot, `${sessionId}-reviewer-output.json`);
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

describe("parsePawBlockReviewerArgs", () => {
	test("parses required options and reports validation errors without throwing", () => {
		expect(parsePawBlockReviewerArgs(["session-1", "--output-file", "reviewer.json"])).toEqual({
			kind: "ok",
			sessionId: "session-1",
			input: { outputFile: "reviewer.json" },
		});
		expect(parsePawBlockReviewerArgs([])).toEqual({
			kind: "error",
			message: 'Missing required session id for "paw block-reviewer".',
		});
		expect(parsePawBlockReviewerArgs(["--output-file", "reviewer.json"])).toEqual({
			kind: "error",
			message: 'Missing required session id for "paw block-reviewer".',
		});
		expect(parsePawBlockReviewerArgs(["-session", "--output-file", "reviewer.json"])).toEqual({
			kind: "error",
			message: 'Missing required session id for "paw block-reviewer".',
		});
		expect(parsePawBlockReviewerArgs(["session-1"])).toEqual({
			kind: "error",
			message: 'Missing required option for "paw block-reviewer": --output-file',
		});
		expect(parsePawBlockReviewerArgs(["session-1", "--output-file"])).toEqual({
			kind: "error",
			message: 'Missing value for "paw block-reviewer" option: --output-file',
		});
		expect(parsePawBlockReviewerArgs(["session-1", "--output-file", "a.json", "--output-file", "b.json"])).toEqual({
			kind: "error",
			message: 'Duplicate option for "paw block-reviewer": --output-file',
		});
		expect(parsePawBlockReviewerArgs(["session-1", "extra", "--output-file", "a.json"])).toEqual({
			kind: "error",
			message: 'Unknown option for "paw block-reviewer": extra',
		});
		expect(parsePawBlockReviewerArgs(["session-1", "--output-file", "a.json", "--bogus", "x"])).toEqual({
			kind: "error",
			message: 'Unknown option for "paw block-reviewer": --bogus',
		});
		expect(parsePawBlockReviewerArgs(["--help"])).toEqual({ kind: "help" });
	});
});

describe("Paw block-reviewer command", () => {
	test("blocks REVIEWING to BLOCKED_TEST_FAILURE and releases lock", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const state = createReviewingState("session-1", "slice-1");
		await writePawSessionState(projectRoot, state);
		const outputFile = await writeReviewerOutputFile(
			projectRoot,
			"session-1",
			createBlockedReviewerOutput({ session_id: "session-1" }),
		);

		const result = await createPawBlockReviewerCommandResult(
			projectRoot,
			"session-1",
			{ outputFile },
			{ lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);

		expect(result.status).toBe("blocked");
		if (result.status !== "blocked") return;
		expect(result.selectedSliceId).toBe("slice-1");
		expect(result.previousStateName).toBe("REVIEWING");
		expect(result.nextStateName).toBe("BLOCKED_TEST_FAILURE");
		expect(result.blockedReasonCode).toBe("TEST_FAILURE");
		expect(result.lockReleased).toBe(true);
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toMatchObject({
			name: "BLOCKED_TEST_FAILURE",
			current_slice_id: "slice-1",
		});
		expect(formatPawBlockReviewerCommandResult(result)).toContain("REVIEWING -> BLOCKED_TEST_FAILURE");
		expect(await getPawSessionLockStatus(projectRoot, "session-1", { nowMs: 2_500 })).toEqual({
			status: "unlocked",
		});
	});

	test("reports missing project, session, and output file without acquiring lock", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);

		const missingProject = await createPawBlockReviewerCommandResult(projectRoot, "session-1", {
			outputFile: join(projectRoot, "reviewer-output.json"),
		});
		expect(missingProject).toEqual({ status: "missing_project", pawDir: ".paw" });
		expect(existsSync(join(projectRoot, ".paw"))).toBe(false);

		vi.spyOn(console, "log").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);

		const missingSession = await createPawBlockReviewerCommandResult(projectRoot, "missing", {
			outputFile: join(projectRoot, "reviewer-output.json"),
		});
		expect(missingSession).toEqual({
			status: "missing_session",
			sessionId: "missing",
			stateFile: ".paw/sessions/missing/state.json",
		});

		await writePawSessionState(projectRoot, createReviewingState("session-1", "slice-1"));
		const missingOutput = await createPawBlockReviewerCommandResult(projectRoot, "session-1", {
			outputFile: join(projectRoot, "missing-reviewer-output.json"),
		});
		expect(missingOutput).toEqual({
			status: "missing_output_file",
			sessionId: "session-1",
			outputFile: "missing-reviewer-output.json",
		});
	});

	test("reports invalid output file before acquiring lock", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		await writePawSessionState(projectRoot, createReviewingState("session-1", "slice-1"));
		const outputFile = join(projectRoot, "invalid-reviewer-output.json");
		await writeFile(outputFile, "{not-json", "utf-8");

		const result = await createPawBlockReviewerCommandResult(projectRoot, "session-1", { outputFile });

		expect(result.status).toBe("invalid_output_file");
		if (result.status !== "invalid_output_file") return;
		expect(result.outputFile).toBe("invalid-reviewer-output.json");
		expect(result.issues[0]?.path).toBe("/");
		expect(await getPawSessionLockStatus(projectRoot, "session-1", { nowMs: 2_500 })).toEqual({
			status: "unlocked",
		});
	});

	test("reports live foreign locks without releasing them", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		await writePawSessionState(projectRoot, createReviewingState("locked-session", "slice-1"));
		const outputFile = await writeReviewerOutputFile(
			projectRoot,
			"locked-session",
			createBlockedReviewerOutput({ session_id: "locked-session" }),
		);
		const liveForeignLock: PawSessionLock = { pid: process.pid, host: "other-host", heartbeat_ts: 2_000, ttl: 120 };
		await writeLock(projectRoot, "locked-session", liveForeignLock);

		const locked = await createPawBlockReviewerCommandResult(
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
			...createReviewingState("wrong-state", "slice-1"),
			name: "IMPLEMENTING",
		};
		const noSliceState: PawSessionState = {
			...createReviewingState("no-slice", "slice-1"),
			current_slice_id: null,
		};
		await writePawSessionState(projectRoot, wrongState);
		await writePawSessionState(projectRoot, noSliceState);
		const wrongOutput = await writeReviewerOutputFile(
			projectRoot,
			"wrong-state",
			createBlockedReviewerOutput({ session_id: "wrong-state" }),
		);
		const noSliceOutput = await writeReviewerOutputFile(
			projectRoot,
			"no-slice",
			createBlockedReviewerOutput({ session_id: "no-slice" }),
		);

		const wrong = await createPawBlockReviewerCommandResult(
			projectRoot,
			"wrong-state",
			{ outputFile: wrongOutput },
			{ lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);
		const noSlice = await createPawBlockReviewerCommandResult(
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

	test("reviewer_not_blocked, invalid_reviewer_output, and invalid_blocked_reason release acquired lock without mutation", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const nonBlockedState = createReviewingState("non-blocked", "slice-1");
		const mismatchState = createReviewingState("mismatch", "slice-1");
		const invalidReasonState = createReviewingState("invalid-reason", "slice-1");
		await writePawSessionState(projectRoot, nonBlockedState);
		await writePawSessionState(projectRoot, mismatchState);
		await writePawSessionState(projectRoot, invalidReasonState);
		const nonBlockedOutput = await writeReviewerOutputFile(
			projectRoot,
			"non-blocked",
			createBlockedReviewerOutput({ session_id: "non-blocked", status: "pass" }),
		);
		const mismatchOutput = await writeReviewerOutputFile(
			projectRoot,
			"mismatch",
			createBlockedReviewerOutput({
				session_id: "mismatch",
				agent: "reviewer",
				slice_id: "slice-2",
			}),
		);
		const invalidReasonOutput = await writeReviewerOutputFile(
			projectRoot,
			"invalid-reason",
			createBlockedReviewerOutput({
				session_id: "invalid-reason",
				blocked_reason: {
					code: "TEST_FAILURE",
					message: "",
					suggested_action: "",
				},
			}),
		);

		const nonBlocked = await createPawBlockReviewerCommandResult(
			projectRoot,
			"non-blocked",
			{ outputFile: nonBlockedOutput },
			{ lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);
		const mismatch = await createPawBlockReviewerCommandResult(
			projectRoot,
			"mismatch",
			{ outputFile: mismatchOutput },
			{ lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);
		const invalidReason = await createPawBlockReviewerCommandResult(
			projectRoot,
			"invalid-reason",
			{ outputFile: invalidReasonOutput },
			{ lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);

		expect(nonBlocked.status).toBe("reviewer_not_blocked");
		if (nonBlocked.status !== "reviewer_not_blocked") return;
		expect(nonBlocked.lockReleased).toBe(true);
		expect(mismatch.status).toBe("invalid_reviewer_output");
		if (mismatch.status !== "invalid_reviewer_output") return;
		expect(mismatch.lockReleased).toBe(true);
		expect(invalidReason.status).toBe("invalid_blocked_reason");
		if (invalidReason.status !== "invalid_blocked_reason") return;
		expect(invalidReason.lockReleased).toBe(true);
		await expect(readPawSessionState(projectRoot, "non-blocked")).resolves.toEqual(nonBlockedState);
		await expect(readPawSessionState(projectRoot, "mismatch")).resolves.toEqual(mismatchState);
		await expect(readPawSessionState(projectRoot, "invalid-reason")).resolves.toEqual(invalidReasonState);
	});

	test("routes paw block-reviewer and validates command arguments", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createReviewingState("session-1", "slice-1"));
		const outputFile = await writeReviewerOutputFile(
			projectRoot,
			"session-1",
			createBlockedReviewerOutput({ session_id: "session-1" }),
		);

		await expect(handlePawCommand(["paw", "block-reviewer", "session-1", "--output-file", outputFile])).resolves.toBe(
			true,
		);
		await expect(handlePawCommand(["paw", "block-reviewer"])).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "block-reviewer", "--help"])).resolves.toBe(true);

		const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
		const stderr = errorSpy.mock.calls.map(([message]) => String(message)).join("\n");
		expect(stdout).toContain("Paw block-reviewer");
		expect(stdout).toContain("BLOCKED_TEST_FAILURE");
		expect(stdout).toContain("pi paw block-reviewer");
		expect(stderr).toContain('Missing required session id for "paw block-reviewer".');
		expect(process.exitCode).toBe(1);
	});

	test("main routes paw block-reviewer before normal agent runtime", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
			throw new Error(`process.exit(${code ?? ""})`);
		}) as typeof process.exit);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createReviewingState("session-1", "slice-1"));
		const outputFile = await writeReviewerOutputFile(
			projectRoot,
			"session-1",
			createBlockedReviewerOutput({ session_id: "session-1" }),
		);

		await expect(main(["paw", "block-reviewer", "session-1", "--output-file", outputFile])).resolves.toBeUndefined();

		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toMatchObject({
			name: "BLOCKED_TEST_FAILURE",
			current_slice_id: "slice-1",
		});
		expect(process.exitCode).toBeUndefined();
	});

	test("runPawBlockReviewerCommand surfaces parser errors via exit code", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "error").mockImplementation(() => {});

		await runPawBlockReviewerCommand([]);

		expect(process.exitCode).toBe(1);
	});
});
