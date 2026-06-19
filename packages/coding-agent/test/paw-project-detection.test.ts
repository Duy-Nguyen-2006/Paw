import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { buildPawVerifyCommand, detectPawProject } from "../src/paw/index.ts";

describe("detectPawProject", () => {
	test("detects TypeScript + npm from package.json + tsconfig.json", () => {
		const root = mkdtempSync(join(tmpdir(), "paw-detect-"));
		mkdirSync(root, { recursive: true });
		writeFileSync(join(root, "package.json"), JSON.stringify({ name: "demo", devDependencies: { vitest: "*" } }));
		writeFileSync(join(root, "package-lock.json"), "{}");
		writeFileSync(join(root, "tsconfig.json"), "{}");
		const result = detectPawProject(root);
		expect(result.packageManager).toBe("npm");
		expect(result.language).toBe("typescript");
		expect(result.hasTypeScript).toBe(true);
		expect(result.hasTestRunner).toBe("vitest");
		rmSync(root, { recursive: true, force: true });
	});

	test("detects Python with pytest", () => {
		const root = mkdtempSync(join(tmpdir(), "paw-detect-py-"));
		writeFileSync(join(root, "requirements.txt"), "pytest\nflask\n");
		const result = detectPawProject(root);
		expect(result.language).toBe("python");
		expect(result.hasPython).toBe(true);
		expect(result.hasTestRunner).toBe("pytest");
		rmSync(root, { recursive: true, force: true });
	});

	test("detects pnpm workspace monorepo", () => {
		const root = mkdtempSync(join(tmpdir(), "paw-detect-monorepo-"));
		writeFileSync(join(root, "pnpm-lock.yaml"), "");
		writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
		const result = detectPawProject(root);
		expect(result.packageManager).toBe("pnpm");
		expect(result.monorepo).toBe("pnpm-workspace");
		rmSync(root, { recursive: true, force: true });
	});

	test("returns unknown for empty directory", () => {
		const root = mkdtempSync(join(tmpdir(), "paw-detect-empty-"));
		const result = detectPawProject(root);
		expect(result.language).toBe("unknown");
		expect(result.packageManager).toBe("none");
		rmSync(root, { recursive: true, force: true });
	});
});

describe("buildPawVerifyCommand", () => {
	test("returns TypeScript verify command for ts/vitest project", () => {
		const cmds = buildPawVerifyCommand({
			packageManager: "npm",
			language: "typescript",
			monorepo: "none",
			hasTypeScript: true,
			hasPython: false,
			hasTestRunner: "vitest",
			hasLockfile: true,
			indicators: [],
		});
		expect(cmds).toContain("npx tsc --noEmit");
		expect(cmds).toContain("npx vitest run");
	});

	test("returns Python pytest for python project", () => {
		const cmds = buildPawVerifyCommand({
			packageManager: "none",
			language: "python",
			monorepo: "none",
			hasTypeScript: false,
			hasPython: true,
			hasTestRunner: "pytest",
			hasLockfile: false,
			indicators: [],
		});
		expect(cmds).toContain("python -m pytest -q");
	});

	test("returns cargo for Rust project", () => {
		const cmds = buildPawVerifyCommand({
			packageManager: "none",
			language: "rust",
			monorepo: "none",
			hasTypeScript: false,
			hasPython: false,
			hasTestRunner: "cargo",
			hasLockfile: true,
			indicators: [],
		});
		expect(cmds).toContain("cargo test --workspace");
	});
});
