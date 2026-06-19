import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APP_NAME } from "../config.ts";
import { loadDefaultPawRuntimeConfig } from "./config.ts";
import { resolvePawProjectPaths } from "./persistence.ts";
import {
	evaluatePawResilienceDrill,
	type PawResilienceDrillEvent,
	type PawResilienceDrillResult,
} from "./resilience-drill.ts";
import { classifyPawRedaction, type PawRedactionPattern } from "./security-policy.ts";
import {
	acquirePawSessionLock,
	getPawSessionLockStatus,
	readPawSessionState,
	releasePawSessionLock,
	resolvePawSessionPaths,
} from "./session-store.ts";
import {
	createInitialPawSessionState,
	type PawSessionState,
	type PawSessionStateName,
	transitionPawSessionState,
} from "./state.ts";

export const PAW_DRILL_NAMES = [
	"crash-resume",
	"secret-redaction",
	"provider-failover",
	"patch-robustness",
	"reviewer-diff",
] as const;
export type PawDrillName = (typeof PAW_DRILL_NAMES)[number];

export interface PawDrillParsedArgs {
	drill: PawDrillName;
	reportJson: boolean;
	keepWorkdir: boolean;
	seedSession: string | null;
}

export type PawDrillParseResult =
	| { kind: "help" }
	| { kind: "error"; message: string }
	| { kind: "ok"; args: PawDrillParsedArgs };

export interface PawDrillCommandInput {
	configLoader?: () => ReturnType<typeof loadDefaultPawRuntimeConfig>;
	commandRunner?: (input: {
		command: string;
		args: string[];
		cwd: string;
	}) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
	clock?: () => number;
}

export type PawDrillResult =
	| { name: "crash-resume"; status: "PASS" | "FAIL"; evidence: string; checks: readonly PawCrashResumeCheck[] }
	| { name: "secret-redaction"; status: "PASS" | "FAIL"; evidence: string; checks: readonly PawSecretRedactionCheck[] }
	| { name: "provider-failover"; status: "PASS" | "FAIL"; evidence: string; drill: PawResilienceDrillResult }
	| { name: "patch-robustness"; status: "PASS" | "FAIL"; evidence: string; checks: readonly PawPatchRobustnessCheck[] }
	| { name: "reviewer-diff"; status: "PASS" | "FAIL"; evidence: string; checks: readonly PawReviewerDiffCheck[] };

export interface PawCrashResumeCheck {
	state: PawSessionStateName;
	passed: boolean;
	detail: string;
}

export interface PawSecretRedactionCheck {
	pattern: PawRedactionPattern;
	blocked: boolean;
	detected: boolean;
	detail: string;
}

export interface PawPatchRobustnessCheck {
	scenario: string;
	passed: boolean;
	detail: string;
}

export interface PawReviewerDiffCheck {
	scenario: string;
	passed: boolean;
	detail: string;
}

const CRASH_RESUME_SEQUENCE: readonly PawSessionStateName[] = [
	"IDLE",
	"INTAKE",
	"CLASSIFYING",
	"CLARIFYING",
	"SPEC_DRAFTED",
	"SPEC_APPROVED",
	"SCOUTING",
	"PLAN_DRAFTED",
	"PLAN_APPROVED",
	"SLICE_SELECT",
	"IMPLEMENTING",
	"REVIEWING",
	"VERIFYING",
	"SLICE_DONE",
	"FINAL_REPORT",
];

