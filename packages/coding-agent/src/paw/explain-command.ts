import { APP_NAME } from "../config.ts";
import { loadDefaultPawRuntimeConfig } from "./config.ts";
import { readPawSessionState } from "./session-store.ts";
import { evaluatePawSandbox } from "./security-policy.ts";
import { detectPawSandboxPrimitives } from "./sandbox-detector.ts";
import { computePawBudgetUtilizationPct } from "./budget-policy.ts";
import { evaluatePawCostLatencyCache } from "./cost-latency-cache.ts";
import { scanPawRepoForSecrets } from "./secret-scanner.ts";
import { detectPawProject } from "./project-detection.ts";

export interface PawExplainParsedArgs {
	sessionId: string | null;
	verbose: boolean;
}

export type PawExplainParseResult =
	| { kind: "help" }
	| { kind: "error"; message: string }
	| { kind: "ok"; args: PawExplainParsedArgs };

export interface PawExplainResult {
	sessionId: string | null;
	currentState: string;
	blockedReason: { code: string; message: string; suggestedAction: string } | null;
	budgetPct: number | null;
	costAdvisory: "PASS" | "WARN" | "KILL" | "N/A";
	detection: {
		packageManager: string;
		language: string;
		monorepo: string;
		hasTypeScript: boolean;
		hasPython: boolean;
		hasTestRunner: string;
	} | null;
	secretScan: { ok: boolean; blocked: boolean; scannedFiles: number; findingCount: number } | null;
	sandbox: { status: string; degraded: boolean; detectedPrimitives: string[] };
	suggestedNext: readonly string[];
}

export function parsePawExplainArgs(args: string[]): PawExplainParseResult {
	if (args.length === 0) {
		return { kind: "help" };
	}
	if (args[0] === "--help" || args[0] === "-h") {
		return { kind: "help" };
	}
	let sessionId: string | null = null;
	let verbose = false;
	for (const arg of args) {
		if (arg === "--verbose" || arg === "-v") verbose = true;
		else if (arg.startsWith("--")) {
			return { kind: "error", message: `Unknown option for "paw explain": ${arg}` };
		} else if (sessionId === null) {
			sessionId = arg;
		} else {
			return { kind: "error", message: `Unexpected positional argument: ${arg}` };
		}
	}
	return { kind: "ok", args: { sessionId, verbose } };
}

export async function runPawExplainCommand(args: string[]): Promise<void> {
	const parsed = parsePawExplainArgs(args);
	if (parsed.kind === "help") {
		printPawExplainHelp();
		return;
	}
	if (parsed.kind === "error") {
		console.error(`Error: ${parsed.message}`);
		process.exitCode = 1;
		return;
	}
	try {
		const result = await createPawExplainResult(parsed.args);
		console.log(formatPawExplainResult(result));
	} catch (error) {
		console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
}

export async function createPawExplainResult(args: PawExplainParsedArgs): Promise<PawExplainResult> {
	const repoRoot = process.cwd();
	const config = loadDefaultPawRuntimeConfig(repoRoot);
	const state = args.sessionId !== null ? await readPawSessionState(repoRoot, args.sessionId).catch(() => null) : null;
	const blockedReason = state?.blocked_reason
		? { code: state.blocked_reason.code, message: state.blocked_reason.message, suggestedAction: state.blocked_reason.suggested_action }
		: null;
	const detection = detectPawProject(repoRoot);
	const secretScan = await scanPawRepoForSecrets(repoRoot, config.secrets);
	const sandboxDecision = evaluatePawSandbox({
		config: config.sandbox,
		availablePrimitives: detectPawSandboxPrimitives({ bubblewrapAvailable: true, landlockAvailable: true, userNamespacesAvailable: true, distro: undefined }).detectedPrimitives,
		riskLevel: "R0",
	});
	const budgetPct = state !== null
		? computePawBudgetUtilizationPct({
			tokensUsed: 0,
			usdUsed: 0,
			maxTokens: config.budget.per_task.standard.max_tokens,
			maxUsd: config.budget.per_task.standard.max_usd,
		})
		: null;
	const costAdvisoryResult = evaluatePawCostLatencyCache({
		metrics: { taskClass: "standard", usdUsed: 0, inputTokens: 0, activeTimeSec: 0, providerClass: "hosted" },
	});
	return {
		sessionId: args.sessionId,
		currentState: state?.name ?? "IDLE",
		blockedReason,
		budgetPct,
		costAdvisory: costAdvisoryResult.cacheAdvisory.status,
		detection: {
			packageManager: detection.packageManager,
			language: detection.language,
			monorepo: detection.monorepo,
			hasTypeScript: detection.hasTypeScript,
			hasPython: detection.hasPython,
			hasTestRunner: detection.hasTestRunner,
		},
		secretScan: { ok: secretScan.ok, blocked: secretScan.blocked, scannedFiles: secretScan.scannedFiles, findingCount: secretScan.findings.length },
		sandbox: { status: sandboxDecision.status, degraded: "degraded" in sandboxDecision ? sandboxDecision.degraded : false, detectedPrimitives: "selectedPrimitive" in sandboxDecision ? [sandboxDecision.selectedPrimitive] : [] },
		suggestedNext: deriveSuggestedNext(args, blockedReason),
	};
}

function deriveSuggestedNext(args: PawExplainParsedArgs, blockedReason: PawExplainResult["blockedReason"]): readonly string[] {
	const next: string[] = [];
	if (blockedReason !== null) {
		next.push(`paw resume ${args.sessionId ?? "<session-id>"}  # ${blockedReason.suggestedAction}`);
	}
	next.push("paw doctor --fix-suggestions  # verify sandbox readiness");
	next.push("paw plan <session-id>  # inspect remaining slices");
	return next;
}

export function formatPawExplainResult(result: PawExplainResult): string {
	const lines = [
		"Paw explain",
		`session: ${result.sessionId ?? "(none)"}`,
		`current state: ${result.currentState}`,
		`budget pct: ${result.budgetPct?.toFixed(1) ?? "n/a"}`,
		`cost advisory: ${result.costAdvisory}`,
	];
	if (result.blockedReason) {
		lines.push(`blocked: ${result.blockedReason.code}: ${result.blockedReason.message}`);
		lines.push(`  suggested: ${result.blockedReason.suggestedAction}`);
	} else {
		lines.push("blocked: none");
	}
	if (result.detection) {
		lines.push(`detection: pm=${result.detection.packageManager} lang=${result.detection.language} monorepo=${result.detection.monorepo} ts=${result.detection.hasTypeScript} py=${result.detection.hasPython} test=${result.detection.hasTestRunner}`);
	}
	if (result.secretScan) {
		lines.push(`secret scan: ok=${result.secretScan.ok} blocked=${result.secretScan.blocked} files=${result.secretScan.scannedFiles} findings=${result.secretScan.findingCount}`);
	}
	lines.push(`sandbox: ${result.sandbox.status} degraded=${result.sandbox.degraded} primitives=${result.sandbox.detectedPrimitives.join(",") || "none"}`);
	lines.push("suggested next:");
	for (const suggestion of result.suggestedNext) {
		lines.push(`  - ${suggestion}`);
	}
	return lines.join("\n");
}

function printPawExplainHelp(): void {
	console.log(`Usage:
  ${APP_NAME} paw explain [<session-id>] [--verbose]

Explain the current Paw state, blocked reason, sandbox, secret scan, and suggested next command.
`);
}
