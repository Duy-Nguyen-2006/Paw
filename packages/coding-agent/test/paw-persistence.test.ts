import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
	initializePawProject,
	loadDefaultPawRuntimeConfig,
	readPawJson,
	renderPawGitignore,
	resolvePawProjectPaths,
	writePawJsonAtomic,
} from "../src/paw/index.ts";

const tempRoots: string[] = [];

async function createTempRepo(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-persistence-"));
	tempRoots.push(root);
	return root;
}

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Paw project persistence", () => {
	test("resolves project paths under an absolute repository root", async () => {
		const repoRoot = await createTempRepo();
		const paths = resolvePawProjectPaths(join(repoRoot, "."));

		expect(paths.repoRoot).toBe(resolve(repoRoot));
		expect(paths.pawDir).toBe(join(resolve(repoRoot), ".paw"));
		expect(paths.configFile).toBe(join(resolve(repoRoot), ".paw", "config.yaml"));
		expect(paths.memoriesFile).toBe(join(resolve(repoRoot), ".paw", "memory", "memories.yaml"));
		expect(paths.gitignoreFile).toBe(join(resolve(repoRoot), ".paw", ".gitignore"));
	});

	test("renders .paw/.gitignore from the runtime config policy", () => {
		const config = loadDefaultPawRuntimeConfig();
		const gitignore = renderPawGitignore(config);

		for (const entry of config.persistence.gitignore.ignore) {
			expect(gitignore).toContain(`${entry}\n`);
		}

		for (const entry of config.persistence.gitignore.commit) {
			expect(gitignore).toContain(`# ${entry}\n`);
		}

		expect(gitignore.endsWith("\n")).toBe(true);
	});

	test("initializes .paw idempotently without overwriting existing durable files", async () => {
		const repoRoot = await createTempRepo();
		const config = loadDefaultPawRuntimeConfig();
		const paths = resolvePawProjectPaths(repoRoot);

		await writeFile(join(repoRoot, "placeholder.txt"), "repo exists\n", "utf-8");
		const first = await initializePawProject(repoRoot, config);

		expect(first.paths).toEqual(paths);
		expect(first.created).toEqual(
			expect.arrayContaining([
				paths.pawDir,
				paths.memoryDir,
				paths.rulesDir,
				paths.decisionsDir,
				paths.configFile,
				paths.versionFile,
				paths.memoriesFile,
				paths.gitignoreFile,
			]),
		);

		await writeFile(paths.configFile, "custom: true\n", "utf-8");
		await writeFile(paths.memoriesFile, "memories:\n  - keep me\n", "utf-8");
		await writeFile(paths.gitignoreFile, "custom-ignore/\n", "utf-8");

		const second = await initializePawProject(repoRoot, config);

		expect(second.created).toEqual([]);
		expect(second.existing).toEqual(
			expect.arrayContaining([
				paths.pawDir,
				paths.memoryDir,
				paths.rulesDir,
				paths.decisionsDir,
				paths.configFile,
				paths.versionFile,
				paths.memoriesFile,
				paths.gitignoreFile,
			]),
		);
		expect(await readFile(paths.configFile, "utf-8")).toBe("custom: true\n");
		expect(await readFile(paths.memoriesFile, "utf-8")).toBe("memories:\n  - keep me\n");
		expect(await readFile(paths.gitignoreFile, "utf-8")).toBe("custom-ignore/\n");
	});

	test("writes and reads JSON with same-directory temp rename semantics", async () => {
		const repoRoot = await createTempRepo();
		const paths = resolvePawProjectPaths(repoRoot);
		const statePath = join(paths.pawDir, "sessions", "session-1", "state.json");
		const state = {
			session_id: "session-1",
			name: "IDLE",
			pending_slice_ids: ["slice-1"],
		};

		await writePawJsonAtomic(statePath, state);

		const parsed = await readPawJson<typeof state>(statePath);
		expect(parsed).toEqual(state);
		expect(JSON.parse(await readFile(statePath, "utf-8"))).toEqual(state);

		const stateDir = join(paths.pawDir, "sessions", "session-1");
		expect((await stat(stateDir)).isDirectory()).toBe(true);
		expect((await readdir(stateDir)).filter((name) => name.includes(".tmp"))).toEqual([]);
	});
});