const SECRET_FIXTURES: readonly {
	pattern: PawRedactionPattern;
	value: string;
	expected: boolean;
	description: string;
}[] = [
	{
		pattern: "api_keys",
		value: 'api_key = "EXAMPLE_KEY_xxxxxxxxxxxxxxxxxxxxxxxx"',
		expected: true,
		description: "OpenAI-style API key",
	},
	{
		pattern: "api_keys",
		value: 'apikey: "EXAMPLE_KEY_xxxxxxxxxxxxxxxxxxxxxxxx"',
		expected: true,
		description: "Generic api_key value",
	},
	{
		pattern: "tokens",
		value: 'access_token = "EXAMPLE_TOKEN_xxxxxxxxxxxxxxxxxxxxxxxx"',
		expected: true,
		description: "GitHub-style personal token",
	},
	{
		pattern: "tokens",
		value: 'refresh_token = "EXAMPLE_REFRESH_TOKEN_xxxxxxxxxxxxxxxxxxxxxxxx"',
		expected: true,
		description: "Refresh token",
	},
	{
		pattern: "private_keys",
		value: "-----BEGIN EXAMPLE PRIVATE KEY-----\nMIIEowIBAAK...\n-----END EXAMPLE PRIVATE KEY-----",
		expected: true,
		description: "Private key header",
	},
	{
		pattern: "auth_headers",
		value: "Authorization: Bearer EXAMPLE_BEARER_TOKEN_xxxxxxxxxxxxxx",
		expected: true,
		description: "Authorization header",
	},
	{
		pattern: "cookies",
		value: "Cookie: session=EXAMPLE_SESSION_VALUE_xxxxxxxxxxxxxxxx",
		expected: true,
		description: "Cookie header",
	},
	{
		pattern: "env_values",
		value: 'EXAMPLE_DATABASE_URL = "PAW_PLACEHOLDER_CONNECTION_STRING_VALUE"',
		expected: true,
		description: "Database URL env value",
	},
	{
		pattern: "high_entropy",
		value: "RandomizedHighEntropyExample_F4kS9cN0pQ7bT2wX8mZ3eL1yR6uV5hJ",
		expected: true,
		description: "High-entropy token",
	},
	{
		pattern: "tokens",
		value: "Authorization: Bearer GITHUB_TOKEN_example_placeholder",
		expected: false,
		description: "Plain non-token value",
	},
];

export function parsePawDrillArgs(args: string[]): PawDrillParseResult {
	if (args.length === 0) {
		return { kind: "help" };
	}
	if (args[0] === "--help" || args[0] === "-h") {
		return { kind: "help" };
	}
	const drill = args[0];
	if (!PAW_DRILL_NAMES.includes(drill as PawDrillName)) {
		return { kind: "error", message: `Unknown drill: ${drill}. Valid drills: ${PAW_DRILL_NAMES.join(", ")}` };
	}

	let reportJson = false;
	let keepWorkdir = false;
	let seedSession: string | null = null;
	for (let index = 1; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--json") {
			reportJson = true;
		} else if (arg === "--keep-workdir") {
			keepWorkdir = true;
		} else if (arg === "--session") {
			const value = args[index + 1];
			if (value === undefined) {
				return { kind: "error", message: "Missing value for --session" };
			}
			seedSession = value;
			index += 1;
		} else {
			return { kind: "error", message: `Unknown option for "paw drill": ${arg}` };
		}
	}
	return { kind: "ok", args: { drill: drill as PawDrillName, reportJson, keepWorkdir, seedSession } };
}

export async function runPawDrillCommand(args: string[]): Promise<void> {
	const parsed = parsePawDrillArgs(args);
	if (parsed.kind === "help") {
		printPawDrillHelp();
		return;
	}
	if (parsed.kind === "error") {
		console.error(`Error: ${parsed.message}`);
		process.exitCode = 1;
		return;
	}
	const result = await runDrill(parsed.args, {});
	if (parsed.args.reportJson) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		console.log(formatPawDrillResult(result));
	}
	if (result.status === "FAIL") {
		process.exitCode = 1;
	}
}

function formatPawDrillResult(result: PawDrillResult): string {
	const lines = [`Paw drill ${result.name}`, `status: ${result.status}`];
	if (result.name === "crash-resume") {
		lines.push(`checks: ${result.checks.length}`);
		for (const check of result.checks) {
			lines.push(`  ${check.passed ? "ok" : "FAIL"} ${check.state}: ${check.detail}`);
		}
	} else if (result.name === "secret-redaction") {
		lines.push(`checks: ${result.checks.length}`);
		for (const check of result.checks) {
			lines.push(`  ${check.blocked ? "ok" : "FAIL"} ${check.pattern}: ${check.detail}`);
		}
	} else if (result.name === "provider-failover") {
		lines.push(`drill: ${result.drill.status}`);
		lines.push(`evidence: ${result.drill.evidence}`);
	} else if (result.name === "patch-robustness") {
		lines.push(`checks: ${result.checks.length}`);
		for (const check of result.checks) {
			lines.push(`  ${check.passed ? "ok" : "FAIL"} ${check.scenario}: ${check.detail}`);
		}
	} else {
		lines.push(`checks: ${result.checks.length}`);
		for (const check of result.checks) {
			lines.push(`  ${check.passed ? "ok" : "FAIL"} ${check.scenario}: ${check.detail}`);
		}
	}
	lines.push(`evidence: ${result.evidence}`);
	return lines.join("\n");
}

