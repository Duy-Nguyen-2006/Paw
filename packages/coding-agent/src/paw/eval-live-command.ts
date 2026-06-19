import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { APP_NAME } from "../config.ts";
import { createPawBuildCommandResult, type PawBuildCommandResult, type PawBuildParsedInput } from "./build-command.ts";
import { loadDefaultPawRuntimeConfig } from "./config.ts";
import { initializePawProject } from "./persistence.ts";
import { readPawSessionState, readPawVerificationEvidence, writePawSessionState } from "./session-store.ts";
import type { PawSessionStateName } from "./state.ts";

export interface PawEvalLiveParsedInput {
	repos: string[];
	workdir?: string;
	install: boolean;
	keepWorkdir: boolean;
	maxSteps: number;
	handoff?: string;
	matrix?: string;
}

export type PawEvalLiveParsedArgs =
	| { kind: "help" }
	| { kind: "error"; message: string }
	| { kind: "ok"; input: PawEvalLiveParsedInput };

export interface PawEvalLiveCommandInput {
	configSourceRoot?: string;
	commandRunner?: PawEvalLiveCommandRunner;
	buildRunner?: PawEvalLiveBuildRunner;
}

export type PawEvalLiveCommandRunner = (
	input: PawEvalLiveCommandRunnerInput,
) => Promise<PawEvalLiveCommandRunnerResult>;

export interface PawEvalLiveCommandRunnerInput {
	command: string;
	args: string[];
	cwd: string;
	env?: NodeJS.ProcessEnv;
}

export interface PawEvalLiveCommandRunnerResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

export type PawEvalLiveBuildRunner = (
	repoRoot: string,
	sessionId: string,
	input: PawBuildParsedInput,
) => Promise<PawBuildCommandResult>;

export interface PawEvalLiveRepoResult {
	repo: string;
	repoRoot: string;
	sessionId: string;
	finalState: PawSessionStateName | null;
	status: "done" | "done_with_unverified" | "failed";
	verifiedGates: string[];
	unverifiedGates: string[];
	evidenceCount: number;
	commands: readonly string[][];
	error?: string;
}

export interface PawEvalLiveCommandResult {
	status: "completed" | "completed_with_unverified" | "failed";
	workdir: string;
	results: PawEvalLiveRepoResult[];
}

const EVAL_LIVE_SCALAR_OPTIONS = new Set(["--repo", "--workdir", "--max-steps", "--handoff", "--matrix"]);

export function parsePawEvalLiveArgs(args: string[]): PawEvalLiveParsedArgs {
	if (args.some((arg) => arg === "--help" || arg === "-h")) {
		return { kind: "help" };
	}
	const repos: string[] = [];
	let workdir: string | undefined;
	let maxSteps = 6;
	let handoff: string | undefined;
	let matrix: string | undefined;
	let install = false;
	let keepWorkdir = false;
	const seenSingleton = new Set<string>();
	for (let index = 0; index < args.length; ) {
		const arg = args[index];
		if (arg === "--install") {
			install = true;
			index += 1;
			continue;
		}
		if (arg === "--keep-workdir") {
			keepWorkdir = true;
			index += 1;
			continue;
		}
		if (!EVAL_LIVE_SCALAR_OPTIONS.has(arg)) {
			return { kind: "error", message: `Unknown option for "paw eval-live": ${arg}` };
		}
		if (index + 1 >= args.length) {
			return { kind: "error", message: `Missing value for "paw eval-live" option: ${arg}` };
		}
		const value = args[index + 1];
		if (value.trim().length === 0) {
			return { kind: "error", message: `Option ${arg} for "paw eval-live" must be non-empty.` };
		}
		if (arg !== "--repo") {
			if (seenSingleton.has(arg)) {
				return { kind: "error", message: `Duplicate option for "paw eval-live": ${arg}` };
			}
			seenSingleton.add(arg);
		}
		if (arg === "--repo") {
			repos.push(value);
		} else if (arg === "--workdir") {
			workdir = value;
		} else if (arg === "--max-steps") {
			const parsed = Number.parseInt(value, 10);
			if (!Number.isInteger(parsed) || parsed <= 0) {
				return { kind: "error", message: 'Option --max-steps for "paw eval-live" must be a positive integer.' };
			}
			maxSteps = parsed;
		} else if (arg === "--handoff") {
			handoff = value;
		} else if (arg === "--matrix") {
			matrix = value;
		}
		index += 2;
	}
	if (repos.length === 0) {
		return { kind: "error", message: 'Missing required option for "paw eval-live": --repo <url-or-path>' };
	}
	const input: PawEvalLiveParsedInput = { repos, install, keepWorkdir, maxSteps };
	if (workdir !== undefined) input.workdir = workdir;
	if (handoff !== undefined) input.handoff = handoff;
	return { kind: "ok", input };
}

