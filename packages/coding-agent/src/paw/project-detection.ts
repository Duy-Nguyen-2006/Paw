import { existsSync } from "node:fs";

export type PawDetectedPackageManager = "npm" | "yarn" | "pnpm" | "bun" | "none";
export type PawDetectedLanguage = "javascript" | "typescript" | "python" | "go" | "rust" | "java" | "unknown";
export type PawDetectedMonorepo = "pnpm-workspace" | "yarn-workspace" | "npm-workspace" | "lerna" | "nx" | "none";

export interface PawProjectDetection {
	packageManager: PawDetectedPackageManager;
	language: PawDetectedLanguage;
	monorepo: PawDetectedMonorepo;
	hasTypeScript: boolean;
	hasPython: boolean;
	hasTestRunner: "vitest" | "jest" | "mocha" | "pytest" | "cargo" | "go" | "none";
	hasLockfile: boolean;
	indicators: readonly string[];
}

export function detectPawProject(repoRoot: string): PawProjectDetection {
	const indicators: string[] = [];
	const packageManager = detectPackageManager(repoRoot, indicators);
	const language = detectLanguage(repoRoot, indicators);
	const monorepo = detectMonorepo(repoRoot, indicators);
	const hasTypeScript =
		language === "typescript" ||
		existsSync(`${repoRoot}/tsconfig.json`) ||
		existsSync(`${repoRoot}/tsconfig.base.json`);
	const hasPython =
		language === "python" || existsSync(`${repoRoot}/pyproject.toml`) || existsSync(`${repoRoot}/requirements.txt`);
	const hasTestRunner = detectTestRunner(repoRoot, indicators);
	const hasLockfile = [
		`${repoRoot}/package-lock.json`,
		`${repoRoot}/yarn.lock`,
		`${repoRoot}/pnpm-lock.yaml`,
		`${repoRoot}/bun.lockb`,
		`${repoRoot}/bun.lock`,
		`${repoRoot}/Cargo.lock`,
		`${repoRoot}/go.sum`,
		`${repoRoot}/Pipfile.lock`,
		`${repoRoot}/poetry.lock`,
		`${repoRoot}/uv.lock`,
	].some((path) => existsSync(path));
	return { packageManager, language, monorepo, hasTypeScript, hasPython, hasTestRunner, hasLockfile, indicators };
}

function detectPackageManager(repoRoot: string, indicators: string[]): PawDetectedPackageManager {
	if (existsSync(`${repoRoot}/pnpm-lock.yaml`) || existsSync(`${repoRoot}/pnpm-workspace.yaml`)) {
		indicators.push("pnpm-lock.yaml present");
		return "pnpm";
	}
	if (existsSync(`${repoRoot}/bun.lockb`) || existsSync(`${repoRoot}/bun.lock`)) {
		indicators.push("bun lock present");
		return "bun";
	}
	if (existsSync(`${repoRoot}/yarn.lock`)) {
		indicators.push("yarn.lock present");
		return "yarn";
	}
	if (existsSync(`${repoRoot}/package-lock.json`)) {
		indicators.push("package-lock.json present");
		return "npm";
	}
	if (existsSync(`${repoRoot}/package.json`)) {
		indicators.push("package.json present (no lockfile)");
		return "npm";
	}
	return "none";
}

function detectLanguage(repoRoot: string, indicators: string[]): PawDetectedLanguage {
	if (existsSync(`${repoRoot}/Cargo.toml`)) {
		indicators.push("Cargo.toml present");
		return "rust";
	}
	if (existsSync(`${repoRoot}/go.mod`)) {
		indicators.push("go.mod present");
		return "go";
	}
	if (
		existsSync(`${repoRoot}/pyproject.toml`) ||
		existsSync(`${repoRoot}/requirements.txt`) ||
		existsSync(`${repoRoot}/setup.py`)
	) {
		indicators.push("Python project files present");
		return "python";
	}
	if (
		existsSync(`${repoRoot}/pom.xml`) ||
		existsSync(`${repoRoot}/build.gradle`) ||
		existsSync(`${repoRoot}/build.gradle.kts`)
	) {
		indicators.push("Java build files present");
		return "java";
	}
	if (existsSync(`${repoRoot}/tsconfig.json`)) {
		indicators.push("tsconfig.json present");
		return "typescript";
	}
	if (existsSync(`${repoRoot}/package.json`)) {
		indicators.push("package.json present (no TypeScript config)");
		return "javascript";
	}
	return "unknown";
}

