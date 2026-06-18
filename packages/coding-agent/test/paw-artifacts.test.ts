import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
	assertPawArtifactRef,
	createPawArtifactName,
	isPawArtifactRef,
	readPawArtifactReport,
	resolvePawArtifactPaths,
	writePawArtifactReport,
} from "../src/paw/index.ts";

const tempRoots: string[] = [];

async function createTempRepo(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-artifacts-"));
	tempRoots.push(root);
	return root;
}

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Paw artifact paths", () => {
	test("creates deterministic artifact names with UTC timestamp, slug, and short id", () => {
		const name = createPawArtifactName({
			timestamp: new Date("2026-06-16T03:04:05.678Z"),
			slug: "Implement US-014",
			shortId: "abc123",
		});

		expect(name).toBe("20260616T030405Z-implement-us-014-abc123");
	});

	test("sanitizes slug whitespace and symbols and falls back for empty slug", () => {
		expect(
			createPawArtifactName({
				timestamp: "2026-06-16T03:04:05.678Z",
				slug: "  Path ++ Persistence / Artifacts!  ",
				shortId: "ID_99!",
			}),
		).toBe("20260616T030405Z-path-persistence-artifacts-id99");

		expect(
			createPawArtifactName({
				timestamp: "2026-06-16T03:04:05.678Z",
				slug: " !@# ",
				shortId: "abc123",
			}),
		).toBe("20260616T030405Z-artifact-abc123");
	});

	test("resolves report paths and artifact ref under the repository root", async () => {
		const repoRoot = await createTempRepo();
		const paths = resolvePawArtifactPaths(repoRoot, "20260616T030405Z-task-abc123", "worker");

		expect(paths).toEqual({
			repoRoot: resolve(repoRoot),
			artifactName: "20260616T030405Z-task-abc123",
			agent: "worker",
			artifactDir: join(resolve(repoRoot), ".paw", "artifacts", "20260616T030405Z-task-abc123"),
			agentDir: join(resolve(repoRoot), ".paw", "artifacts", "20260616T030405Z-task-abc123", "worker"),
			reportFile: join(
				resolve(repoRoot),
				".paw",
				"artifacts",
				"20260616T030405Z-task-abc123",
				"worker",
				"report.md",
			),
			artifactRef: ".paw/artifacts/20260616T030405Z-task-abc123/worker/report.md",
		});
	});

	test("writes and reads report content while creating parent directories", async () => {
		const repoRoot = await createTempRepo();
		const content = "# Worker Report\n\nPreserve this content.\n";
		const paths = await writePawArtifactReport(repoRoot, "20260616T030405Z-task-abc123", "worker", content);

		await expect(readPawArtifactReport(repoRoot, "20260616T030405Z-task-abc123", "worker")).resolves.toBe(content);
		expect(await readFile(paths.reportFile, "utf-8")).toBe(content);
		expect((await stat(paths.agentDir)).isDirectory()).toBe(true);
	});

	test("validates only canonical sub-agent report artifact refs", () => {
		for (const agent of ["scout", "planner", "worker", "reviewer"]) {
			const ref = `.paw/artifacts/20260616T030405Z-task-abc123/${agent}/report.md`;
			expect(isPawArtifactRef(ref)).toBe(true);
			expect(() => assertPawArtifactRef(ref)).not.toThrow();
		}

		for (const ref of [
			".paw/artifacts/20260616T030405Z-task-abc123/editor/report.md",
			".paw/artifacts/20260616T030405Z-task-abc123/worker/full.md",
			"paw/artifacts/20260616T030405Z-task-abc123/worker/report.md",
		]) {
			expect(isPawArtifactRef(ref)).toBe(false);
			expect(() => assertPawArtifactRef(ref)).toThrow(ref);
		}
	});

	test("rejects artifact names with traversal or slashes", async () => {
		const repoRoot = await createTempRepo();

		for (const artifactName of ["../x", "task/name", "task\\name"]) {
			expect(() => resolvePawArtifactPaths(repoRoot, artifactName, "worker")).toThrow(
				"Paw artifact name must be non-empty",
			);
		}
	});
});