export async function createPawEvalLiveCommandResult(
	input: PawEvalLiveParsedInput,
	commandInput: PawEvalLiveCommandInput = {},
): Promise<PawEvalLiveCommandResult> {
	const workdir = resolve(input.workdir ?? (await mkdtemp(join(tmpdir(), "paw-live-eval-"))));
	await mkdir(workdir, { recursive: true });
	const results: PawEvalLiveRepoResult[] = [];
	try {
		for (const repo of input.repos) {
			results.push(await runOneRepo(workdir, repo, input, commandInput));
		}
	} finally {
		if (!input.keepWorkdir && input.workdir === undefined) {
			await rm(workdir, { recursive: true, force: true });
		}
	}
	const hasFailure = results.some((result) => result.status === "failed");
	const hasUnverified = results.some((result) => result.unverifiedGates.length > 0);
	return {
		status: hasFailure ? "failed" : hasUnverified ? "completed_with_unverified" : "completed",
		workdir,
		results,
	};
}

export function formatPawEvalLiveCommandResult(result: PawEvalLiveCommandResult): string {
	const lines = ["Paw eval-live", `status: ${result.status}`, `workdir: ${result.workdir}`, "repos:"];
	for (const repo of result.results) {
		lines.push(
			`- ${repo.repo}: ${repo.status} state=${repo.finalState ?? "unknown"} verified=${repo.verifiedGates.length} unverified=${repo.unverifiedGates.length} evidence=${repo.evidenceCount}`,
		);
		if (repo.error !== undefined) {
			lines.push(`  error: ${repo.error}`);
		}
		if (repo.unverifiedGates.length > 0) {
			lines.push(`  unverified: ${repo.unverifiedGates.join(", ")}`);
		}
	}
	const scoreboard = computeEvalLiveScoreboard(result);
	lines.push(`scoreboard: pass=${scoreboard.pass} unverified=${scoreboard.unverified} fail=${scoreboard.fail} pass_rate=${scoreboard.passRate.toFixed(2)}%`);
	return lines.join("\n");
}

function computeEvalLiveScoreboard(result: PawEvalLiveCommandResult): { pass: number; unverified: number; fail: number; passRate: number } {
	let pass = 0;
	let unverified = 0;
	let fail = 0;
	for (const repo of result.results) {
		if (repo.status === "done") pass += 1;
		else if (repo.status === "done_with_unverified") unverified += 1;
		else fail += 1;
	}
	const total = result.results.length || 1;
	return { pass, unverified, fail, passRate: ((pass + unverified) / total) * 100 };
}