function readPackageJsonWorkspaces(repoRoot: string): unknown | null {
	const pkgPath = `${repoRoot}/package.json`;
	if (!existsSync(pkgPath)) return null;
	try {
		const pkg = JSON.parse(require("node:fs").readFileSync(pkgPath, "utf-8")) as { workspaces?: unknown };
		return pkg.workspaces ?? null;
	} catch {
		return null;
	}
}

function hasNpmWorkspacesField(workspaces: unknown): boolean {
	return Array.isArray(workspaces) || (typeof workspaces === "object" && workspaces !== null);
}

function detectMonorepo(repoRoot: string, indicators: string[]): PawDetectedMonorepo {
	if (existsSync(`${repoRoot}/pnpm-workspace.yaml`)) {
		indicators.push("pnpm-workspace.yaml present");
		return "pnpm-workspace";
	}
	if (existsSync(`${repoRoot}/lerna.json`)) {
		indicators.push("lerna.json present");
		return "lerna";
	}
	if (existsSync(`${repoRoot}/nx.json`)) {
		indicators.push("nx.json present");
		return "nx";
	}
	const workspaces = readPackageJsonWorkspaces(repoRoot);
	if (workspaces !== null && hasNpmWorkspacesField(workspaces)) {
		indicators.push("package.json has workspaces field");
		if (existsSync(`${repoRoot}/yarn.lock`)) return "yarn-workspace";
		return "npm-workspace";
	}
	return "none";
}

const JS_TEST_RUNNER_KEYS: readonly { key: string; runner: "vitest" | "jest" | "mocha"; indicator: string }[] = [
	{ key: "vitest", runner: "vitest", indicator: "vitest in dependencies" },
	{ key: "jest", runner: "jest", indicator: "jest in dependencies" },
	{ key: "mocha", runner: "mocha", indicator: "mocha in dependencies" },
];

function detectJsTestRunnerFromPackage(
	repoRoot: string,
	indicators: string[],
): PawProjectDetection["hasTestRunner"] | null {
	const pkgPath = `${repoRoot}/package.json`;
	if (!existsSync(pkgPath)) return null;
	try {
		const pkg = JSON.parse(require("node:fs").readFileSync(pkgPath, "utf-8")) as {
			devDependencies?: Record<string, string>;
			dependencies?: Record<string, string>;
		};
		const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
		for (const entry of JS_TEST_RUNNER_KEYS) {
			if (entry.key in all) {
				indicators.push(entry.indicator);
				return entry.runner;
			}
		}
	} catch {
		// ignore
	}
	return null;
}

function detectPytestFromFile(
	repoRoot: string,
	relativePath: string,
	indicator: string,
	indicators: string[],
): boolean {
	const fullPath = `${repoRoot}/${relativePath}`;
	if (!existsSync(fullPath)) return false;
	try {
		const content = require("node:fs").readFileSync(fullPath, "utf-8");
		if (/pytest/.test(content)) {
			indicators.push(indicator);
			return true;
		}
	} catch {
		// ignore
	}
	return false;
}

function detectTestRunner(repoRoot: string, indicators: string[]): PawProjectDetection["hasTestRunner"] {
	const fromJs = detectJsTestRunnerFromPackage(repoRoot, indicators);
	if (fromJs !== null) return fromJs;
	if (detectPytestFromFile(repoRoot, "pyproject.toml", "pytest in pyproject.toml", indicators)) return "pytest";
	if (detectPytestFromFile(repoRoot, "requirements.txt", "pytest in requirements.txt", indicators)) return "pytest";
	if (existsSync(`${repoRoot}/Cargo.toml`)) {
		indicators.push("Cargo.toml present (cargo test)");
		return "cargo";
	}
	if (existsSync(`${repoRoot}/go.mod`)) {
		indicators.push("go.mod present (go test)");
		return "go";
	}
	return "none";
}

export function buildPawVerifyCommand(plan: PawProjectDetection): string[] {
	const commands: string[] = [];
	if (plan.language === "typescript" || plan.language === "javascript") {
		if (plan.hasTypeScript) commands.push("npx tsc --noEmit");
		if (plan.hasTestRunner === "vitest") commands.push("npx vitest run");
		else if (plan.hasTestRunner === "jest") commands.push("npx jest --runInBand");
		else if (plan.hasTestRunner === "mocha") commands.push("npx mocha");
		if (plan.packageManager === "pnpm") commands.push("pnpm run -r build");
		else if (plan.packageManager === "yarn") commands.push("yarn workspaces run build");
		else commands.push("npm run build");
	} else if (plan.language === "python") {
		commands.push("python -m pytest -q");
	} else if (plan.language === "rust") {
		commands.push("cargo test --workspace");
	} else if (plan.language === "go") {
		commands.push("go test ./...");
	} else {
		commands.push("echo 'no verify plan available'");
	}
	return commands;
}
