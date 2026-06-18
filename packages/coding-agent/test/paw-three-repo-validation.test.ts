
import { spawn } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ENV_AGENT_DIR } from "../src/config.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");
const cliPath = resolve(testDir, "../src/cli.ts");
const sourceConfigPath = join(repoRoot, "paw-spec", "config.yaml");
const tsxImportPath = join(repoRoot, "node_modules", "tsx", "dist", "loader.mjs");
const tempDirs: string[] = [];

interface FixtureRepo {
	agentDir: string;
	homeDir: string;
	name: string;
	projectDir: string;
	sentinelFiles: string[];
	toolBinDir: string;
}

interface CliResult {
	code: number | null;
	signal: NodeJS.Signals | null;
	stdout: string;
	stderr: string;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

function createTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "paw-three-repo-validation-"));
	tempDirs.push(dir);
	return dir;
}

function writeFixtureFile(projectDir: string, relativePath: string, content: string): string {
	const filePath = join(projectDir, relativePath);
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, content, "utf-8");
	return filePath;
}

function createFixtureRepo(tempRoot: string, name: string, files: Record<string, string>): FixtureRepo {
	const projectDir = join(tempRoot, name);
	const agentDir = join(tempRoot, "agents", name);
	const homeDir = join(tempRoot, "homes", name);
	const toolBinDir = join(tempRoot, "tools", name);
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(homeDir, { recursive: true });
	mkdirSync(toolBinDir, { recursive: true });
	mkdirSync(join(projectDir, "paw-spec"), { recursive: true });
	writeFileSync(join(projectDir, "paw-spec", "config.yaml"), readFileSync(sourceConfigPath, "utf-8"), "utf-8");

	const sentinelFiles = Object.entries(files).map(([relativePath, content]) =>
		writeFixtureFile(projectDir, relativePath, content),
	);
	writeFileSync(
		join(projectDir, "package.json"),
		JSON.stringify(
			{
				name,
				private: true,
				scripts: {
					"check:browser-smoke": "node scripts/check-browser-smoke.mjs",
					build: "node scripts/build.mjs",
					check: "node scripts/check.mjs",
					test: "node scripts/test.mjs",
				},
			},
			null,
			"\t",
		),
		"utf-8",
	);
	writeVerificationScript(projectDir, "scripts/check.mjs", `${name} check ok`);
	writeVerificationScript(projectDir, "scripts/build.mjs", `${name} build ok`);
	writeVerificationScript(projectDir, "scripts/test.mjs", `${name} test ok`);
	writeVerificationScript(projectDir, "scripts/check-browser-smoke.mjs", `${name} browser smoke ok`);
	writeExecutableFile(projectDir, "test.sh", `#!/usr/bin/env sh\necho ${name} test.sh ok\n`);
	writeToolShim(toolBinDir, "git", "process.exit(0);");

	return { agentDir, homeDir, name, projectDir, sentinelFiles, toolBinDir };
}

function writeVerificationScript(projectDir: string, relativePath: string, message: string): void {
	writeFixtureFile(projectDir, relativePath, `console.log(${JSON.stringify(message)});\n`);
}

function writeExecutableFile(projectDir: string, relativePath: string, content: string): void {
	const filePath = writeFixtureFile(projectDir, relativePath, content);
	chmodSync(filePath, 0o755);
}

function writeToolShim(toolBinDir: string, commandName: string, body: string): void {
	const shimPath = join(toolBinDir, commandName);
	writeFileSync(shimPath, `#!/usr/bin/env node\n${body}\n`, "utf-8");
	chmodSync(shimPath, 0o755);
}

