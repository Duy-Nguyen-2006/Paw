import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { main } from "../src/main.ts";
import {
	getPawSessionLockStatus,
	type PawCheckpointMetadata,
	type PawSessionState,
	readPawSessionState,
	resolvePawSessionPaths,
	writePawCheckpointMetadata,
	writePawJsonAtomic,
	writePawSessionState,
} from "../src/paw/index.ts";
import { handlePawCommand } from "../src/paw/init-command.ts";
import {
	createPawRollbackCommandResult,
	formatPawRollbackCommandResult,
	parsePawRollbackArgs,
	runPawRollbackCommand,
} from "../src/paw/rollback-command.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");
const sourceConfigPath = join(repoRoot, "paw-spec", "config.yaml");
const tempRoots: string[] = [];

let originalCwd: string;
let originalExitCode: typeof process.exitCode;

async function createTempProject(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-rollback-command-"));
	tempRoots.push(root);
	await mkdir(join(root, "paw-spec"), { recursive: true });
	await writeFile(join(root, "paw-spec", "config.yaml"), await readFile(sourceConfigPath, "utf-8"), "utf-8");
	return root;
}

function createSessionState(sessionId: string): PawSessionState {
	return {
		session_id: sessionId,
		name: "SLICE_SELECT",
		current_slice_id: "slice-1",
		pending_slice_ids: ["slice-2"],
		completed_slice_ids: [],
		blocked_reason: null,
	};
}

