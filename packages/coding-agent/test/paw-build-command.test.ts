import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { main } from "../src/main.ts";
import {
	createPawBuildCommandResult,
	formatPawBuildCommandResult,
	parsePawBuildArgs,
	runPawBuildCommand,
} from "../src/paw/build-command.ts";
import {
	getPawSessionLockStatus,
	loadDefaultPawRuntimeConfig,
	type PawProviderSubAgentModelRegistry,
	type PawSessionLock,
	type PawSessionState,
	type PawSubAgentOutput,
	type PawSubAgentRuntimeExecutor,
	readPawSessionState,
	readPawSliceJournal,
	readPawVerificationEvidence,
	resolvePawSessionPaths,
	writePawJsonAtomic,
	writePawSessionState,
} from "../src/paw/index.ts";
import { handlePawCommand } from "../src/paw/init-command.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");
const sourceConfigPath = join(repoRoot, "paw-spec", "config.yaml");
const tempRoots: string[] = [];
const timestamp = "2026-06-17T00:00:00.000Z";

let originalCwd: string;
let originalExitCode: typeof process.exitCode;

async function createTempProject(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-build-command-"));
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

function createReviewingState(sessionId: string, sliceId = "slice-1"): PawSessionState {
	return {
		...createImplementingState(sessionId, sliceId),
		name: "REVIEWING",
	};
}

function createVerifyingState(sessionId: string, sliceId = "slice-1"): PawSessionState {
	return {
		...createImplementingState(sessionId, sliceId),
		name: "VERIFYING",
	};
}

function createPlanApprovedState(sessionId: string): PawSessionState {
	return {
		session_id: sessionId,
		name: "PLAN_APPROVED",
		current_slice_id: null,
		pending_slice_ids: ["slice-1", "slice-2"],
		completed_slice_ids: [],
		blocked_reason: null,
	};
}

function createSliceSelectState(sessionId: string, sliceId = "slice-1"): PawSessionState {
	return {
		session_id: sessionId,
		name: "SLICE_SELECT",
		current_slice_id: sliceId,
		pending_slice_ids: ["slice-2"],
		completed_slice_ids: [],
		blocked_reason: null,
	};
}

function createSliceDoneState(sessionId: string, pendingSliceIds: string[] = ["slice-2"]): PawSessionState {
	return {
		session_id: sessionId,
		name: "SLICE_DONE",
		current_slice_id: null,
		pending_slice_ids: pendingSliceIds,
		completed_slice_ids: ["slice-1"],
		blocked_reason: null,
	};
}

function createWorkerOutput(overrides: Partial<PawSubAgentOutput> = {}): PawSubAgentOutput {
	return {
		status: "pass",
		confidence: "high",
		agent: "worker",
		session_id: overrides.session_id ?? "session-1",
		slice_id: "slice-1",
		artifact_ref: overrides.artifact_ref ?? ".paw/artifacts/session-1/worker/report.md",
		changed_files: [
			{
				path: "src/a.ts",
				change_type: "modify",
				content_hash: "sha256:first",
				apply_method: "diff",
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

function createBlockedWorkerOutput(overrides: Partial<PawSubAgentOutput> = {}): PawSubAgentOutput {
	return createWorkerOutput({
		status: "blocked",
		confidence: "medium",
		changed_files: [],
		blocked_reason: {
			code: "PATCH_APPLY_FAILED",
			message: "Patch failed to apply.",
			suggested_action: "Re-derive the patch for the current file contents.",
		},
		next_actions: ["Fix the patch conflict and resume."],
		...overrides,
	});
}

function createReviewerOutput(overrides: Partial<PawSubAgentOutput> = {}): PawSubAgentOutput {
	return {
		status: "pass",
		confidence: "high",
		agent: "reviewer",
		session_id: overrides.session_id ?? "session-1",
		slice_id: "slice-1",
		artifact_ref: overrides.artifact_ref ?? ".paw/artifacts/session-1/reviewer/report.md",
		changed_files: [],
		inspected_files: [{ path: "src/a.ts", line_span: "1-10", rationale: "Reviewed worker change." }],
		risks: [],
		next_actions: [],
		tokens_used: 24,
		usd_cost: 0.02,
		degraded: false,
		model_used: "model-1",
		...overrides,
	};
}

function createBlockedReviewerOutput(overrides: Partial<PawSubAgentOutput> = {}): PawSubAgentOutput {
	return createReviewerOutput({
		status: "blocked",
		confidence: "medium",
		blocked_reason: {
			code: "TEST_FAILURE",
			message: "Reviewer found failing behavior.",
			suggested_action: "Return to worker and fix the behavior.",
		},
		next_actions: ["Fix the reviewed behavior and resume."],
		...overrides,
	});
}

function createExecutor(outputs: string[]): PawSubAgentRuntimeExecutor {
	let index = 0;
	return () => {
		const rawOutput = outputs[index] ?? outputs[outputs.length - 1] ?? "";
		index += 1;
		return { raw_output: rawOutput, model_id: "executor-model" };
	};
}

function createAssistantMessage(text: string, overrides: Partial<AssistantMessage> = {}): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "fake-provider",
		model: "fake-model",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 0,
		...overrides,
	};
}

function createModel(modelId: string): Model<"anthropic-messages"> {
	return {
		id: modelId,
		name: `Fake ${modelId}`,
		api: "anthropic-messages",
		provider: "fake-provider",
		baseUrl: "http://localhost:0",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 4096,
	};
}

function createFakeModelRegistry(): PawProviderSubAgentModelRegistry {
	return {
		find: (provider, modelId) => (provider === "fake-provider" ? createModel(modelId) : undefined),
		hasConfiguredAuth: () => true,
		getApiKeyAndHeaders: () => ({ ok: true, apiKey: "fake-key", headers: { "x-fake": "1" } }),
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

describe("parsePawBuildArgs", () => {
	test("parses one-step build arguments and reports validation errors", () => {
		expect(parsePawBuildArgs(["session-1", "--once"])).toEqual({
			kind: "ok",
			sessionId: "session-1",
			input: { once: true },
		});
		expect(parsePawBuildArgs(["session-1", "--once", "--handoff", "Do work", "--timestamp", timestamp])).toEqual({
			kind: "ok",
			sessionId: "session-1",
			input: { once: true, handoff: "Do work", timestamp },
		});
		expect(parsePawBuildArgs(["session-1", "--max-steps", "3", "--handoff", "Do work"])).toEqual({
			kind: "ok",
			sessionId: "session-1",
			input: { maxSteps: 3, handoff: "Do work" },
		});
		expect(parsePawBuildArgs([])).toEqual({ kind: "error", message: 'Missing required session id for "paw build".' });
		expect(parsePawBuildArgs(["--once"])).toEqual({
			kind: "error",
			message: 'Missing required session id for "paw build".',
		});
		expect(parsePawBuildArgs(["session-1"])).toEqual({
			kind: "error",
			message: 'Missing required option for "paw build": --once or --max-steps <n>',
		});
		expect(parsePawBuildArgs(["session-1", "--once", "--once"])).toEqual({
			kind: "error",
			message: 'Duplicate option for "paw build": --once',
		});
		expect(parsePawBuildArgs(["session-1", "--once", "--max-steps", "3"])).toEqual({
			kind: "error",
			message: 'Options for "paw build" are mutually exclusive: --once and --max-steps',
		});
		expect(parsePawBuildArgs(["session-1", "--max-steps"])).toEqual({
			kind: "error",
			message: 'Missing value for "paw build" option: --max-steps',
		});
		expect(parsePawBuildArgs(["session-1", "--max-steps", "0"])).toEqual({
			kind: "error",
			message: 'Option --max-steps for "paw build" must be a positive integer.',
		});
		expect(parsePawBuildArgs(["session-1", "--max-steps", "1.5"])).toEqual({
			kind: "error",
			message: 'Option --max-steps for "paw build" must be a positive integer.',
		});
		expect(parsePawBuildArgs(["session-1", "--max-steps", "abc"])).toEqual({
			kind: "error",
			message: 'Option --max-steps for "paw build" must be a positive integer.',
		});
		expect(parsePawBuildArgs(["session-1", "--once", "--handoff"])).toEqual({
			kind: "error",
			message: 'Missing value for "paw build" option: --handoff',
		});
		expect(parsePawBuildArgs(["session-1", "--once", "--timestamp", "not-a-date"])).toEqual({
			kind: "error",
			message: 'Invalid timestamp for "paw build": not-a-date',
		});
		expect(parsePawBuildArgs(["session-1", "extra", "--once"])).toEqual({
			kind: "error",
			message: 'Unknown option for "paw build": extra',
		});
		expect(parsePawBuildArgs(["--help"])).toEqual({ kind: "help" });
	});
});

describe("Paw build command", () => {
	test("runs a bounded build loop and stops at max steps", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const config = loadDefaultPawRuntimeConfig(projectRoot);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createPlanApprovedState("session-1"));
		const executor = createExecutor([JSON.stringify(createWorkerOutput())]);

		const result = await createPawBuildCommandResult(
			projectRoot,
			"session-1",
			{ maxSteps: 3, timestamp },
			{ config, executor, lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);

		expect(result.status).toBe("max_steps_reached");
		if (result.status !== "max_steps_reached") return;
		expect(result.stepsRun).toBe(3);
		expect(result.maxSteps).toBe(3);
		expect(result.stopReason).toBe("max_steps_reached");
		expect(result.finalStateName).toBe("REVIEWING");
		expect(result.stepResults.map((step) => step.status)).toEqual(["advanced", "advanced", "completed"]);
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toMatchObject({ name: "REVIEWING" });
		expect(formatPawBuildCommandResult(result)).toContain("steps run: 3");
	});

	test("completes a bounded build loop when no pending slices remain", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const config = loadDefaultPawRuntimeConfig(projectRoot);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, {
			...createPlanApprovedState("session-1"),
			pending_slice_ids: ["slice-1"],
		});
		const executor = createExecutor([JSON.stringify(createWorkerOutput()), JSON.stringify(createReviewerOutput())]);

		const result = await createPawBuildCommandResult(
			projectRoot,
			"session-1",
			{ maxSteps: 10 },
			{ config, executor, lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);

		expect(result.status).toBe("loop_completed");
		if (result.status !== "loop_completed") return;
		expect(result.stepsRun).toBe(6);
		expect(result.stopReason).toBe("no_pending_slices");
		expect(result.finalStateName).toBe("FINAL_REPORT");
		expect(result.stepResults.map((step) => step.status)).toEqual([
			"advanced",
			"advanced",
			"completed",
			"completed",
			"completed_with_unverified",
			"no_pending_slices",
		]);
		expect(result.finalReport?.status).toBe("completed");
		if (result.finalReport?.status !== "completed") return;
		expect(result.finalReport.reportStatus).toBe("done_with_unverified");
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toMatchObject({
			name: "FINAL_REPORT",
			pending_slice_ids: [],
			completed_slice_ids: ["slice-1"],
		});
		await expect(readFile(result.finalReport.summaryFile, "utf-8")).resolves.toContain(
			"Paw build completed 6 step(s)",
		);
		const reportJson = JSON.parse(await readFile(result.finalReport.reportJsonFile, "utf-8"));
		expect(reportJson.status).toBe("done_with_unverified");
		expect(reportJson.unverified_gates.length).toBeGreaterThan(0);
		expect(formatPawBuildCommandResult(result)).toContain("final report: done_with_unverified");
	});

	test("stops a bounded build loop on provider unavailable block", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createPlanApprovedState("session-1"));

		const result = await createPawBuildCommandResult(projectRoot, "session-1", { maxSteps: 10 });

		expect(result.status).toBe("loop_stopped");
		if (result.status !== "loop_stopped") return;
		expect(result.stepsRun).toBe(3);
		expect(result.stopReason).toBe("blocked");
		expect(result.finalStateName).toBe("BLOCKED_PROVIDER_UNAVAILABLE");
		expect(result.stepResults.map((step) => step.status)).toEqual(["advanced", "advanced", "blocked"]);
	});

	test("selects a slice from PLAN_APPROVED to SLICE_SELECT and releases lock", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createPlanApprovedState("session-1"));

		const result = await createPawBuildCommandResult(
			projectRoot,
			"session-1",
			{ once: true },
			{
				lockOptions: { nowMs: 2_000, ttlSec: 120 },
			},
		);

		expect(result.status).toBe("advanced");
		if (result.status !== "advanced") return;
		expect(result.selectedSliceId).toBe("slice-1");
		expect(result.previousStateName).toBe("PLAN_APPROVED");
		expect(result.nextStateName).toBe("SLICE_SELECT");
		expect(result.lockReleased).toBe(true);
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toMatchObject({
			name: "SLICE_SELECT",
			current_slice_id: "slice-1",
			pending_slice_ids: ["slice-2"],
		});
		expect(formatPawBuildCommandResult(result)).toContain("PLAN_APPROVED -> SLICE_SELECT");
		expect(await getPawSessionLockStatus(projectRoot, "session-1", { nowMs: 2_500 })).toEqual({
			status: "unlocked",
		});
	});

	test("begins implementation from SLICE_SELECT to IMPLEMENTING and releases lock", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createSliceSelectState("session-1", "slice-1"));

		const result = await createPawBuildCommandResult(
			projectRoot,
			"session-1",
			{ once: true },
			{
				lockOptions: { nowMs: 2_000, ttlSec: 120 },
			},
		);

		expect(result.status).toBe("advanced");
		if (result.status !== "advanced") return;
		expect(result.selectedSliceId).toBe("slice-1");
		expect(result.previousStateName).toBe("SLICE_SELECT");
		expect(result.nextStateName).toBe("IMPLEMENTING");
		expect(result.lockReleased).toBe(true);
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toMatchObject({
			name: "IMPLEMENTING",
			current_slice_id: "slice-1",
		});
		expect(formatPawBuildCommandResult(result)).toContain("SLICE_SELECT -> IMPLEMENTING");
		expect(await getPawSessionLockStatus(projectRoot, "session-1", { nowMs: 2_500 })).toEqual({
			status: "unlocked",
		});
	});

	test("selects the next pending slice from SLICE_DONE and reports no pending slices", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createSliceDoneState("session-1", ["slice-2"]));
		await writePawSessionState(projectRoot, createSliceDoneState("done", []));

		const selected = await createPawBuildCommandResult(
			projectRoot,
			"session-1",
			{ once: true },
			{
				lockOptions: { nowMs: 2_000, ttlSec: 120 },
			},
		);
		const done = await createPawBuildCommandResult(
			projectRoot,
			"done",
			{ once: true },
			{
				lockOptions: { nowMs: 3_000, ttlSec: 120 },
			},
		);

		expect(selected.status).toBe("advanced");
		if (selected.status !== "advanced") return;
		expect(selected.previousStateName).toBe("SLICE_DONE");
		expect(selected.nextStateName).toBe("SLICE_SELECT");
		expect(selected.selectedSliceId).toBe("slice-2");
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toMatchObject({
			name: "SLICE_SELECT",
			current_slice_id: "slice-2",
			completed_slice_ids: ["slice-1"],
		});
		expect(done.status).toBe("no_pending_slices");
		if (done.status !== "no_pending_slices") return;
		expect(done.previousStateName).toBe("SLICE_DONE");
		expect(done.lockReleased).toBe(true);
		await expect(readPawSessionState(projectRoot, "done")).resolves.toEqual(createSliceDoneState("done", []));
		expect(formatPawBuildCommandResult(done)).toContain("no_pending_slices");
	});

	test("runs one worker pass from IMPLEMENTING to REVIEWING and releases lock", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const config = loadDefaultPawRuntimeConfig(projectRoot);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createImplementingState("session-1", "slice-1"));
		const executor = createExecutor([JSON.stringify(createWorkerOutput())]);

		const result = await createPawBuildCommandResult(
			projectRoot,
			"session-1",
			{ once: true, timestamp },
			{ config, executor, lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);

		expect(result.status).toBe("completed");
		if (result.status !== "completed" || !("selectedSliceId" in result)) return;
		expect(result.selectedSliceId).toBe("slice-1");
		expect(result.previousStateName).toBe("IMPLEMENTING");
		expect(result.nextStateName).toBe("REVIEWING");
		expect(result.attempts).toBe(1);
		expect(result.journalEntryCount).toBe(1);
		expect(result.lockReleased).toBe(true);
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toMatchObject({ name: "REVIEWING" });
		await expect(readPawSliceJournal(projectRoot, "session-1")).resolves.toHaveLength(1);
		expect(formatPawBuildCommandResult(result)).toContain("IMPLEMENTING -> REVIEWING");
		expect(await getPawSessionLockStatus(projectRoot, "session-1", { nowMs: 2_500 })).toEqual({
			status: "unlocked",
		});
	});

	test("runs one blocked worker result into BLOCKED state", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const config = loadDefaultPawRuntimeConfig(projectRoot);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createImplementingState("session-1", "slice-1"));
		const executor = createExecutor([JSON.stringify(createBlockedWorkerOutput())]);

		const result = await createPawBuildCommandResult(
			projectRoot,
			"session-1",
			{ once: true },
			{ config, executor, lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);

		expect(result.status).toBe("blocked");
		if (result.status !== "blocked") return;
		expect(result.nextStateName).toBe("BLOCKED_PATCH_APPLY_FAILED");
		expect(result.blockedReasonCode).toBe("PATCH_APPLY_FAILED");
		expect(result.attempts).toBe(1);
		expect(result.lockReleased).toBe(true);
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toMatchObject({
			name: "BLOCKED_PATCH_APPLY_FAILED",
			current_slice_id: "slice-1",
		});
	});

	test("runs one reviewer pass from REVIEWING to VERIFYING and releases lock", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const config = loadDefaultPawRuntimeConfig(projectRoot);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createReviewingState("session-1", "slice-1"));
		const executor = createExecutor([JSON.stringify(createReviewerOutput())]);

		const result = await createPawBuildCommandResult(
			projectRoot,
			"session-1",
			{ once: true },
			{ config, executor, lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);

		expect(result.status).toBe("completed");
		if (result.status !== "completed" || !("selectedSliceId" in result)) return;
		expect(result.selectedSliceId).toBe("slice-1");
		expect(result.previousStateName).toBe("REVIEWING");
		expect(result.nextStateName).toBe("VERIFYING");
		expect(result.attempts).toBe(1);
		expect(result.lockReleased).toBe(true);
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toMatchObject({ name: "VERIFYING" });
		expect(formatPawBuildCommandResult(result)).toContain("REVIEWING -> VERIFYING");
		expect(await getPawSessionLockStatus(projectRoot, "session-1", { nowMs: 2_500 })).toEqual({
			status: "unlocked",
		});
	});

	test("runs one blocked reviewer result into BLOCKED state", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const config = loadDefaultPawRuntimeConfig(projectRoot);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createReviewingState("session-1", "slice-1"));
		const executor = createExecutor([JSON.stringify(createBlockedReviewerOutput())]);

		const result = await createPawBuildCommandResult(
			projectRoot,
			"session-1",
			{ once: true },
			{ config, executor, lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);

		expect(result.status).toBe("blocked");
		if (result.status !== "blocked") return;
		expect(result.previousStateName).toBe("REVIEWING");
		expect(result.nextStateName).toBe("BLOCKED_TEST_FAILURE");
		expect(result.blockedReasonCode).toBe("TEST_FAILURE");
		expect(result.attempts).toBe(1);
		expect(result.lockReleased).toBe(true);
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toMatchObject({
			name: "BLOCKED_TEST_FAILURE",
			current_slice_id: "slice-1",
		});
	});

	test("retries invalid reviewer JSON once before accepting the second output", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const config = loadDefaultPawRuntimeConfig(projectRoot);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createReviewingState("session-1", "slice-1"));
		const executor = createExecutor(["{not-json", JSON.stringify(createReviewerOutput())]);

		const result = await createPawBuildCommandResult(
			projectRoot,
			"session-1",
			{ once: true },
			{ config, executor, lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);

		expect(result.status).toBe("completed");
		if (result.status !== "completed" || !("attempts" in result)) return;
		expect(result.previousStateName).toBe("REVIEWING");
		expect(result.nextStateName).toBe("VERIFYING");
		expect(result.attempts).toBe(2);
	});

	test("blocks reviewer with CONTEXT_MISSING after two invalid JSON attempts", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const config = loadDefaultPawRuntimeConfig(projectRoot);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createReviewingState("session-1", "slice-1"));
		const executor = createExecutor(["{not-json", "{still-not-json"]);

		const result = await createPawBuildCommandResult(
			projectRoot,
			"session-1",
			{ once: true },
			{ config, executor, lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);

		expect(result.status).toBe("blocked");
		if (result.status !== "blocked") return;
		expect(result.previousStateName).toBe("REVIEWING");
		expect(result.nextStateName).toBe("BLOCKED_CONTEXT_MISSING");
		expect(result.blockedReasonCode).toBe("CONTEXT_MISSING");
		expect(result.attempts).toBe(2);
	});

	test("retries invalid worker JSON once before accepting the second output", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const config = loadDefaultPawRuntimeConfig(projectRoot);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createImplementingState("session-1", "slice-1"));
		const executor = createExecutor(["{not-json", JSON.stringify(createWorkerOutput())]);

		const result = await createPawBuildCommandResult(
			projectRoot,
			"session-1",
			{ once: true },
			{ config, executor, lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);

		expect(result.status).toBe("completed");
		if (result.status !== "completed" || !("attempts" in result)) return;
		expect(result.attempts).toBe(2);
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toMatchObject({ name: "REVIEWING" });
	});

	test("blocks with CONTEXT_MISSING after two invalid worker JSON attempts", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const config = loadDefaultPawRuntimeConfig(projectRoot);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createImplementingState("session-1", "slice-1"));
		const executor = createExecutor(["{not-json", "{still-not-json"]);

		const result = await createPawBuildCommandResult(
			projectRoot,
			"session-1",
			{ once: true },
			{ config, executor, lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);

		expect(result.status).toBe("blocked");
		if (result.status !== "blocked") return;
		expect(result.nextStateName).toBe("BLOCKED_CONTEXT_MISSING");
		expect(result.blockedReasonCode).toBe("CONTEXT_MISSING");
		expect(result.attempts).toBe(2);
		expect(result.lockReleased).toBe(true);
	});

	test("runs one verifier pass from VERIFYING to SLICE_DONE without native execution", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createVerifyingState("session-1", "slice-1"));

		const result = await createPawBuildCommandResult(projectRoot, "session-1", {
			once: true,
		});

		expect(result.status).toBe("completed_with_unverified");
		if (result.status !== "completed_with_unverified" || !("verifyDecisions" in result)) return;
		expect(result.currentSliceId).toBe("slice-1");
		expect(result.previousStateName).toBe("VERIFYING");
		expect(result.nextStateName).toBe("SLICE_DONE");
		expect(result.nativeVerificationRunResults).toEqual([]);
		expect(result.unverifiedDecisions.length).toBeGreaterThan(0);
		expect(result.lockReleased).toBe(true);
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toMatchObject({ name: "SLICE_DONE" });
		await expect(readPawVerificationEvidence(projectRoot, "session-1")).resolves.toEqual([]);
		expect(formatPawBuildCommandResult(result)).toContain("VERIFYING -> SLICE_DONE");
		expect(formatPawBuildCommandResult(result)).toContain("native executed gates: none");
		expect(await getPawSessionLockStatus(projectRoot, "session-1", { nowMs: 2_500 })).toEqual({
			status: "unlocked",
		});
	});

	test("reports missing project, missing session, invalid state, and missing selected slice", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const config = loadDefaultPawRuntimeConfig(projectRoot);
		const executor = createExecutor([JSON.stringify(createWorkerOutput())]);

		const missingProject = await createPawBuildCommandResult(
			projectRoot,
			"session-1",
			{ once: true },
			{ config, executor },
		);
		expect(missingProject).toEqual({ status: "missing_project", pawDir: ".paw" });
		expect(existsSync(join(projectRoot, ".paw"))).toBe(false);

		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		const missingSession = await createPawBuildCommandResult(
			projectRoot,
			"missing",
			{ once: true },
			{ config, executor },
		);
		expect(missingSession).toEqual({
			status: "missing_session",
			sessionId: "missing",
			stateFile: ".paw/sessions/missing/state.json",
		});

		const wrongState: PawSessionState = { ...createImplementingState("wrong", "slice-1"), name: "IDLE" };
		const noSliceState: PawSessionState = {
			...createImplementingState("no-slice", "slice-1"),
			current_slice_id: null,
		};
		await writePawSessionState(projectRoot, wrongState);
		await writePawSessionState(projectRoot, noSliceState);

		const wrong = await createPawBuildCommandResult(
			projectRoot,
			"wrong",
			{ once: true },
			{ config, executor, lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);
		const noSlice = await createPawBuildCommandResult(
			projectRoot,
			"no-slice",
			{ once: true },
			{ config, executor, lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);

		expect(wrong.status).toBe("invalid_state");
		if (wrong.status !== "invalid_state") return;
		expect(wrong.lockReleased).toBe(true);
		expect(noSlice.status).toBe("no_selected_slice");
		if (noSlice.status !== "no_selected_slice") return;
		expect(noSlice.lockReleased).toBe(true);
		await expect(readPawSessionState(projectRoot, "wrong")).resolves.toEqual(wrongState);
		await expect(readPawSessionState(projectRoot, "no-slice")).resolves.toEqual(noSliceState);
	});

	test("reports live foreign locks without releasing them", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const config = loadDefaultPawRuntimeConfig(projectRoot);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createImplementingState("locked-session", "slice-1"));
		const liveForeignLock: PawSessionLock = { pid: process.pid, host: "other-host", heartbeat_ts: 2_000, ttl: 120 };
		await writeLock(projectRoot, "locked-session", liveForeignLock);

		const result = await createPawBuildCommandResult(
			projectRoot,
			"locked-session",
			{ once: true },
			{
				config,
				executor: createExecutor([JSON.stringify(createWorkerOutput({ session_id: "locked-session" }))]),
				lockOptions: { nowMs: 3_000, ttlSec: 120, host: hostname() },
			},
		);

		expect(result).toEqual({ status: "locked", sessionId: "locked-session", lock: liveForeignLock });
		expect(await getPawSessionLockStatus(projectRoot, "locked-session", { nowMs: 3_000 })).toEqual({
			status: "locked",
			lock: liveForeignLock,
		});
	});

	test("runs one worker pass through a programmatic provider executor", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const config = loadDefaultPawRuntimeConfig(projectRoot);
		const completeCalls: { modelId: string; context: Context; options: SimpleStreamOptions | undefined }[] = [];
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createImplementingState("session-1", "slice-1"));

		const result = await createPawBuildCommandResult(
			projectRoot,
			"session-1",
			{ once: true, timestamp },
			{
				config,
				providerExecutor: {
					modelRegistry: createFakeModelRegistry(),
					defaultProvider: "fake-provider",
					defaultOptions: { maxTokens: 777 },
					completeSimple: async (model, context, options) => {
						completeCalls.push({ modelId: model.id, context, options });
						return createAssistantMessage(JSON.stringify(createWorkerOutput({ model_used: model.id })), {
							model: model.id,
						});
					},
				},
				lockOptions: { nowMs: 2_000, ttlSec: 120 },
			},
		);

		expect(result.status).toBe("completed");
		if (result.status !== "completed") return;
		expect(result.previousStateName).toBe("IMPLEMENTING");
		expect(result.nextStateName).toBe("REVIEWING");
		expect(completeCalls).toHaveLength(1);
		expect(completeCalls[0]?.modelId).toBe("<configured-mid-model>");
		expect(completeCalls[0]?.context.systemPrompt).toContain("Paw worker sub-agent");
		expect(completeCalls[0]?.context.messages[0]?.content).toContain("session_id: session-1");
		expect(completeCalls[0]?.options).toEqual({
			maxTokens: 777,
			apiKey: "fake-key",
			headers: { "x-fake": "1" },
		});
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toMatchObject({ name: "REVIEWING" });
	});

	test("runs one reviewer pass through a programmatic provider executor", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const config = loadDefaultPawRuntimeConfig(projectRoot);
		const completeCalls: { modelId: string; context: Context }[] = [];
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createReviewingState("session-1", "slice-1"));

		const result = await createPawBuildCommandResult(
			projectRoot,
			"session-1",
			{ once: true },
			{
				config,
				providerExecutor: {
					modelRegistry: createFakeModelRegistry(),
					defaultProvider: "fake-provider",
					completeSimple: async (model, context) => {
						completeCalls.push({ modelId: model.id, context });
						return createAssistantMessage(JSON.stringify(createReviewerOutput({ model_used: model.id })), {
							model: model.id,
						});
					},
				},
				lockOptions: { nowMs: 2_000, ttlSec: 120 },
			},
		);

		expect(result.status).toBe("completed");
		if (result.status !== "completed") return;
		expect(result.previousStateName).toBe("REVIEWING");
		expect(result.nextStateName).toBe("VERIFYING");
		expect(completeCalls).toHaveLength(1);
		expect(completeCalls[0]?.modelId).toBe("<configured-strong-model>");
		expect(completeCalls[0]?.context.systemPrompt).toContain("Paw reviewer sub-agent");
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toMatchObject({ name: "VERIFYING" });
	});

	test("blocks provider executor resolver failures as provider unavailable", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const config = loadDefaultPawRuntimeConfig(projectRoot);
		let completions = 0;
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createImplementingState("session-1", "slice-1"));

		const result = await createPawBuildCommandResult(
			projectRoot,
			"session-1",
			{ once: true },
			{
				config,
				providerExecutor: {
					modelRegistry: { ...createFakeModelRegistry(), hasConfiguredAuth: () => false },
					defaultProvider: "fake-provider",
					completeSimple: async () => {
						completions += 1;
						return createAssistantMessage("should not be called");
					},
				},
				lockOptions: { nowMs: 2_000, ttlSec: 120 },
			},
		);

		expect(completions).toBe(0);
		expect(result.status).toBe("blocked");
		if (result.status !== "blocked") return;
		expect(result.nextStateName).toBe("BLOCKED_PROVIDER_UNAVAILABLE");
		expect(result.blockedReasonCode).toBe("PROVIDER_UNAVAILABLE");
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toMatchObject({
			name: "BLOCKED_PROVIDER_UNAVAILABLE",
		});
	});

	test("rejects ambiguous build executor configuration before mutating state", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const config = loadDefaultPawRuntimeConfig(projectRoot);
		const initialState = createImplementingState("session-1", "slice-1");
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, initialState);

		await expect(
			createPawBuildCommandResult(
				projectRoot,
				"session-1",
				{ once: true },
				{
					config,
					executor: createExecutor([JSON.stringify(createWorkerOutput())]),
					providerExecutor: { modelRegistry: createFakeModelRegistry(), defaultProvider: "fake-provider" },
					lockOptions: { nowMs: 2_000, ttlSec: 120 },
				},
			),
		).rejects.toThrow("Paw build accepts either executor or providerExecutor, not both.");
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toEqual(initialState);
		expect(await getPawSessionLockStatus(projectRoot, "session-1", { nowMs: 2_500 })).toEqual({ status: "unlocked" });
	});

	test("default build executor blocks as provider unavailable for worker and reviewer", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createImplementingState("worker-session", "slice-1"));
		await writePawSessionState(projectRoot, createReviewingState("reviewer-session", "slice-1"));

		const workerResult = await createPawBuildCommandResult(projectRoot, "worker-session", { once: true });
		const reviewerResult = await createPawBuildCommandResult(projectRoot, "reviewer-session", { once: true });

		expect(workerResult.status).toBe("blocked");
		if (workerResult.status !== "blocked") return;
		expect(workerResult.nextStateName).toBe("BLOCKED_PROVIDER_UNAVAILABLE");
		expect(workerResult.blockedReasonCode).toBe("PROVIDER_UNAVAILABLE");
		expect(reviewerResult.status).toBe("blocked");
		if (reviewerResult.status !== "blocked") return;
		expect(reviewerResult.nextStateName).toBe("BLOCKED_PROVIDER_UNAVAILABLE");
		expect(reviewerResult.blockedReasonCode).toBe("PROVIDER_UNAVAILABLE");
	});

	test("routes paw build and validates command arguments", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createImplementingState("session-1", "slice-1"));

		await expect(handlePawCommand(["paw", "build", "session-1", "--once"])).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "build"])).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "build", "--help"])).resolves.toBe(true);

		const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
		const stderr = errorSpy.mock.calls.map(([message]) => String(message)).join("\n");
		expect(stdout).toContain("Paw build");
		expect(stdout).toContain("BLOCKED_PROVIDER_UNAVAILABLE");
		expect(stdout).toContain("pi paw build");
		expect(stderr).toContain('Missing required session id for "paw build".');
		expect(process.exitCode).toBe(1);
	});

	test("main routes paw build before normal agent runtime", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
			throw new Error(`process.exit(${code ?? ""})`);
		}) as typeof process.exit);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createImplementingState("session-1", "slice-1"));

		await expect(main(["paw", "build", "session-1", "--once"])).resolves.toBeUndefined();

		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toMatchObject({
			name: "BLOCKED_PROVIDER_UNAVAILABLE",
			current_slice_id: "slice-1",
		});
		expect(process.exitCode).toBeUndefined();
	});

	test("runPawBuildCommand surfaces parser errors via exit code", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "error").mockImplementation(() => {});

		await runPawBuildCommand([]);

		expect(process.exitCode).toBe(1);
	});
});