function createFixtureRepos(tempRoot: string): FixtureRepo[] {
	return [
		createFixtureRepo(tempRoot, "nextjs-web-app", {
			"app/page.tsx": `export default function Page() {\n\treturn <main>Paw web sentinel</main>;\n}\n`,
			"next.config.mjs": `const nextConfig = {};\nexport default nextConfig;\n`,
			"src/lib/sentinel.ts": `export const sentinel = "nextjs-web-app";\n`,
		}),
		createFixtureRepo(tempRoot, "fastapi-service", {
			"app/main.py": `from fastapi import FastAPI\n\napp = FastAPI()\n\n@app.get("/health")\ndef health():\n    return {"status": "ok", "sentinel": "fastapi-service"}\n`,
			"pyproject.toml": `[project]\nname = "fastapi-service"\nversion = "0.0.0"\n`,
			"tests/test_health.py": `def test_sentinel():\n    assert "fastapi-service" == "fastapi-service"\n`,
		}),
		createFixtureRepo(tempRoot, "node-cli", {
			"bin/cli.js": `#!/usr/bin/env node\nconsole.log("node-cli sentinel");\n`,
			"src/index.js": `export function main() {\n\treturn "node-cli";\n}\n`,
			"test/index.test.js": `import { strictEqual } from "node:assert";\nstrictEqual("node-cli", "node-cli");\n`,
		}),
	];
}

async function runCli(fixture: FixtureRepo, args: string[]): Promise<CliResult> {
	const child = spawn(process.execPath, ["--import", tsxImportPath, cliPath, ...args], {
		cwd: fixture.projectDir,
		env: {
			...withoutProviderEnv(process.env),
			[ENV_AGENT_DIR]: fixture.agentDir,
			HOME: fixture.homeDir,
			PI_OFFLINE: "1",
			TSX_TSCONFIG_PATH: resolve(testDir, "../../../tsconfig.json"),
			XDG_CACHE_HOME: join(fixture.homeDir, ".cache"),
			XDG_CONFIG_HOME: join(fixture.homeDir, ".config"),
			PATH: `${fixture.toolBinDir}:${process.env.PATH ?? ""}`,
		},
		stdio: ["ignore", "pipe", "pipe"],
	});

	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk) => {
		stdout += chunk.toString();
	});
	child.stderr.on("data", (chunk) => {
		stderr += chunk.toString();
	});

	return await new Promise((resolvePromise, reject) => {
		const timeout = setTimeout(() => {
			child.kill("SIGKILL");
		}, 10_000);
		child.on("error", (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.on("close", (code, signal) => {
			clearTimeout(timeout);
			resolvePromise({ code, signal, stdout, stderr });
		});
	});
}

function withoutProviderEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const env = { ...source };
	for (const key of [
		"ANTHROPIC_API_KEY",
		"ANTHROPIC_OAUTH_TOKEN",
		"OPENAI_API_KEY",
		"AZURE_OPENAI_API_KEY",
		"GEMINI_API_KEY",
		"GROQ_API_KEY",
		"CEREBRAS_API_KEY",
		"XAI_API_KEY",
		"OPENROUTER_API_KEY",
		"ZAI_API_KEY",
		"ZAI_CODING_CN_API_KEY",
		"MISTRAL_API_KEY",
		"MINIMAX_API_KEY",
		"MINIMAX_CN_API_KEY",
		"MOONSHOT_API_KEY",
		"KIMI_API_KEY",
		"HF_TOKEN",
		"FIREWORKS_API_KEY",
		"TOGETHER_API_KEY",
		"AI_GATEWAY_API_KEY",
		"OPENCODE_API_KEY",
		"CLOUDFLARE_API_KEY",
		"CLOUDFLARE_ACCOUNT_ID",
		"CLOUDFLARE_GATEWAY_ID",
		"XIAOMI_API_KEY",
		"XIAOMI_TOKEN_PLAN_CN_API_KEY",
		"XIAOMI_TOKEN_PLAN_AMS_API_KEY",
		"XIAOMI_TOKEN_PLAN_SGP_API_KEY",
		"COPILOT_GITHUB_TOKEN",
		"GH_TOKEN",
		"GITHUB_TOKEN",
		"GOOGLE_APPLICATION_CREDENTIALS",
		"GOOGLE_CLOUD_PROJECT",
		"GCLOUD_PROJECT",
		"GOOGLE_CLOUD_LOCATION",
		"AWS_PROFILE",
		"AWS_ACCESS_KEY_ID",
		"AWS_SECRET_ACCESS_KEY",
		"AWS_SESSION_TOKEN",
		"AWS_REGION",
		"AWS_DEFAULT_REGION",
		"AWS_BEARER_TOKEN_BEDROCK",
		"AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
		"AWS_CONTAINER_CREDENTIALS_FULL_URI",
		"AWS_WEB_IDENTITY_TOKEN_FILE",
	]) {
		delete env[key];
	}
	return env;
}

