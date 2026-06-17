import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

interface CliDirs {
	agentDir: string;
	projectDir: string;
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
	const dir = mkdtempSync(join(tmpdir(), "paw-cli-e2e-validation-"));
	tempDirs.push(dir);
	return dir;
}

function setupProject(): CliDirs {
	const tempRoot = createTempDir();
	const dirs = {
		agentDir: join(tempRoot, "agent"),
		projectDir: join(tempRoot, "project"),
	};
	mkdirSync(dirs.agentDir, { recursive: true });
	mkdirSync(join(dirs.projectDir, "paw-spec"), { recursive: true });
	writeFileSync(join(dirs.projectDir, "paw-spec", "config.yaml"), readFileSync(sourceConfigPath, "utf-8"), "utf-8");
	return dirs;
}

async function runCli(dirs: CliDirs, args: string[]): Promise<CliResult> {
	const child = spawn(process.execPath, ["--import", tsxImportPath, cliPath, ...args], {
		cwd: dirs.projectDir,
		env: {
			...withoutProviderEnv(process.env),
			[ENV_AGENT_DIR]: dirs.agentDir,
			PI_OFFLINE: "1",
			TSX_TSCONFIG_PATH: resolve(testDir, "../../../tsconfig.json"),
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

describe("spawned Paw CLI validation", () => {
	it("runs a deterministic init, session, verify, finalize, and report flow without provider calls", async () => {
		const dirs = setupProject();

		const init = await runCli(dirs, ["paw", "init"]);
		expect(init).toMatchObject({ code: 0, signal: null, stderr: "" });
		expect(init.stdout).toContain(".paw initialized");
		expect(existsSync(join(dirs.projectDir, ".paw", "config.yaml"))).toBe(true);

		const start = await runCli(dirs, ["paw", "start", "session-1"]);
		expect(start).toMatchObject({ code: 0, signal: null, stderr: "" });
		expect(start.stdout).toContain("Paw start");
		expect(start.stdout).toContain("status: started");
		expect(start.stdout).toContain("state: INTAKE");

		const status = await runCli(dirs, ["paw", "status"]);
		expect(status).toMatchObject({ code: 0, signal: null, stderr: "" });
		expect(status.stdout).toContain("Paw status");
		expect(status.stdout).toContain("initialized: yes");
		expect(status.stdout).toContain("sessions: 1");

		seedVerifyingSession(dirs.projectDir, "session-1");
		const verify = await runCli(dirs, ["paw", "verify", "session-1"]);
		expect(verify).toMatchObject({ code: 0, signal: null, stderr: "" });
		expect(verify.stdout).toContain("Paw verify");
		expect(verify.stdout).toContain("status: completed_with_unverified");
		expect(verify.stdout).toContain("state: VERIFYING -> SLICE_DONE");
		expect(verify.stdout).toContain("native executed gates: none");

		const finalize = await runCli(dirs, [
			"paw",
			"finalize",
			"session-1",
			"--summary",
			"Spawned CLI proof complete.",
			"--evidence",
			"spawned paw verify completed without native provider execution",
		]);
		expect(finalize).toMatchObject({ code: 0, signal: null, stderr: "" });
		expect(finalize.stdout).toContain("Paw finalize");
		expect(finalize.stdout).toContain("status: completed");
		expect(finalize.stdout).toContain("state: SLICE_DONE -> FINAL_REPORT");

		const report = await runCli(dirs, ["paw", "report", "session-1"]);
		expect(report).toMatchObject({ code: 0, signal: null, stderr: "" });
		expect(report.stdout).toContain("Spawned CLI proof complete.");
		expect(report.stdout).toContain("spawned paw verify completed without native provider execution");

		const finalState = JSON.parse(
			readFileSync(join(dirs.projectDir, ".paw", "sessions", "session-1", "state.json"), "utf-8"),
		) as {
			name?: string;
		};
		expect(finalState.name).toBe("FINAL_REPORT");
		expect(existsSync(join(dirs.projectDir, ".paw", "sessions", "session-1", "report.json"))).toBe(true);
		expect(existsSync(join(dirs.agentDir, "models.json"))).toBe(false);
	}, 30_000);
});
