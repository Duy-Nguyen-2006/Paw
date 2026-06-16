import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { writePawSubAgentArtifactReport } from "../src/paw/index.ts";

const tempRoots: string[] = [];

async function createTempRepo(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-subagent-artifacts-"));
	tempRoots.push(root);
	return root;
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return false;
		}
		throw error;
	}
}

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("writePawSubAgentArtifactReport", () => {
	test("writes report content to the canonical artifact path", async () => {
		const repoRoot = await createTempRepo();
		const reportContent = "# Worker Report\n\nDone.\n";

		const result = await writePawSubAgentArtifactReport({
			repoRoot,
			artifactName: "20260616T030405Z-task-abc123",
			agent: "worker",
			reportContent,
			maxReportBytes: 1024,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({
				paths: {
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
				},
				artifactRef: ".paw/artifacts/20260616T030405Z-task-abc123/worker/report.md",
				byteLength: Buffer.byteLength(reportContent, "utf-8"),
				maxReportBytes: 1024,
			});
			await expect(readFile(result.value.paths.reportFile, "utf-8")).resolves.toBe(reportContent);
		}
	});

	test("rejects oversized report content before writing", async () => {
		const repoRoot = await createTempRepo();
		const reportContent = "hello";

		const result = await writePawSubAgentArtifactReport({
			repoRoot,
			artifactName: "20260616T030405Z-task-abc123",
			agent: "worker",
			reportContent,
			maxReportBytes: 4,
		});

		expect(result).toEqual({
			ok: false,
			issues: [
				{
					path: "/reportContent",
					message: "Report content is 5 bytes, exceeding maxReportBytes 4.",
				},
			],
		});
		await expect(pathExists(join(resolve(repoRoot), ".paw", "artifacts"))).resolves.toBe(false);
	});

	test("returns validation issues for invalid artifact names without writing", async () => {
		const repoRoot = await createTempRepo();

		const result = await writePawSubAgentArtifactReport({
			repoRoot,
			artifactName: "../escape",
			agent: "worker",
			reportContent: "safe",
			maxReportBytes: 1024,
		});

		expect(result).toEqual({
			ok: false,
			issues: [
				{
					path: "/artifactName",
					message:
						"Paw artifact name must be non-empty, contain only alphanumeric characters and '-', and start and end with an alphanumeric character.",
				},
			],
		});
		await expect(pathExists(join(resolve(repoRoot), ".paw", "artifacts"))).resolves.toBe(false);
	});
});