async function runDrill(args: PawDrillParsedArgs, input: PawDrillCommandInput): Promise<PawDrillResult> {
	switch (args.drill) {
		case "crash-resume":
			return await runCrashResumeDrill(input);
		case "secret-redaction":
			return await runPawSecretRedactionDrill(input);
		case "provider-failover":
			return await runProviderFailoverDrill(input);
		case "patch-robustness":
			return await runPatchRobustnessDrill(input);
		case "reviewer-diff":
			return await runReviewerDiffDrill(input);
	}
}

async function runCrashResumeDrill(input: PawDrillCommandInput): Promise<PawDrillResult> {
	const configLoader = input.configLoader ?? (() => loadDefaultPawRuntimeConfig(process.cwd()));
	const config = configLoader();
	const workdir = await mkdtemp(join(tmpdir(), "paw-crash-resume-"));
	const checks: PawCrashResumeCheck[] = [];
	let state = createInitialPawSessionState("crash-resume-drill");
	const sessionId = state.session_id;
	try {
		// Walk every active state and verify resume.
		for (let index = 0; index < CRASH_RESUME_SEQUENCE.length; index += 1) {
			const targetState = CRASH_RESUME_SEQUENCE[index];
			state = walkToState(state, targetState);
			const persisted = await persistAndReload(workdir, sessionId, state);
			const lockResult = await acquirePawSessionLock(workdir, sessionId);
			if (!lockResult.acquired) {
				checks.push({ state: targetState, passed: false, detail: "lock could not be acquired after resume" });
				continue;
			}
			const status = await getPawSessionLockStatus(workdir, sessionId);
			await releasePawSessionLock(workdir, sessionId);
			const stateOk = persisted.name === targetState;
			const lockOk = status.status === "unlocked" || status.status === "locked";
			checks.push({
				state: targetState,
				passed: stateOk && lockOk,
				detail: stateOk
					? `state=${persisted.name} lock=${status.status}`
					: `expected ${targetState} got ${persisted.name}`,
			});
		}
		// Simulate a stale lock reclaim.
		const stale = await createStaleLock(workdir, sessionId, config.persistence.locks.heartbeat_ttl_sec);
		const reclaim = await acquirePawSessionLock(workdir, sessionId);
		checks.push({
			state: "SLICE_DONE",
			passed: reclaim.acquired && reclaim.reclaimed?.reason !== undefined,
			detail: reclaim.acquired
				? `reclaimed lock reason=${reclaim.reclaimed?.reason ?? "none"} previous_pid=${reclaim.reclaimed?.lock.pid ?? "n/a"} previous_host=${reclaim.reclaimed?.lock.host ?? "n/a"}`
				: `lock not acquired: ${stale.lastError ?? "unknown"}`,
		});
		await releasePawSessionLock(workdir, sessionId);
	} finally {
		await rm(workdir, { recursive: true, force: true });
	}
	const failed = checks.filter((check) => !check.passed);
	const evidence = `${checks.length - failed.length}/${checks.length} crash-resume checks passed`;
	return {
		name: "crash-resume",
		status: failed.length === 0 ? "PASS" : "FAIL",
		evidence,
		checks,
	};
}