export async function runPawEvalLiveCommand(args: string[]): Promise<void> {
	const parsed = parsePawEvalLiveArgs(args);
	if (parsed.kind === "help") {
		printPawEvalLiveHelp();
		return;
	}
	if (parsed.kind === "error") {
		console.error(`Error: ${parsed.message}`);
		process.exitCode = 1;
		return;
	}
	try {
		console.log(formatPawEvalLiveCommandResult(await createPawEvalLiveCommandResult(parsed.input)));
	} catch (error) {
		console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
}

async function runOneRepo(
	workdir: string,
	repo: string,
	input: PawEvalLiveParsedInput,
	commandInput: PawEvalLiveCommandInput,
): Promise<PawEvalLiveRepoResult> {
	const runner = commandInput.commandRunner ?? runLocalCommand;
	const buildRunner = commandInput.buildRunner ?? createPawBuildCommandResult;
	const repoRoot = await materializeRepo(workdir, repo, runner);
	const sessionId = `live-${sanitizeSessionSegment(basename(repoRoot))}`;
	try {
		await prepareLiveEvalRepo(repoRoot, commandInput.configSourceRoot ?? process.cwd());
		if (input.install && existsSync(join(repoRoot, "package.json"))) {
			await installLiveEvalDependencies(repoRoot, runner);
		}
		await seedLiveEvalSession(repoRoot, sessionId);
		await buildRunner(repoRoot, sessionId, { once: true });
		await buildRunner(repoRoot, sessionId, { once: true });
		await buildRunner(repoRoot, sessionId, { once: true, handoff: createLiveEvalWorkerHandoff(repo, input.handoff) });
		await buildRunner(repoRoot, sessionId, { once: true, handoff: createLiveEvalReviewerHandoff(repo) });
		await buildRunner(repoRoot, sessionId, { once: true, native: true });
		await buildRunner(repoRoot, sessionId, { maxSteps: input.maxSteps, native: true });
		return await summarizeLiveEvalRepo(repo, repoRoot, sessionId);
	} catch (error) {
		const summary = await summarizeLiveEvalRepo(repo, repoRoot, sessionId).catch(() => null);
		return {
			repo,
			repoRoot,
			sessionId,
			finalState: summary?.finalState ?? null,
			status: "failed",
			verifiedGates: summary?.verifiedGates ?? [],
			unverifiedGates: summary?.unverifiedGates ?? [],
			evidenceCount: summary?.evidenceCount ?? 0,
			commands: summary?.commands ?? [],
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

async function installLiveEvalDependencies(repoRoot: string, runner: PawEvalLiveCommandRunner): Promise<void> {
	const env: NodeJS.ProcessEnv = { ...process.env };
	await runRequiredLiveEvalCommand(runner, { command: "npm", args: ["install"], cwd: repoRoot, env }, "npm install");
	if (existsSync(join(repoRoot, "requirements.txt"))) {
		const venvDir = join(repoRoot, ".venv-paw-eval");
		await runRequiredLiveEvalCommand(
			runner,
			{ command: "python3", args: ["-m", "venv", venvDir], cwd: repoRoot, env },
			"python venv creation",
		);
		const python = join(venvDir, "bin", "python");
		env.PYTHON = python;
		await runRequiredLiveEvalCommand(
			runner,
			{ command: python, args: ["-m", "pip", "install", "-r", "requirements.txt"], cwd: repoRoot, env },
			"pip install -r requirements.txt",
		);
	}
	const scripts = await readPackageScripts(repoRoot);
	if (scripts.has("build:executor")) {
		await runRequiredLiveEvalCommand(
			runner,
			{ command: "npm", args: ["run", "build:executor"], cwd: repoRoot, env },
			"npm run build:executor",
		);
	}
}

async function runRequiredLiveEvalCommand(
	runner: PawEvalLiveCommandRunner,
	input: PawEvalLiveCommandRunnerInput,
	label: string,
): Promise<void> {
	const result = await runner(input);
	if (result.exitCode !== 0) {
		throw new Error(`${label} failed: ${result.stderr || result.stdout}`);
	}
}

async function readPackageScripts(repoRoot: string): Promise<ReadonlySet<string>> {
	try {
		const parsed = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf-8")) as {
			scripts?: Record<string, unknown>;
		};
		return new Set(
			Object.entries(parsed.scripts ?? {})
				.filter(([, value]) => typeof value === "string")
				.map(([key]) => key),
		);
	} catch {
		return new Set();
	}
}

async function materializeRepo(workdir: string, repo: string, runner: PawEvalLiveCommandRunner): Promise<string> {
	if (existsSync(repo)) {
		return resolve(repo);
	}
	const repoName = sanitizeSessionSegment(basename(repo).replace(/\.git$/, ""));
	const repoRoot = join(workdir, repoName);
	await rm(repoRoot, { recursive: true, force: true });
	const cloned = await runner({
		command: "git",
		args: ["clone", "--depth", "1", repo, repoRoot],
		cwd: workdir,
		env: process.env,
	});
	if (cloned.exitCode !== 0) {
		throw new Error(`git clone failed for ${repo}: ${cloned.stderr || cloned.stdout}`);
	}
	return repoRoot;
}

async function prepareLiveEvalRepo(repoRoot: string, configSourceRoot: string): Promise<void> {
	await rm(join(repoRoot, ".paw"), { recursive: true, force: true });
	await rm(join(repoRoot, "paw-spec"), { recursive: true, force: true });
	await mkdir(join(repoRoot, "paw-spec"), { recursive: true });
	await cp(join(configSourceRoot, "paw-spec", "config.yaml"), join(repoRoot, "paw-spec", "config.yaml"));
	await initializePawProject(repoRoot, loadDefaultPawRuntimeConfig(repoRoot));
}

async function seedLiveEvalSession(repoRoot: string, sessionId: string): Promise<void> {
	await writePawSessionState(repoRoot, {
		session_id: sessionId,
		name: "PLAN_APPROVED",
		current_slice_id: null,
		pending_slice_ids: ["live-slice-1"],
		completed_slice_ids: [],
		blocked_reason: null,
	});
}

async function summarizeLiveEvalRepo(
	repo: string,
	repoRoot: string,
	sessionId: string,
): Promise<PawEvalLiveRepoResult> {
	const state = await readPawSessionState(repoRoot, sessionId);
	const evidence = await readPawVerificationEvidence(repoRoot, sessionId);
	const verifiedGates = evidence.filter((result) => result.status === "verified").map((result) => result.gate);
	const unverifiedGates = evidence.filter((result) => result.status === "unverified").map((result) => result.gate);
	return {
		repo,
		repoRoot,
		sessionId,
		finalState: state.name,
		status: unverifiedGates.length > 0 ? "done_with_unverified" : "done",
		verifiedGates,
		unverifiedGates,
		evidenceCount: evidence.length,
		commands: evidence
			.filter(
				(result): result is typeof result & { command: string[] } =>
					result.executed && result.command !== undefined,
			)
			.map((result) => result.command),
	};
}

function createLiveEvalWorkerHandoff(repo: string, override: string | undefined): string {
	return (
		override ??
		`Live E2E on real repository ${repo}. Inspect the repo and return valid Paw JSON. If no safe edit is required, use changed_files []. Do not invent edits.`
	);
}

function createLiveEvalReviewerHandoff(repo: string): string {
	return `Live E2E reviewer pass on real repository ${repo}. Review actual worker output/diff if present and return valid Paw JSON.`;
}

function sanitizeSessionSegment(value: string): string {
	return (
		value
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "repo"
	);
}

function runLocalCommand(input: PawEvalLiveCommandRunnerInput): Promise<PawEvalLiveCommandRunnerResult> {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(input.command, input.args, {
			cwd: input.cwd,
			env: input.env,
			shell: process.platform === "win32",
		});
		let stdout = "";
		let stderr = "";
		child.stdout?.setEncoding("utf-8");
		child.stderr?.setEncoding("utf-8");
		child.stdout?.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr?.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", reject);
		child.on("close", (code) => resolvePromise({ exitCode: code ?? 1, stdout, stderr }));
	});
}

function printPawEvalLiveHelp(): void {
	console.log(`Usage:
  ${APP_NAME} paw eval-live --repo <url-or-path> [--repo <url-or-path>...] [--install] [--workdir <path>] [--keep-workdir] [--matrix <name>]

Run live MiniMax-backed Paw full-slice validation on real repositories.

Matrices:
  smoke   default 3-repo smoke matrix
  full    nightly 10-repo matrix
`);
}
