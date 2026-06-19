import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { PawRuntimeConfig, PawSubAgentOutput } from "../src/paw/contracts.ts";
import { applyPawWorkerOutputPatches, hashPawPatchContent, loadDefaultPawRuntimeConfig } from "../src/paw/index.ts";

const tempRoots: string[] = [];
const sourceRoot = join(import.meta.dirname, "..", "..", "..");

async function createTempRepo(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-patch-apply-"));
	tempRoots.push(root);
	return root;
}

function createConfig(): PawRuntimeConfig {
	return loadDefaultPawRuntimeConfig(sourceRoot);
}

function createWorkerOutput(overrides: Partial<PawSubAgentOutput> = {}): PawSubAgentOutput {
	return {
		status: "pass",
		confidence: "high",
		agent: "worker",
		session_id: "session-1",
		slice_id: "slice-1",
		artifact_ref: ".paw/artifacts/session-1/worker/report.md",
		changed_files: [],
		inspected_files: [],
		risks: [],
		next_actions: [],
		tokens_used: 1,
		usd_cost: 0,
		degraded: false,
		model_used: "test-model",
		...overrides,
	};
}

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("applyPawWorkerOutputPatches", () => {
	test("applies full-file create and modify patches with hash validation", async () => {
		const root = await createTempRepo();
		await mkdir(join(root, "src"), { recursive: true });
		await writeFile(join(root, "src/a.ts"), "export const a = 1;\n", "utf-8");
		const nextA = "export const a = 2;\n";
		const nextB = "export const b = 1;\n";

		const result = await applyPawWorkerOutputPatches({
			repoRoot: root,
			config: createConfig(),
			workerOutput: createWorkerOutput({
				changed_files: [
					{
						path: "src/a.ts",
						change_type: "modify",
						apply_method: "full_file",
						base_content_hash: hashPawPatchContent("export const a = 1;\n"),
						content_hash: hashPawPatchContent(nextA),
						new_content: nextA,
					},
					{
						path: "src/b.ts",
						change_type: "create",
						apply_method: "full_file",
						base_content_hash: null,
						content_hash: hashPawPatchContent(nextB),
						new_content: nextB,
					},
				],
			}),
		});

		expect(result.status).toBe("applied");
		expect(await readFile(join(root, "src/a.ts"), "utf-8")).toBe(nextA);
		expect(await readFile(join(root, "src/b.ts"), "utf-8")).toBe(nextB);
	});

	test("blocks traversal, hash mismatch, and stale base content", async () => {
		const root = await createTempRepo();
		await mkdir(join(root, "src"), { recursive: true });
		await writeFile(join(root, "src/a.ts"), "current\n", "utf-8");
		const result = await applyPawWorkerOutputPatches({
			repoRoot: root,
			config: createConfig(),
			workerOutput: createWorkerOutput({
				changed_files: [
					{
						path: "../escape.ts",
						change_type: "create",
						apply_method: "full_file",
						content_hash: hashPawPatchContent("bad\n"),
						new_content: "bad\n",
					},
					{
						path: "src/a.ts",
						change_type: "modify",
						apply_method: "full_file",
						base_content_hash: hashPawPatchContent("old\n"),
						content_hash: hashPawPatchContent("next\n"),
						new_content: "next\n",
					},
					{
						path: "src/b.ts",
						change_type: "create",
						apply_method: "full_file",
						content_hash: "sha256:not-real",
						new_content: "next\n",
					},
				],
			}),
		});

		expect(result.status).toBe("blocked");
		if (result.status !== "blocked") return;
		expect(result.issues.map((issue) => issue.path)).toEqual([
			"/changed_files/0/path",
			"/changed_files/1/base_content_hash",
			"/changed_files/2/content_hash",
		]);
		expect(await readFile(join(root, "src/a.ts"), "utf-8")).toBe("current\n");
	});
});