function createCheckpointMetadata(overrides: Partial<PawCheckpointMetadata> = {}): PawCheckpointMetadata {
	return {
		session_id: "session-1",
		checkpoint_name: "20260617T010203Z-slice-1-abc123",
		scope: "slice",
		slice_id: "slice-1",
		created_at: "2026-06-17T01:02:03.000Z",
		base_tree: "tree:abc123",
		changed_files: [
			{ path: "src/changed.ts", content_hash: "sha256:changed" },
			{ path: "src/deleted.ts", content_hash: null },
		],
		...overrides,
	};
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

describe("parsePawRollbackArgs", () => {
	test("parses dry-run arguments and reports validation errors", () => {
		expect(parsePawRollbackArgs(["session-1", "--dry-run"])).toEqual({
			kind: "ok",
			sessionId: "session-1",
			input: { dryRun: true },
		});
		expect(parsePawRollbackArgs(["session-1", "--dry-run", "--checkpoint", "checkpoint-1"])).toEqual({
			kind: "ok",
			sessionId: "session-1",
			input: { dryRun: true, checkpointName: "checkpoint-1" },
		});
		expect(parsePawRollbackArgs(["--help"])).toEqual({ kind: "help" });
		expect(parsePawRollbackArgs([])).toEqual({
			kind: "error",
			message: 'Missing required session id for "paw rollback".',
		});
		expect(parsePawRollbackArgs(["--dry-run"])).toEqual({
			kind: "error",
			message: 'Missing required session id for "paw rollback".',
		});
		expect(parsePawRollbackArgs(["session-1"])).toEqual({
			kind: "error",
			message: "Only dry-run rollback inspection is implemented. Pass --dry-run.",
		});
		expect(parsePawRollbackArgs(["session-1", "--dry-run", "--dry-run"])).toEqual({
			kind: "error",
			message: 'Duplicate option for "paw rollback": --dry-run',
		});
		expect(parsePawRollbackArgs(["session-1", "--dry-run", "--checkpoint"])).toEqual({
			kind: "error",
			message: 'Missing value for "paw rollback" option: --checkpoint',
		});
		expect(parsePawRollbackArgs(["session-1", "--dry-run", "--checkpoint", " "])).toEqual({
			kind: "error",
			message: 'Option --checkpoint for "paw rollback" must be a non-empty string.',
		});
		expect(parsePawRollbackArgs(["session-1", "--dry-run", "extra"])).toEqual({
			kind: "error",
			message: 'Unknown option for "paw rollback": extra',
		});
		expect(parsePawRollbackArgs(["session-1", "--bogus"])).toEqual({
			kind: "error",
			message: 'Unknown option for "paw rollback": --bogus',
		});
	});
});

describe("Paw rollback command", () => {
	test("inspects an explicit checkpoint without changing files or locks", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		const initialState = createSessionState("session-1");
		await writePawSessionState(projectRoot, initialState);
		await writePawCheckpointMetadata(projectRoot, createCheckpointMetadata());

		const result = await createPawRollbackCommandResult(projectRoot, "session-1", {
			dryRun: true,
			checkpointName: "20260617T010203Z-slice-1-abc123",
		});

		expect(result.status).toBe("dry_run");
		if (result.status !== "dry_run") return;
		expect(result.filesChanged).toBe(false);
		expect(result.rollbackExecuted).toBe(false);
		expect(result.gitTouched).toBe(false);
		expect(result.metadata.changed_files).toEqual([
			{ path: "src/changed.ts", content_hash: "sha256:changed" },
			{ path: "src/deleted.ts", content_hash: null },
		]);
		expect(formatPawRollbackCommandResult(result)).toContain("No files were changed.");
		expect(formatPawRollbackCommandResult(result)).toContain("Git state was not touched.");
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toEqual(initialState);
		expect(await getPawSessionLockStatus(projectRoot, "session-1", { nowMs: 2_000 })).toEqual({ status: "unlocked" });
		expect(existsSync(resolvePawSessionPaths(projectRoot, "session-1").lockFile)).toBe(false);
	});

	test("selects the latest checkpoint by name when checkpoint is omitted", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createSessionState("session-1"));
		await writePawCheckpointMetadata(
			projectRoot,
			createCheckpointMetadata({ checkpoint_name: "20260617T010203Z-slice-1-old111" }),
		);
		await writePawCheckpointMetadata(
			projectRoot,
			createCheckpointMetadata({ checkpoint_name: "20260617T020203Z-slice-1-new222" }),
		);

		const result = await createPawRollbackCommandResult(projectRoot, "session-1", { dryRun: true });

		expect(result.status).toBe("dry_run");
		if (result.status !== "dry_run") return;
		expect(result.checkpointName).toBe("20260617T020203Z-slice-1-new222");
	});

	test("reports missing project, missing session, no checkpoints, and missing checkpoint without mutation", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);

		const missingProject = await createPawRollbackCommandResult(projectRoot, "session-1", { dryRun: true });
		expect(missingProject).toEqual({ status: "missing_project", pawDir: ".paw" });
		expect(existsSync(join(projectRoot, ".paw"))).toBe(false);

		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		const missingSession = await createPawRollbackCommandResult(projectRoot, "missing", { dryRun: true });
		expect(missingSession).toEqual({
			status: "missing_session",
			sessionId: "missing",
			stateFile: ".paw/sessions/missing/state.json",
		});

		await writePawSessionState(projectRoot, createSessionState("session-1"));
		const noCheckpoints = await createPawRollbackCommandResult(projectRoot, "session-1", { dryRun: true });
		expect(noCheckpoints).toEqual({
			status: "no_checkpoints",
			sessionId: "session-1",
			checkpointDir: ".paw/checkpoints/session-1",
		});

		const missingCheckpoint = await createPawRollbackCommandResult(projectRoot, "session-1", {
			dryRun: true,
			checkpointName: "missing-checkpoint",
		});
		expect(missingCheckpoint).toEqual({
			status: "missing_checkpoint",
			sessionId: "session-1",
			checkpointName: "missing-checkpoint",
			metadataFile: ".paw/checkpoints/session-1/missing-checkpoint/checkpoint.json",
		});
	});

	test("reports invalid checkpoint metadata as structured validation issues", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createSessionState("session-1"));
		await writePawJsonAtomic(
			join(projectRoot, ".paw", "checkpoints", "session-1", "bad-checkpoint", "checkpoint.json"),
			{
				session_id: "session-1",
				checkpoint_name: "bad-checkpoint",
				scope: "slice",
				slice_id: null,
				created_at: "not-a-date",
				base_tree: "",
				changed_files: [],
			},
		);

		const result = await createPawRollbackCommandResult(projectRoot, "session-1", {
			dryRun: true,
			checkpointName: "bad-checkpoint",
		});

		expect(result.status).toBe("invalid_checkpoint");
		if (result.status !== "invalid_checkpoint") return;
		expect(result.issues).toEqual(
			expect.arrayContaining([
				{ path: "/slice_id", message: "Expected non-empty string for slice checkpoint scope." },
				{ path: "/created_at", message: "Expected valid date string." },
				{ path: "/base_tree", message: "Expected non-empty string." },
			]),
		);
		expect(formatPawRollbackCommandResult(result)).toContain("Cannot dry-run rollback");
	});

	test("routes paw rollback and validates command arguments", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createSessionState("session-1"));
		await writePawCheckpointMetadata(projectRoot, createCheckpointMetadata());

		await expect(handlePawCommand(["paw", "rollback", "session-1", "--dry-run"])).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "rollback", "session-1"])).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "rollback", "--help"])).resolves.toBe(true);

		const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
		const stderr = errorSpy.mock.calls.map(([message]) => String(message)).join("\n");
		expect(stdout).toContain("Paw rollback dry-run");
		expect(stdout).toContain("No files were changed.");
		expect(stdout).toContain("pi paw rollback");
		expect(stderr).toContain("Only dry-run rollback inspection is implemented");
		expect(process.exitCode).toBe(1);
	});

	test("main routes paw rollback before normal agent runtime", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
			throw new Error(`process.exit(${code ?? ""})`);
		}) as typeof process.exit);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createSessionState("session-1"));
		await writePawCheckpointMetadata(projectRoot, createCheckpointMetadata());

		await expect(main(["paw", "rollback", "session-1", "--dry-run"])).resolves.toBeUndefined();

		expect(process.exitCode).toBeUndefined();
	});

	test("runPawRollbackCommand surfaces parser errors via exit code", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "error").mockImplementation(() => {});

		await runPawRollbackCommand([]);

		expect(process.exitCode).toBe(1);
	});
});
