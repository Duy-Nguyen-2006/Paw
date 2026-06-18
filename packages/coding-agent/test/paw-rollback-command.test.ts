
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
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

function hashContent(content: string | Uint8Array): string {
	return `sha256:${createHash("sha256").update(content).digest("hex")}`;
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
		expect(parsePawRollbackArgs(["session-1"])).toEqual({
			kind: "ok",
			sessionId: "session-1",
			input: { dryRun: false },
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

	test("fails closed on non-dry-run rollback when checkpoint lacks restorable file content", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		const initialState = createSessionState("session-1");
		await writePawSessionState(projectRoot, initialState);
		await writePawCheckpointMetadata(projectRoot, createCheckpointMetadata());

		const result = await createPawRollbackCommandResult(projectRoot, "session-1", {
			dryRun: false,
			checkpointName: "20260617T010203Z-slice-1-abc123",
		});

		expect(result.status).toBe("blocked_missing_restore_metadata");
		if (result.status !== "blocked_missing_restore_metadata") return;
		expect(result.filesChanged).toBe(false);
		expect(result.rollbackExecuted).toBe(false);
		expect(result.gitTouched).toBe(false);
		expect(result.blockedReason).toContain("does not contain restorable Paw-owned file snapshots");
		expect(result.externalSideEffectsNotReverted).toEqual([
			"migrations",
			"installed dependencies",
			"generated artifacts outside Paw-owned file changes",
			"external service or provider side effects",
		]);
		const formatted = formatPawRollbackCommandResult(result);
		expect(formatted).toContain("Paw rollback blocked");
		expect(formatted).toContain("External side effects not reverted:");
		expect(formatted).toContain("No files were changed.");
		expect(formatted).toContain("No rollback was executed.");
		expect(formatted).toContain("Git state was not touched.");
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toEqual(initialState);
		expect(existsSync(join(projectRoot, "src", "changed.ts"))).toBe(false);
		expect(await getPawSessionLockStatus(projectRoot, "session-1", { nowMs: 2_000 })).toEqual({ status: "unlocked" });
		expect(existsSync(resolvePawSessionPaths(projectRoot, "session-1").lockFile)).toBe(false);
	});

	test("restores and deletes only declared Paw-owned files with matching safety hashes", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		const initialState = createSessionState("session-1");
		await writePawSessionState(projectRoot, initialState);
		await mkdir(join(projectRoot, "src"), { recursive: true });
		await writeFile(join(projectRoot, "src", "changed.ts"), "after\n", "utf-8");
		await writeFile(join(projectRoot, "src", "deleted.ts"), "created by paw\n", "utf-8");
		await writeFile(join(projectRoot, "src", "untouched.ts"), "user work\n", "utf-8");
		await writePawCheckpointMetadata(
			projectRoot,
			createCheckpointMetadata({
				restore_files: [
					{
						path: "src/changed.ts",
						paw_owned: true,
						restore_content: "before\n",
						current_content_hash: hashContent("after\n"),
					},
					{
						path: "src/deleted.ts",
						paw_owned: true,
						restore_content: null,
						current_content_hash: hashContent("created by paw\n"),
					},
				],
			}),
		);

		const result = await createPawRollbackCommandResult(projectRoot, "session-1", {
			dryRun: false,
			checkpointName: "20260617T010203Z-slice-1-abc123",
		});

		expect(result.status).toBe("restored");
		if (result.status !== "restored") return;
		expect(result.filesChanged).toBe(true);
		expect(result.rollbackExecuted).toBe(true);
		expect(result.gitTouched).toBe(false);
		expect(result.restoredFiles).toEqual([{ path: "src/changed.ts" }]);
		expect(result.deletedFiles).toEqual([{ path: "src/deleted.ts" }]);
		expect(await readFile(join(projectRoot, "src", "changed.ts"), "utf-8")).toBe("before\n");
		expect(existsSync(join(projectRoot, "src", "deleted.ts"))).toBe(false);
		expect(await readFile(join(projectRoot, "src", "untouched.ts"), "utf-8")).toBe("user work\n");
		expect(formatPawRollbackCommandResult(result)).toContain("Rollback executed for declared Paw-owned files only.");
		await expect(readPawSessionState(projectRoot, "session-1")).resolves.toEqual(initialState);
		expect(await getPawSessionLockStatus(projectRoot, "session-1", { nowMs: 2_000 })).toEqual({ status: "unlocked" });
	});

	test("deletes a declared binary file only when the raw-byte safety hash matches", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createSessionState("session-1"));
		await mkdir(join(projectRoot, "src"), { recursive: true });
		const binaryContent = Uint8Array.from([0xff, 0xfe, 0x00, 0x61]);
		await writeFile(join(projectRoot, "src", "binary.bin"), binaryContent);
		await writePawCheckpointMetadata(
			projectRoot,
			createCheckpointMetadata({
				changed_files: [{ path: "src/binary.bin", content_hash: hashContent(binaryContent) }],
				restore_files: [
					{
						path: "src/binary.bin",
						paw_owned: true,
						restore_content: null,
						current_content_hash: hashContent(binaryContent),
					},
				],
			}),
		);

		const result = await createPawRollbackCommandResult(projectRoot, "session-1", {
			dryRun: false,
			checkpointName: "20260617T010203Z-slice-1-abc123",
		});

		expect(result.status).toBe("restored");
		if (result.status !== "restored") return;
		expect(result.filesChanged).toBe(true);
		expect(result.deletedFiles).toEqual([{ path: "src/binary.bin" }]);
		expect(existsSync(join(projectRoot, "src", "binary.bin"))).toBe(false);
	});

	test("blocks restore through a symlinked ancestor before creating external files", async () => {
		const projectRoot = await createTempProject();
		const externalRoot = await mkdtemp(join(tmpdir(), "paw-rollback-external-"));
		tempRoots.push(externalRoot);
		process.chdir(projectRoot);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createSessionState("session-1"));
		await symlink(externalRoot, join(projectRoot, "link"), "dir");
		await writePawCheckpointMetadata(
			projectRoot,
			createCheckpointMetadata({
				restore_files: [
					{
						path: "link/victim.txt",
						paw_owned: true,
						restore_content: "restored outside\n",
						current_content_hash: null,
					},
				],
			}),
		);

		const result = await createPawRollbackCommandResult(projectRoot, "session-1", {
			dryRun: false,
			checkpointName: "20260617T010203Z-slice-1-abc123",
		});

		expect(result.status).toBe("blocked_unsafe_restore");
		if (result.status !== "blocked_unsafe_restore") return;
		expect(result.filesChanged).toBe(false);
		expect(result.rollbackExecuted).toBe(false);
		expect(result.blockedReason).toContain("has a symlinked ancestor");
		expect(existsSync(join(externalRoot, "victim.txt"))).toBe(false);
		expect(existsSync(join(projectRoot, "link"))).toBe(true);
	});

	test("blocks delete through a symlinked ancestor before removing external files", async () => {
		const projectRoot = await createTempProject();
		const externalRoot = await mkdtemp(join(tmpdir(), "paw-rollback-external-"));
		tempRoots.push(externalRoot);
		process.chdir(projectRoot);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createSessionState("session-1"));
		await writeFile(join(externalRoot, "victim.txt"), "outside\n", "utf-8");
		await symlink(externalRoot, join(projectRoot, "link"), "dir");
		await writePawCheckpointMetadata(
			projectRoot,
			createCheckpointMetadata({
				restore_files: [
					{
						path: "link/victim.txt",
						paw_owned: true,
						restore_content: null,
						current_content_hash: hashContent("outside\n"),
					},
				],
			}),
		);

		const result = await createPawRollbackCommandResult(projectRoot, "session-1", {
			dryRun: false,
			checkpointName: "20260617T010203Z-slice-1-abc123",
		});

		expect(result.status).toBe("blocked_unsafe_restore");
		if (result.status !== "blocked_unsafe_restore") return;
		expect(result.filesChanged).toBe(false);
		expect(result.rollbackExecuted).toBe(false);
		expect(result.blockedReason).toContain("has a symlinked ancestor");
		expect(await readFile(join(externalRoot, "victim.txt"), "utf-8")).toBe("outside\n");
		expect(existsSync(join(projectRoot, "link"))).toBe(true);
	});

	test("blocks restore when declared file content changed after checkpoint", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createSessionState("session-1"));
		await mkdir(join(projectRoot, "src"), { recursive: true });
		await writeFile(join(projectRoot, "src", "changed.ts"), "user changed\n", "utf-8");
		await writePawCheckpointMetadata(
			projectRoot,
			createCheckpointMetadata({
				restore_files: [
					{
						path: "src/changed.ts",
						paw_owned: true,
						restore_content: "before\n",
						current_content_hash: hashContent("after\n"),
					},
				],
			}),
		);

		const result = await createPawRollbackCommandResult(projectRoot, "session-1", {
			dryRun: false,
			checkpointName: "20260617T010203Z-slice-1-abc123",
		});

		expect(result.status).toBe("blocked_unsafe_restore");
		if (result.status !== "blocked_unsafe_restore") return;
		expect(result.filesChanged).toBe(false);
		expect(result.rollbackExecuted).toBe(false);
		expect(result.blockedReason).toContain("does not match checkpoint safety hash");
		expect(await readFile(join(projectRoot, "src", "changed.ts"), "utf-8")).toBe("user changed\n");
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

	test("rejects path traversal, secret, and out-of-repo restore paths before mutation", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await writePawSessionState(projectRoot, createSessionState("session-1"));
		await writePawJsonAtomic(
			join(projectRoot, ".paw", "checkpoints", "session-1", "unsafe-checkpoint", "checkpoint.json"),
			{
				session_id: "session-1",
				checkpoint_name: "unsafe-checkpoint",
				scope: "slice",
				slice_id: "slice-1",
				created_at: "2026-06-17T01:02:03.000Z",
				base_tree: "tree:abc123",
				changed_files: [{ path: "../outside.ts", content_hash: "sha256:x" }],
				restore_files: [
					{ path: "../outside.ts", paw_owned: true, restore_content: "x", current_content_hash: null },
					{ path: "/tmp/outside.ts", paw_owned: true, restore_content: "x", current_content_hash: null },
					{ path: ".env", paw_owned: true, restore_content: "SECRET=1", current_content_hash: null },
					{ path: "secrets/token.txt", paw_owned: true, restore_content: "token", current_content_hash: null },
				],
			},
		);

		const result = await createPawRollbackCommandResult(projectRoot, "session-1", {
			dryRun: false,
			checkpointName: "unsafe-checkpoint",
		});

		expect(result.status).toBe("invalid_checkpoint");
		if (result.status !== "invalid_checkpoint") return;
		expect(result.issues).toEqual(
			expect.arrayContaining([
				{ path: "/changed_files/0/path", message: "Path must not traverse outside the repository root." },
				{ path: "/restore_files/0/path", message: "Path must not traverse outside the repository root." },
				{ path: "/restore_files/1/path", message: "Path must be relative to the repository root." },
				{ path: "/restore_files/2/path", message: "Path must not target secret or credential files." },
				{ path: "/restore_files/3/path", message: "Path must not target secret or credential files." },
			]),
		);
		expect(existsSync(join(projectRoot, "outside.ts"))).toBe(false);
		expect(existsSync(join(projectRoot, ".env"))).toBe(false);
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
		expect(process.exitCode).toBeUndefined();

		await expect(handlePawCommand(["paw", "rollback", "session-1"])).resolves.toBe(true);
		expect(process.exitCode).toBe(1);

		process.exitCode = undefined;
		await expect(handlePawCommand(["paw", "rollback", "--help"])).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "rollback", "session-1", "--bogus"])).resolves.toBe(true);

		const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
		const stderr = errorSpy.mock.calls.map(([message]) => String(message)).join("\n");
		expect(stdout).toContain("Paw rollback dry-run");
		expect(stdout).toContain("Paw rollback blocked");
		expect(stdout).toContain("No files were changed.");
		expect(stdout).toContain("pi paw rollback");
		expect(stderr).toContain('Unknown option for "paw rollback": --bogus');
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
