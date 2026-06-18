
import { createHash } from "node:crypto";
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
	readPawCheckpointMetadata,
	resolvePawSessionPaths,
	writePawJsonAtomic,
	writePawSessionState,
} from "../src/paw/index.ts";
import { handlePawCommand } from "../src/paw/init-command.ts";
import {
	createPawPrepareCheckpointCommandResult,
	formatPawPrepareCheckpointCommandResult,
	parsePawPrepareCheckpointArgs,
	runPawPrepareCheckpointCommand,
} from "../src/paw/slice-checkpoint-command.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");
const sourceConfigPath = join(repoRoot, "paw-spec", "config.yaml");
const tempRoots: string[] = [];
const timestamp = "2026-06-16T03:04:05.678Z";

let originalCwd: string;
let originalExitCode: typeof process.exitCode;

async function createTempProject(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-slice-checkpoint-command-"));
	tempRoots.push(root);
	await mkdir(join(root, "paw-spec"), { recursive: true });
	await writeFile(join(root, "paw-spec", "config.yaml"), await readFile(sourceConfigPath, "utf-8"), "utf-8");
	return root;
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

function baseCliArgs(sessionId: string): string[] {
	return [
		sessionId,
		"--base-tree",
		"tree:abc123",
		"--short-id",
		"abc123",
		"--timestamp",
		timestamp,
		"--changed-file",
		"src/example.ts=sha256:abc123",
		"--changed-file",
		"src/deleted.ts=null",
	];
}

function hashContent(content: string | Uint8Array): string {
	return `sha256:${createHash("sha256").update(content).digest("hex")}`;
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

describe("parsePawPrepareCheckpointArgs", () => {
	test("parses required options and repeated changed files in order", () => {
		const parsed = parsePawPrepareCheckpointArgs([
			"session-1",
			"--base-tree",
			"tree:abc",
			"--short-id",
			"id1",
			"--timestamp",
			timestamp,
			"--changed-file",
			"a.ts=hash-a",
			"--changed-file",
			"b.ts=null",
			"--notes",
			"note",
		]);
		expect(parsed).toEqual({
			kind: "ok",
			sessionId: "session-1",
			input: {
				baseTree: "tree:abc",
				shortId: "id1",
				timestamp,
				changedFiles: [
					{ path: "a.ts", content_hash: "hash-a" },
					{ path: "b.ts", content_hash: null },
				],
				notes: "note",
			},
		});
	});

	test("reports parser and help errors without throwing", () => {
		expect(parsePawPrepareCheckpointArgs(["--help"])).toEqual({ kind: "help" });
		expect(parsePawPrepareCheckpointArgs([])).toEqual({
			kind: "error",
			message: 'Missing required session id for "paw prepare-checkpoint".',
		});
		expect(parsePawPrepareCheckpointArgs(["--base-tree", "x"])).toEqual({
			kind: "error",
			message: 'Missing required session id for "paw prepare-checkpoint".',
		});
		expect(parsePawPrepareCheckpointArgs(["session-1", "extra"])).toEqual({
			kind: "error",
			message: 'Unknown option for "paw prepare-checkpoint": extra',
		});
		expect(parsePawPrepareCheckpointArgs(["session-1", "--bogus", "x"])).toEqual({
			kind: "error",
			message: 'Unknown option for "paw prepare-checkpoint": --bogus',
		});
		expect(parsePawPrepareCheckpointArgs(["session-1", "--base-tree"])).toEqual({
			kind: "error",
			message: 'Missing value for "paw prepare-checkpoint" option: --base-tree',
		});
		expect(
			parsePawPrepareCheckpointArgs(["session-1", "--base-tree", " ", "--short-id", "a", "--timestamp", timestamp]),
		).toEqual({
			kind: "error",
			message: 'Option --base-tree for "paw prepare-checkpoint" must be a non-empty string.',
		});
		expect(
			parsePawPrepareCheckpointArgs([
				"session-1",
				"--base-tree",
				"t",
				"--short-id",
				"a",
				"--timestamp",
				"not-a-date",
			]),
		).toEqual({
			kind: "error",
			message: 'Invalid timestamp for "paw prepare-checkpoint": not-a-date',
		});
		expect(
			parsePawPrepareCheckpointArgs(["session-1", "--base-tree", "t", "--short-id", "a", "--timestamp", timestamp]),
		).toEqual({
			kind: "error",
			message: 'Missing required option for "paw prepare-checkpoint": --changed-file',
		});
		expect(parsePawPrepareCheckpointArgs(["session-1", "--base-tree", "t", "--timestamp", timestamp])).toEqual({
			kind: "error",
			message: 'Missing required option for "paw prepare-checkpoint": --short-id',
		});
	});

	test("validates changed-file and duplicate scalar options", () => {
		const missingEq = parsePawPrepareCheckpointArgs([
			"session-1",
			"--base-tree",
			"t",
			"--short-id",
			"a",
			"--timestamp",
			timestamp,
			"--changed-file",
			"badpath",
		]);
		expect(missingEq).toEqual({
			kind: "error",
			message: 'Option --changed-file for "paw prepare-checkpoint" must use <path>=<hash|null>.',
		});

		const nullHash = parsePawPrepareCheckpointArgs([
			"session-1",
			"--base-tree",
			"t",
			"--short-id",
			"a",
			"--timestamp",
			timestamp,
			"--changed-file",
			"path.ts=null",
		]);
		expect(nullHash.kind).toBe("ok");
		if (nullHash.kind === "ok") {
			expect(nullHash.input.changedFiles[0].content_hash).toBeNull();
		}

		const duplicate = parsePawPrepareCheckpointArgs([
			"session-1",
			"--base-tree",
			"t1",
			"--base-tree",
			"t2",
			"--short-id",
			"a",
			"--timestamp",
			timestamp,
		]);
		expect(duplicate).toEqual({
			kind: "error",
			message: 'Duplicate option for "paw prepare-checkpoint": --base-tree',
		});
	});
});

describe("Paw prepare-checkpoint command", () => {
	test("prepares checkpoint from SLICE_SELECT and releases acquired lock", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		await writePawSessionState(projectRoot, createSliceSelectState("session-1", "slice-1"));

		const result = await createPawPrepareCheckpointCommandResult(
			projectRoot,
			"session-1",
			{
				baseTree: "tree:abc123",
				shortId: "abc123",
				timestamp,
				changedFiles: [
					{ path: "src/example.ts", content_hash: "sha256:abc123" },
					{ path: "src/deleted.ts", content_hash: null },
				],
				notes: "before worker",
			},
			{ lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);

		expect(result.status).toBe("prepared");
		if (result.status !== "prepared") return;
		expect(result.selectedSliceId).toBe("slice-1");
		expect(result.changedFileCount).toBe(2);
		expect(result.lockReleased).toBe(true);
		expect(result.metadataPath).toContain("checkpoint.json");
		expect(formatPawPrepareCheckpointCommandResult(result)).toContain("lock released: yes");
		await expect(readPawCheckpointMetadata(projectRoot, "session-1", result.checkpointName)).resolves.toMatchObject({
			slice_id: "slice-1",
			changed_files: [
				{ path: "src/example.ts", content_hash: "sha256:abc123" },
				{ path: "src/deleted.ts", content_hash: null },
			],
		});
		expect(await getPawSessionLockStatus(projectRoot, "session-1", { nowMs: 2_500 })).toEqual({
			status: "unlocked",
		});
	});

	test("fails closed for a non-UTF-8 changed file instead of writing inconsistent restore metadata", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		await mkdir(join(projectRoot, "src"), { recursive: true });
		const binaryContent = Uint8Array.from([0xff, 0xfe, 0x00, 0x61]);
		await writeFile(join(projectRoot, "src", "binary.bin"), binaryContent);
		await writePawSessionState(projectRoot, createSliceSelectState("session-1", "slice-1"));

		await expect(
			createPawPrepareCheckpointCommandResult(
				projectRoot,
				"session-1",
				{
					baseTree: "tree:abc123",
					shortId: "abc123",
					timestamp,
					changedFiles: [{ path: "src/binary.bin", content_hash: hashContent(binaryContent) }],
				},
				{ lockOptions: { nowMs: 2_000, ttlSec: 120 } },
			),
		).rejects.toThrow("file content is not valid UTF-8 and cannot be represented safely in restore metadata");
		await expect(
			readPawCheckpointMetadata(projectRoot, "session-1", "20260616T030405Z-slice-1-abc123"),
		).rejects.toThrow("ENOENT");
	});

	test("reports missing project or missing session without creating state", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);

		const missingProject = await createPawPrepareCheckpointCommandResult(
			projectRoot,
			"missing",
			{
				baseTree: "tree:x",
				shortId: "x",
				timestamp,
				changedFiles: [],
			},
			{ lockOptions: { nowMs: 1_000 } },
		);
		expect(missingProject).toEqual({ status: "missing_project", pawDir: ".paw" });
		expect(existsSync(join(projectRoot, ".paw"))).toBe(false);

		vi.spyOn(console, "log").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		const missingSession = await createPawPrepareCheckpointCommandResult(
			projectRoot,
			"missing",
			{
				baseTree: "tree:x",
				shortId: "x",
				timestamp,
				changedFiles: [],
			},
			{ lockOptions: { nowMs: 1_000 } },
		);
		expect(missingSession).toEqual({
			status: "missing_session",
			sessionId: "missing",
			stateFile: ".paw/sessions/missing/state.json",
		});
	});

	test("reports live foreign locks without releasing them", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		await writePawSessionState(projectRoot, createSliceSelectState("locked-session", "slice-1"));
		const liveForeignLock: PawSessionLock = { pid: process.pid, host: "other-host", heartbeat_ts: 2_000, ttl: 120 };
		await writeLock(projectRoot, "locked-session", liveForeignLock);

		const locked = await createPawPrepareCheckpointCommandResult(
			projectRoot,
			"locked-session",
			{
				baseTree: "tree:abc123",
				shortId: "abc123",
				timestamp,
				changedFiles: [],
			},
			{ lockOptions: { nowMs: 3_000, ttlSec: 120, host: hostname() } },
		);

		expect(locked).toEqual({ status: "locked", sessionId: "locked-session", lock: liveForeignLock });
		expect(await getPawSessionLockStatus(projectRoot, "locked-session", { nowMs: 3_000 })).toEqual({
			status: "locked",
			lock: liveForeignLock,
		});
	});

	test("invalid source state and no selected slice release acquired lock without metadata", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const wrongState: PawSessionState = {
			...createSliceSelectState("wrong-state", "slice-1"),
			name: "IMPLEMENTING",
		};
		const noSlice: PawSessionState = {
			...createSliceSelectState("no-slice", "slice-1"),
			current_slice_id: null,
		};
		await writePawSessionState(projectRoot, wrongState);
		await writePawSessionState(projectRoot, noSlice);

		const invalid = await createPawPrepareCheckpointCommandResult(
			projectRoot,
			"wrong-state",
			{ baseTree: "tree:x", shortId: "x", timestamp, changedFiles: [] },
			{ lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);
		const noSelected = await createPawPrepareCheckpointCommandResult(
			projectRoot,
			"no-slice",
			{ baseTree: "tree:x", shortId: "x", timestamp, changedFiles: [] },
			{ lockOptions: { nowMs: 2_000, ttlSec: 120 } },
		);

		expect(invalid.status).toBe("invalid_state");
		if (invalid.status === "invalid_state") {
			expect(invalid.lockReleased).toBe(true);
		}
		expect(noSelected.status).toBe("no_selected_slice");
		if (noSelected.status === "no_selected_slice") {
			expect(noSelected.lockReleased).toBe(true);
		}
	});

	test("routes paw prepare-checkpoint and validates command arguments", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createSliceSelectState("session-1", "slice-1"));

		await expect(handlePawCommand(["paw", "prepare-checkpoint", ...baseCliArgs("session-1")])).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "prepare-checkpoint"])).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "prepare-checkpoint", "--help"])).resolves.toBe(true);

		const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
		const stderr = errorSpy.mock.calls.map(([message]) => String(message)).join("\n");
		expect(stdout).toContain("Paw prepare-checkpoint");
		expect(stdout).toContain("pi paw prepare-checkpoint");
		expect(stderr).toContain('Missing required session id for "paw prepare-checkpoint".');
		expect(process.exitCode).toBe(1);
	});

	test("main routes paw prepare-checkpoint before normal agent runtime", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
			throw new Error(`process.exit(${code ?? ""})`);
		}) as typeof process.exit);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createSliceSelectState("session-1", "slice-1"));

		await expect(main(["paw", "prepare-checkpoint", ...baseCliArgs("session-1")])).resolves.toBeUndefined();
		expect(process.exitCode).toBeUndefined();
	});

	test("runPawPrepareCheckpointCommand surfaces parser errors via exit code", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "error").mockImplementation(() => {});

		await runPawPrepareCheckpointCommand([]);

		expect(process.exitCode).toBe(1);
	});
});
