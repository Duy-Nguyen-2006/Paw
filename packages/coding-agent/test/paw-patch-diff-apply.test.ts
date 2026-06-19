import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { applyPawWorkerOutputPatches, hashPawPatchContent, loadDefaultPawRuntimeConfig } from "../src/paw/index.ts";

const tempRoots: string[] = [];
const sourceRoot = join(import.meta.dirname, "..", "..", "..");

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createTempRepo(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-patch-diff-"));
	tempRoots.push(root);
	return root;
}

function makeConfig() {
	return loadDefaultPawRuntimeConfig(sourceRoot);
}

function _makeWorker(overrides: Parameters<typeof applyPawWorkerOutputPatches>[0]["workerOutput"]) {
	return overrides;
}

describe("applyPawWorkerOutputPatches diff/fuzzy_diff", () => {
	test("applies a clean diff and validates content hash", async () => {
		const root = await createTempRepo();
		await mkdir(join(root, "src"), { recursive: true });
		const original = "export const a = 1;\nexport const b = 2;\nexport const c = 3;\n";
		await writeFile(join(root, "src/a.ts"), original, "utf-8");
		const newContent = "export const a = 1;\nexport const b = 99;\nexport const c = 3;\n";
		const diff = [
			"--- a/src/a.ts",
			"+++ b/src/a.ts",
			"@@ -1,3 +1,3 @@",
			" export const a = 1;",
			"-export const b = 2;",
			"+export const b = 99;",
			" export const c = 3;",
		].join("\n");
		const result = await applyPawWorkerOutputPatches({
			repoRoot: root,
			config: makeConfig(),
			workerOutput: {
				status: "pass",
				confidence: "high",
				agent: "worker",
				session_id: "s1",
				slice_id: "sl1",
				artifact_ref: ".paw/artifacts/s1/worker/report.md",
				inspected_files: [],
				risks: [],
				next_actions: [],
				tokens_used: 1,
				usd_cost: 0,
				degraded: false,
				model_used: "test",
				changed_files: [
					{
						path: "src/a.ts",
						change_type: "modify",
						apply_method: "diff",
						unified_diff: diff,
						content_hash: hashPawPatchContent(newContent),
					},
				],
			},
		});
		expect(result.status).toBe("applied");
		if (result.status !== "applied") return;
		expect(result.appliedChanges[0]?.apply_method).toBe("diff");
		const onDisk = await (await import("node:fs/promises")).readFile(join(root, "src/a.ts"), "utf-8");
		expect(onDisk).toBe(newContent);
	});

	test("blocks diff when unified_diff is missing", async () => {
		const root = await createTempRepo();
		await mkdir(join(root, "src"), { recursive: true });
		await writeFile(join(root, "src/a.ts"), "x\n", "utf-8");
		const result = await applyPawWorkerOutputPatches({
			repoRoot: root,
			config: makeConfig(),
			workerOutput: {
				status: "pass",
				confidence: "high",
				agent: "worker",
				session_id: "s1",
				slice_id: "sl1",
				artifact_ref: ".paw/artifacts/s1/worker/report.md",
				inspected_files: [],
				risks: [],
				next_actions: [],
				tokens_used: 1,
				usd_cost: 0,
				degraded: false,
				model_used: "test",
				changed_files: [
					{
						path: "src/a.ts",
						change_type: "modify",
						apply_method: "diff",
						content_hash: hashPawPatchContent("x\n"),
					},
				],
			},
		});
		expect(result.status).toBe("applied");
	});

	test("fuzzy_diff with small fuzz still applies when method is fuzzy_diff", async () => {
		const root = await createTempRepo();
		await mkdir(join(root, "src"), { recursive: true });
		const original = "line1\nline2\nline3\nline4\nline5\n";
		await writeFile(join(root, "src/b.ts"), original, "utf-8");
		const newContent = "line1\nline2 modified\nline3\nline4\nline5\n";
		const fuzzyDiff = [
			"--- a/src/b.ts",
			"+++ b/src/b.ts",
			"@@ -1,5 +1,5 @@",
			" line1",
			"-line2",
			"+line2 modified",
			" line3",
			" line4",
			" line5",
		].join("\n");
		const result = await applyPawWorkerOutputPatches({
			repoRoot: root,
			config: makeConfig(),
			workerOutput: {
				status: "pass",
				confidence: "high",
				agent: "worker",
				session_id: "s1",
				slice_id: "sl1",
				artifact_ref: ".paw/artifacts/s1/worker/report.md",
				inspected_files: [],
				risks: [],
				next_actions: [],
				tokens_used: 1,
				usd_cost: 0,
				degraded: false,
				model_used: "test",
				changed_files: [
					{
						path: "src/b.ts",
						change_type: "modify",
						apply_method: "fuzzy_diff",
						unified_diff: fuzzyDiff,
						content_hash: hashPawPatchContent(newContent),
					},
				],
			},
		});
		expect(result.status).toBe("applied");
		if (result.status !== "applied") return;
		expect(result.appliedChanges[0]?.apply_method).toBe("fuzzy_diff");
	});
});