function seedVerifyingSession(projectDir: string, sessionId: string): void {
	const sessionDir = join(projectDir, ".paw", "sessions", sessionId);
	mkdirSync(sessionDir, { recursive: true });
	writeFileSync(
		join(sessionDir, "state.json"),
		JSON.stringify(
			{
				session_id: sessionId,
				name: "VERIFYING",
				current_slice_id: "slice-1",
				pending_slice_ids: [],
				completed_slice_ids: [],
				blocked_reason: null,
			},
			null,
			"\t",
		),
		"utf-8",
	);
}

function readSentinelContents(fixture: FixtureRepo): Map<string, string> {
	return new Map(fixture.sentinelFiles.map((filePath) => [filePath, readFileSync(filePath, "utf-8")]));
}

function expectSentinelsUnchanged(before: Map<string, string>): void {
	for (const [filePath, expectedContent] of before) {
		expect(readFileSync(filePath, "utf-8")).toBe(expectedContent);
	}
}

function expectIsolatedProviderConfig(fixture: FixtureRepo): void {
	expect(existsSync(join(fixture.agentDir, "models.json"))).toBe(false);
	expect(existsSync(join(fixture.homeDir, ".factory"))).toBe(false);
	const agentEntries = readdirSync(fixture.agentDir).filter((entry) => entry !== "auth.json");
	expect(agentEntries).toEqual([]);
}

describe("fixture-based three-repo Paw validation", () => {
	it("runs spawned init, status, verify, finalize, and report flows without corrupting representative repos", async () => {
		const tempRoot = createTempDir();
		const fixtures = createFixtureRepos(tempRoot);

		for (const fixture of fixtures) {
			const before = readSentinelContents(fixture);
			const sessionId = `${fixture.name}-session`;

			const init = await runCli(fixture, ["paw", "init"]);
			expect(init, `${fixture.name} init`).toMatchObject({ code: 0, signal: null, stderr: "" });
			expect(init.stdout).toContain(".paw initialized");
			expect(existsSync(join(fixture.projectDir, ".paw", "config.yaml"))).toBe(true);
			expect(existsSync(join(fixture.projectDir, ".paw", ".gitignore"))).toBe(true);

			const status = await runCli(fixture, ["paw", "status"]);
			expect(status, `${fixture.name} status`).toMatchObject({ code: 0, signal: null, stderr: "" });
			expect(status.stdout).toContain("Paw status");
			expect(status.stdout).toContain("initialized: yes");
			expect(status.stdout).toContain("sessions: 0");

			seedVerifyingSession(fixture.projectDir, sessionId);
			const build = await runCli(fixture, ["paw", "build", sessionId, "--once", "--native"]);
			expect(build, `${fixture.name} build`).toMatchObject({ code: 0, signal: null, stderr: "" });
			expect(build.stdout).toContain("Paw build");
			expect(build.stdout).toContain("status: completed");
			expect(build.stdout).toContain("native executed gates:");
			expect(build.stdout).not.toContain("native executed gates: none");
			expect(build.stdout).toContain("verified gates:");

			const finalize = await runCli(fixture, [
				"paw",
				"finalize",
				sessionId,
				"--summary",
				`Native fixture validation completed for ${fixture.name}.`,
				"--evidence",
				"spawned Paw build --native completed with provider environment removed and native gates executed",
			]);
			expect(finalize, `${fixture.name} finalize`).toMatchObject({ code: 0, signal: null, stderr: "" });
			expect(finalize.stdout).toContain("Paw finalize");
			expect(finalize.stdout).toContain("status: completed");

			const report = await runCli(fixture, ["paw", "report", sessionId]);
			expect(report, `${fixture.name} report`).toMatchObject({ code: 0, signal: null, stderr: "" });
			expect(report.stdout).toContain(`Native fixture validation completed for ${fixture.name}.`);
			expect(report.stdout).toContain("native gates executed");

			expect(existsSync(join(fixture.projectDir, ".paw", "sessions", sessionId, "state.json"))).toBe(true);
			expect(existsSync(join(fixture.projectDir, ".paw", "sessions", sessionId, "report.json"))).toBe(true);
			expectSentinelsUnchanged(before);
			expectIsolatedProviderConfig(fixture);
		}
	}, 90_000);
});