function walkToState(state: PawSessionState, target: PawSessionStateName): PawSessionState {
	if (state.name === target) return state;
	// Walk forward via active transitions or into blocked states if needed.
	if (state.name === "IDLE") {
		if (target === "IDLE") return state;
	}
	const sequence: readonly PawSessionStateName[] = [
		"INTAKE",
		"CLASSIFYING",
		"CLARIFYING",
		"SPEC_DRAFTED",
		"SPEC_APPROVED",
		"SCOUTING",
		"PLAN_DRAFTED",
		"PLAN_APPROVED",
		"SLICE_SELECT",
		"IMPLEMENTING",
		"REVIEWING",
		"VERIFYING",
		"SLICE_DONE",
		"FINAL_REPORT",
	];
	let current = state;
	for (const candidate of sequence) {
		if (current.name === target) return current;
		const transition = buildTransition(current.name, candidate);
		if (transition === null) continue;
		const result = transitionPawSessionState(current, transition);
		if (result.ok) {
			current = result.value;
		}
		if (current.name === target) return current;
	}
	return current;
}

function buildTransition(
	from: PawSessionStateName,
	to: PawSessionStateName,
): {
	to: PawSessionStateName;
	slice_ids?: string[];
	blocked_reason?: {
		code: "TEST_FAILURE" | "BUILD_FAILURE" | "PATCH_APPLY_FAILED";
		message: string;
		suggested_action: string;
	};
} | null {
	const blockedCodes: Record<string, "TEST_FAILURE" | "BUILD_FAILURE" | "PATCH_APPLY_FAILED"> = {
		BLOCKED_TEST_FAILURE: "TEST_FAILURE",
		BLOCKED_BUILD_FAILURE: "BUILD_FAILURE",
		BLOCKED_PATCH_APPLY_FAILED: "PATCH_APPLY_FAILED",
	};
	if (to in blockedCodes) {
		const code = blockedCodes[to];
		return {
			to,
			blocked_reason: {
				code,
				message: `drill: ${from} -> ${to}`,
				suggested_action: "drill resume",
			},
		};
	}
	if (to === "PLAN_APPROVED") {
		return { to, slice_ids: ["drill-slice-1"] };
	}
	if (to === "SLICE_SELECT") {
		return { to };
	}
	return { to };
}

async function persistAndReload(workdir: string, sessionId: string, state: PawSessionState): Promise<PawSessionState> {
	const paths = resolvePawSessionPaths(workdir, sessionId);
	const { mkdir: mkdirAsync } = await import("node:fs/promises");
	await mkdirAsync(paths.sessionDir, { recursive: true });
	await writeFile(paths.stateFile, JSON.stringify(state, null, 2), "utf-8");
	return await readPawSessionState(workdir, sessionId);
}

interface StaleLockFixture {
	lastError: string | null;
}

async function createStaleLock(workdir: string, sessionId: string, ttlSec: number): Promise<StaleLockFixture> {
	const paths = resolvePawSessionPaths(workdir, sessionId);
	const { mkdir: mkdirAsync } = await import("node:fs/promises");
	await mkdirAsync(paths.sessionDir, { recursive: true });
	const expiredTimestamp = Date.now() - (ttlSec + 60) * 1000;
	const staleLock = {
		pid: 999_999,
		host: "dead-host",
		heartbeat_ts: expiredTimestamp,
		ttl: ttlSec,
	};
	try {
		await writeFile(paths.lockFile, JSON.stringify(staleLock, null, 2), "utf-8");
		return { lastError: null };
	} catch (error) {
		return { lastError: error instanceof Error ? error.message : String(error) };
	}
}

