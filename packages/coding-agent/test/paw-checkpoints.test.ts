import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
	createPawCheckpointName,
	type PawCheckpointMetadata,
	readPawCheckpointMetadata,
	resolvePawCheckpointPaths,
	validatePawCheckpointMetadata,
	writePawCheckpointMetadata,
} from "../src/paw/index.ts";

const tempRoots: string[] = [];

async function createTempRepo(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-checkpoints-"));
	tempRoots.push(root);
	return root;
}

function createMetadata(overrides: Partial<PawCheckpointMetadata> = {}): PawCheckpointMetadata {
	return {
		session_id: "session-1",
		checkpoint_name: "20260616T030405Z-slice-1-abc123",
		scope: "slice",
		slice_id: "slice-1",
		created_at: "2026-06-16T03:04:05.678Z",
		base_tree: "tree:abc123",
		changed_files: [
			{
				path: "src/example.ts",
				content_hash: "sha256:abc123",
			},
			{
				path: "src/deleted.ts",
				content_hash: null,
			},
		],
		...overrides,
	};
}

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Paw checkpoints", () => {
	test("creates deterministic checkpoint names with UTC timestamp, slice slug, and short id", () => {
		const name = createPawCheckpointName({
			timestamp: new Date("2026-06-16T03:04:05.678Z"),
			sliceId: "Slice 01",
			shortId: "ABC_123!",
		});

		expect(name).toBe("20260616T030405Z-slice-01-abc123");
	});

	test("sanitizes slice segment and falls back to task", () => {
		expect(
			createPawCheckpointName({
				timestamp: "2026-06-16T03:04:05.678Z",
				sliceId: "  Path ++ Persistence / Checkpoints!  ",
				shortId: "ID-99",
			}),
		).toBe("20260616T030405Z-path-persistence-checkpoints-id99");

		for (const sliceId of [null, "", " !@# "]) {
			expect(
				createPawCheckpointName({
					timestamp: "2026-06-16T03:04:05.678Z",
					sliceId,
					shortId: "abc123",
				}),
			).toBe("20260616T030405Z-task-abc123");
		}
	});

	test("rejects empty short ids after sanitization", () => {
		expect(() =>
			createPawCheckpointName({
				timestamp: "2026-06-16T03:04:05.678Z",
				sliceId: "slice-1",
				shortId: "!@#",
			}),
		).toThrow("Paw checkpoint short id must contain at least one alphanumeric character.");
	});

	test("resolves checkpoint metadata path under the repository root", async () => {
		const repoRoot = await createTempRepo();
		const paths = resolvePawCheckpointPaths(repoRoot, "session-1", "20260616T030405Z-task-abc123");

		expect(paths).toEqual({
			repoRoot: resolve(repoRoot),
			sessionId: "session-1",
			checkpointName: "20260616T030405Z-task-abc123",
			checkpointDir: join(resolve(repoRoot), ".paw", "checkpoints", "session-1", "20260616T030405Z-task-abc123"),
			metadataFile: join(
				resolve(repoRoot),
				".paw",
				"checkpoints",
				"session-1",
				"20260616T030405Z-task-abc123",
				"checkpoint.json",
			),
		});
	});

	test("writes and reads metadata while creating parent directories", async () => {
		const repoRoot = await createTempRepo();
		const metadata = createMetadata();

		const paths = await writePawCheckpointMetadata(repoRoot, metadata);

		await expect(readPawCheckpointMetadata(repoRoot, metadata.session_id, metadata.checkpoint_name)).resolves.toEqual(
			metadata,
		);
		expect(JSON.parse(await readFile(paths.metadataFile, "utf-8"))).toEqual(metadata);
		expect((await stat(paths.checkpointDir)).isDirectory()).toBe(true);
	});

	test("validation rejects traversal and slashes in checkpoint name or session id", async () => {
		const repoRoot = await createTempRepo();

		for (const sessionId of ["../session", "session/name", "session\\name"]) {
			expect(() => resolvePawCheckpointPaths(repoRoot, sessionId, "20260616T030405Z-task-abc123")).toThrow(
				"Paw session id must be non-empty",
			);
			expect(validatePawCheckpointMetadata(createMetadata({ session_id: sessionId })).ok).toBe(false);
		}

		for (const checkpointName of ["../checkpoint", "checkpoint/name", "checkpoint\\name"]) {
			expect(() => resolvePawCheckpointPaths(repoRoot, "session-1", checkpointName)).toThrow(
				"Paw checkpoint name must be non-empty",
			);
			expect(validatePawCheckpointMetadata(createMetadata({ checkpoint_name: checkpointName })).ok).toBe(false);
		}
	});

	test("validation rejects invalid metadata with path-level issues", () => {
		const validation = validatePawCheckpointMetadata({
			session_id: "session-1",
			checkpoint_name: "20260616T030405Z-task-abc123",
			scope: "slice",
			slice_id: null,
			created_at: "not-a-date",
			base_tree: "",
			changed_files: [
				{
					path: "",
					content_hash: 123,
				},
			],
			extra: true,
		});

		expect(validation).toEqual({
			ok: false,
			issues: expect.arrayContaining([
				{ path: "/", message: "Unexpected property extra." },
				{ path: "/slice_id", message: "Expected non-empty string for slice checkpoint scope." },
				{ path: "/created_at", message: "Expected valid date string." },
				{ path: "/base_tree", message: "Expected non-empty string." },
				{ path: "/changed_files/0/path", message: "Expected non-empty string." },
				{ path: "/changed_files/0/content_hash", message: "Expected string or null." },
			]),
		});

		const invalidScope = validatePawCheckpointMetadata({
			...createMetadata(),
			scope: "checkpoint",
		});
		expect(invalidScope).toEqual({
			ok: false,
			issues: expect.arrayContaining([{ path: "/scope", message: "Expected one of task_start, slice." }]),
		});
	});

	test("validation accepts Paw-owned restorable file snapshots and rejects unsafe restore metadata", () => {
		const valid = validatePawCheckpointMetadata(
			createMetadata({
				restore_files: [
					{
						path: "src/example.ts",
						paw_owned: true,
						restore_content: "before\n",
						current_content_hash: "sha256:after",
					},
					{
						path: "src/deleted.ts",
						paw_owned: true,
						restore_content: null,
						current_content_hash: null,
					},
				],
			}),
		);
		expect(valid.ok).toBe(true);

		const invalid = validatePawCheckpointMetadata({
			...createMetadata(),
			restore_files: [
				{ path: "src/not-owned.ts", paw_owned: false, restore_content: "x", current_content_hash: null },
				{ path: "../outside.ts", paw_owned: true, restore_content: "x", current_content_hash: null },
				{ path: "/tmp/outside.ts", paw_owned: true, restore_content: "x", current_content_hash: null },
				{ path: ".env", paw_owned: true, restore_content: "SECRET=1", current_content_hash: null },
			],
		});

		expect(invalid).toEqual({
			ok: false,
			issues: expect.arrayContaining([
				{ path: "/restore_files/0/paw_owned", message: "Expected true." },
				{ path: "/restore_files/1/path", message: "Path must not traverse outside the repository root." },
				{ path: "/restore_files/2/path", message: "Path must be relative to the repository root." },
				{ path: "/restore_files/3/path", message: "Path must not target secret or credential files." },
			]),
		});
	});

	test("validation requires task_start checkpoints to have null slice id", () => {
		const validation = validatePawCheckpointMetadata(
			createMetadata({
				scope: "task_start",
				slice_id: "slice-1",
			}),
		);

		expect(validation).toEqual({
			ok: false,
			issues: [{ path: "/slice_id", message: "Expected null for task_start checkpoint scope." }],
		});
	});
});