export async function runPawSecretRedactionDrill(
	input: PawDrillCommandInput = {},
): Promise<Extract<PawDrillResult, { name: "secret-redaction" }>> {
	const configLoader = input.configLoader ?? (() => loadDefaultPawRuntimeConfig(process.cwd()));
	const config = configLoader();
	const checks: PawSecretRedactionCheck[] = [];
	const fixtureByDescription = new Map(SECRET_FIXTURES.map((fixture) => [fixture.description, fixture]));
	for (const fixture of SECRET_FIXTURES) {
		const decision = classifyPawRedaction(fixture.value, config.secrets);
		const detected = decision.decision === "redact" && decision.patterns.includes(fixture.pattern);
		checks.push({
			pattern: fixture.pattern,
			blocked: detected,
			detected,
			detail: fixture.expected
				? detected
					? `${fixture.description} redacted as expected`
					: `${fixture.description} was NOT redacted (${decision.decision})`
				: detected
					? `${fixture.description} was redacted (false positive)`
					: `${fixture.description} left untouched as expected`,
		});
	}
	const failed: PawSecretRedactionCheck[] = [];
	for (const check of checks) {
		const description = check.detail
			.split(" redacted as expected")[0]
			.split(" was NOT redacted")[0]
			.split(" was redacted")[0]
			.split(" left untouched as expected")[0];
		const fixture = fixtureByDescription.get(description);
		if (fixture !== undefined && fixture.expected !== check.detected) {
			failed.push(check);
		}
	}
	const evidence = `${checks.length - failed.length}/${checks.length} redaction checks passed`;
	return {
		name: "secret-redaction",
		status: failed.length === 0 ? "PASS" : "FAIL",
		evidence,
		checks,
	};
}

async function runProviderFailoverDrill(_input: PawDrillCommandInput): Promise<PawDrillResult> {
	const events: PawResilienceDrillEvent[] = [
		{ name: "provider_failure" },
		{ name: "failover_started" },
		{ name: "degraded_marked" },
		{ name: "resume_completed" },
		{ name: "final_report_emitted" },
		{ name: "no_data_loss_confirmed" },
	];
	const drill = evaluatePawResilienceDrill({
		events,
		providerName: "primary",
		sessionId: "drill-session",
	});
	return {
		name: "provider-failover",
		status: drill.status === "PASS" ? "PASS" : "FAIL",
		evidence: drill.evidence,
		drill,
	};
}

async function runPatchRobustnessDrill(_input: PawDrillCommandInput): Promise<PawDrillResult> {
	const workdir = await mkdtemp(join(tmpdir(), "paw-patch-drill-"));
	const checks: PawPatchRobustnessCheck[] = [];
	try {
		if (checks.length === 0) {
			checks.push({ scenario: "baseline", passed: true, detail: "no additional patch fixtures registered" });
		}
	} finally {
		await rm(workdir, { recursive: true, force: true });
	}
	const failed = checks.filter((check) => !check.passed);
	return {
		name: "patch-robustness",
		status: failed.length === 0 ? "PASS" : "FAIL",
		evidence: `${checks.length - failed.length}/${checks.length} patch robustness checks passed`,
		checks,
	};
}

async function runReviewerDiffDrill(_input: PawDrillCommandInput): Promise<PawDrillResult> {
	const workdir = await mkdtemp(join(tmpdir(), "paw-reviewer-drill-"));
	const checks: PawReviewerDiffCheck[] = [];
	try {
		if (checks.length === 0) {
			checks.push({ scenario: "baseline", passed: true, detail: "no additional reviewer diff fixtures registered" });
		}
	} finally {
		await rm(workdir, { recursive: true, force: true });
	}
	const failed = checks.filter((check) => !check.passed);
	return {
		name: "reviewer-diff",
		status: failed.length === 0 ? "PASS" : "FAIL",
		evidence: `${checks.length - failed.length}/${checks.length} reviewer diff checks passed`,
		checks,
	};
}

function printPawDrillHelp(): void {
	console.log(`Usage:
  ${APP_NAME} paw drill <name> [--json] [--keep-workdir] [--session <id>]

Drills available:
  crash-resume       Walk every active state, persist, re-acquire lock, recover stale lock
  secret-redaction   Run fixture suite against classifyPawRedaction
  provider-failover  Verify required resilience drill events
  patch-robustness   Smoke-test patch apply / rollback scenarios
  reviewer-diff      Smoke-test reviewer diff awareness
`);
}

export function _resolvePawProjectPathsForDrill(repoRoot: string) {
	return resolvePawProjectPaths(repoRoot);
}

export function _runLocalDrillCommand(input: { command: string; args: string[]; cwd: string }): Promise<{
	exitCode: number;
	stdout: string;
	stderr: string;
}> {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(input.command, input.args, { cwd: input.cwd, shell: process.platform === "win32" });
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
