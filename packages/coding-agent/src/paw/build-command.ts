import { APP_NAME } from "../config.ts";
import { AuthStorage } from "../core/auth-storage.ts";
import { ModelRegistry } from "../core/model-registry.ts";
import { loadDefaultPawRuntimeConfig } from "./config.ts";
import type { PawRuntimeConfig, PawValidationIssue } from "./contracts.ts";
import { emitPawFinalReport } from "./final-report-emission.ts";
import { resolvePawModelRoute } from "./model-routing.ts";
import type { PawVerifyGateDecision } from "./resilience-policy.ts";
import { type PawReviewerOnceResult, runPawReviewerOnce } from "./reviewer-orchestrator.ts";
import { acquirePawSessionLock, readPawSessionState, releasePawSessionLock } from "./session-store.ts";
import {
	createPawBeginImplementationCommandResult,
	type PawBeginImplementationCommandResult,
} from "./slice-implementation-command.ts";
import { createPawSelectSliceCommandResult, type PawSelectSliceCommandResult } from "./slice-selection-command.ts";
import type { PawSessionStateName } from "./state.ts";
import {
	createPawProviderSubAgentRuntimeExecutor,
	type PawProviderSubAgentRuntimeExecutorInput,
	type PawSubAgentRuntimeExecutor,
	type PawSubAgentRuntimeInvocation,
} from "./subagent-runtime.ts";
import type { PawSubAgentSandboxPreflightInput } from "./subagent-sandbox-preflight.ts";
import {
	createPawNativeVerificationCommandPolicy,
	createPawPolicyCheckedNativeVerificationExecutor,
} from "./verification-command-policy.ts";
import { createPawNativeSubprocessExecutor } from "./verification-executor.ts";
import { createPawNativeVerificationPlan, type PawNativeVerificationPlanEntry } from "./verification-plan.ts";
import type { PawNativeVerificationExecutor, PawNativeVerificationRunResult } from "./verification-runner.ts";
import { createPawVerifyCommandResult, type PawVerifyCommandResult } from "./verify-command.ts";
import { type PawWorkerOnceResult, runPawWorkerOnce } from "./worker-orchestrator.ts";

export type PawBuildStepResult =
	| PawWorkerOnceResult
	| PawReviewerOnceResult
	| PawVerifyCommandResult
	| PawSelectSliceCommandResult
	| PawBeginImplementationCommandResult;

export type PawBuildCommandResult = PawBuildStepResult | PawBuildLoopResult;

export interface PawBuildLoopResult {
	status: "loop_completed" | "loop_stopped" | "max_steps_reached";
	sessionId: string;
	stepsRun: number;
	maxSteps: number;
	stopReason: PawBuildLoopStopReason;
	finalStateName: PawSessionStateName | null;
	stepResults: readonly PawBuildStepResult[];
	finalReport: PawBuildLoopFinalReport | null;
}

export type PawBuildLoopFinalReport =
	| {
			status: "completed";
			reportStatus: "done" | "done_with_unverified";
			summaryFile: string;
			reportJsonFile: string;
			lockReleased: boolean;
	  }
	| {
			status: "failed";
			reason: string;
			lockReleased: boolean;
	  };

export type PawBuildLoopStopReason =
	| "no_pending_slices"
	| "blocked"
	| "failed"
	| "locked"
	| "missing_project"
	| "missing_session"
	| "max_steps_reached";

export interface PawBuildCommandInput {
	config?: PawRuntimeConfig;
	executor?: PawSubAgentRuntimeExecutor;
	providerExecutor?: PawProviderSubAgentRuntimeExecutorInput;
	lockOptions?: Parameters<typeof runPawWorkerOnce>[0]["lockOptions"];
	nativeVerificationExecutor?: PawNativeVerificationExecutor;
	sandboxPreflight?: PawSubAgentSandboxPreflightInput;
}

export type PawBuildParsedInput =
	| {
			once: true;
			handoff?: string;
			timestamp?: string;
			native?: boolean;
	  }
	| {
			maxSteps: number;
			handoff?: string;
			timestamp?: string;
			native?: boolean;
	  };

export type PawBuildParsedArgs =
	| { kind: "help" }
	| { kind: "error"; message: string }
	| { kind: "ok"; sessionId: string; input: PawBuildParsedInput };

const BUILD_SCALAR_OPTIONS = new Set(["--handoff", "--timestamp", "--max-steps"]);

export function parsePawBuildArgs(args: string[]): PawBuildParsedArgs {
	if (args.includes("--help") || args.includes("-h")) {
		return { kind: "help" };
	}

	if (args.length === 0) {
		return { kind: "error", message: 'Missing required session id for "paw build".' };
	}

	const sessionId = args[0];
	if (sessionId.startsWith("-")) {
		return { kind: "error", message: 'Missing required session id for "paw build".' };
	}

	let once = false;
	let native = false;
	let maxSteps: number | undefined;
	let handoff: string | undefined;
	let timestamp: string | undefined;
	const seenScalarOptions = new Set<string>();

	for (let index = 1; index < args.length; ) {
		const arg = args[index];

		if (arg === "--once") {
			if (once) {
				return { kind: "error", message: 'Duplicate option for "paw build": --once' };
			}
			once = true;
			index += 1;
			continue;
		}

		if (arg === "--native") {
			if (native) {
				return { kind: "error", message: 'Duplicate option for "paw build": --native' };
			}
			native = true;
			index += 1;
			continue;
		}

		if (BUILD_SCALAR_OPTIONS.has(arg)) {
			if (seenScalarOptions.has(arg)) {
				return { kind: "error", message: `Duplicate option for "paw build": ${arg}` };
			}
			seenScalarOptions.add(arg);
			if (index + 1 >= args.length) {
				return { kind: "error", message: `Missing value for "paw build" option: ${arg}` };
			}
			const value = args[index + 1];
			if (value.trim().length === 0) {
				return { kind: "error", message: `Option ${arg} for "paw build" must be a non-empty string.` };
			}
			if (arg === "--handoff") {
				handoff = value;
			} else if (arg === "--timestamp") {
				timestamp = value;
			} else if (arg === "--max-steps") {
				const parsedMaxSteps = parsePawBuildMaxSteps(value);
				if (typeof parsedMaxSteps === "string") {
					return { kind: "error", message: parsedMaxSteps };
				}
				maxSteps = parsedMaxSteps;
			}
			index += 2;
			continue;
		}

		if (arg.startsWith("-")) {
			return { kind: "error", message: `Unknown option for "paw build": ${arg}` };
		}

		return { kind: "error", message: `Unknown option for "paw build": ${arg}` };
	}

	if (once && maxSteps !== undefined) {
		return { kind: "error", message: 'Options for "paw build" are mutually exclusive: --once and --max-steps' };
	}

	if (!once && maxSteps === undefined) {
		return { kind: "error", message: 'Missing required option for "paw build": --once or --max-steps <n>' };
	}

	if (timestamp !== undefined) {
		const timestampError = validatePawBuildTimestamp(timestamp);
		if (timestampError !== undefined) {
			return { kind: "error", message: timestampError };
		}
	}

	const input: PawBuildParsedInput = once ? { once } : { maxSteps: maxSteps ?? 1 };
	if (handoff !== undefined) {
		input.handoff = handoff;
	}
	if (timestamp !== undefined) {
		input.timestamp = timestamp;
	}
	if (native) {
		input.native = true;
	}
	return { kind: "ok", sessionId, input };
}

export async function createPawBuildCommandResult(
	repoRoot: string,
	sessionId: string,
	input: PawBuildParsedInput,
	commandInput: PawBuildCommandInput = {},
): Promise<PawBuildCommandResult> {
	if (isPawBuildLoopInput(input)) {
		return createPawBuildLoopResult(repoRoot, sessionId, input, commandInput);
	}

	return createPawBuildStepResult(repoRoot, sessionId, input, commandInput);
}

async function createPawBuildStepResult(
	repoRoot: string,
	sessionId: string,
	input: Extract<PawBuildParsedInput, { once: true }>,
	commandInput: PawBuildCommandInput = {},
): Promise<PawBuildStepResult> {
	const config = commandInput.config ?? loadDefaultPawRuntimeConfig(repoRoot);
	const executor = resolvePawBuildSubAgentExecutor(commandInput, config);
	const state = await readPawSessionStateIfExists(repoRoot, sessionId);
	if (stateNameCanSelectSlice(state)) {
		return createPawSelectSliceCommandResult(repoRoot, sessionId, { lockOptions: commandInput.lockOptions });
	}

	if (stateNameCanBeginImplementation(state)) {
		return createPawBeginImplementationCommandResult(repoRoot, sessionId, { lockOptions: commandInput.lockOptions });
	}

	if (stateNameIsReviewing(state)) {
		return runPawReviewerOnce({
			repoRoot,
			sessionId,
			config,
			executor,
			handoff: input.handoff,
			lockOptions: commandInput.lockOptions,
			sandboxPreflight: commandInput.sandboxPreflight,
		});
	}

	if (stateNameIsVerifying(state)) {
		return createPawVerifyCommandResult(repoRoot, sessionId, {
			lockOptions: commandInput.lockOptions,
			nativeVerificationExecutor: resolvePawBuildNativeVerificationExecutor(repoRoot, config, input, commandInput),
		});
	}

	return runPawWorkerOnce({
		repoRoot,
		sessionId,
		config,
		executor,
		handoff: input.handoff,
		lockOptions: commandInput.lockOptions,
		sandboxPreflight: commandInput.sandboxPreflight,
		timestamp: input.timestamp,
	});
}

async function createPawBuildLoopResult(
	repoRoot: string,
	sessionId: string,
	input: Extract<PawBuildParsedInput, { maxSteps: number }>,
	commandInput: PawBuildCommandInput = {},
): Promise<PawBuildLoopResult> {
	const stepResults: PawBuildStepResult[] = [];
	let finalStateName: PawSessionStateName | null = null;

	for (let stepIndex = 0; stepIndex < input.maxSteps; stepIndex += 1) {
		const stepResult = await createPawBuildStepResult(
			repoRoot,
			sessionId,
			{ once: true, handoff: input.handoff, timestamp: input.timestamp, native: input.native },
			commandInput,
		);
		stepResults.push(stepResult);
		finalStateName = await readPawSessionStateNameIfExists(repoRoot, sessionId);

		const stopReason = getPawBuildLoopStopReason(stepResult);
		if (stopReason !== null) {
			const finalReport =
				stopReason === "no_pending_slices"
					? await emitPawBuildLoopFinalReport(repoRoot, sessionId, input.maxSteps, stepResults, commandInput)
					: null;
			finalStateName = await readPawSessionStateNameIfExists(repoRoot, sessionId);
			return {
				status:
					stopReason === "no_pending_slices" && finalReport?.status === "completed"
						? "loop_completed"
						: "loop_stopped",
				sessionId,
				stepsRun: stepResults.length,
				maxSteps: input.maxSteps,
				stopReason,
				finalStateName,
				stepResults,
				finalReport,
			};
		}
	}

	return {
		status: "max_steps_reached",
		sessionId,
		stepsRun: stepResults.length,
		maxSteps: input.maxSteps,
		stopReason: "max_steps_reached",
		finalStateName,
		stepResults,
		finalReport: null,
	};
}

async function emitPawBuildLoopFinalReport(
	repoRoot: string,
	sessionId: string,
	maxSteps: number,
	stepResults: readonly PawBuildStepResult[],
	commandInput: PawBuildCommandInput,
): Promise<PawBuildLoopFinalReport> {
	const lockResult = await acquirePawSessionLock(repoRoot, sessionId, commandInput.lockOptions);
	if (!lockResult.acquired) {
		return { status: "failed", reason: "locked", lockReleased: false };
	}

	let lockReleased = false;
	try {
		const verifyDecisions = collectPawBuildLoopVerifyDecisions(stepResults);
		const emission = await emitPawFinalReport({
			repoRoot,
			sessionId,
			reportInput: {
				summary: `Paw build completed ${stepResults.length} step(s) within max ${maxSteps}.`,
				evidence: [`steps_run=${stepResults.length}`, `max_steps=${maxSteps}`, "stop_reason=no_pending_slices"],
				verifyDecisions,
			},
			lockOptions: commandInput.lockOptions,
		});
		lockReleased = await releasePawSessionLock(repoRoot, sessionId, commandInput.lockOptions);
		if (emission.status === "completed") {
			return {
				status: "completed",
				reportStatus: emission.report.status,
				summaryFile: emission.summaryFile,
				reportJsonFile: emission.reportJsonFile,
				lockReleased,
			};
		}
		return { status: "failed", reason: emission.status, lockReleased };
	} catch (error) {
		if (!lockReleased) {
			await releasePawSessionLock(repoRoot, sessionId, commandInput.lockOptions);
		}
		throw error;
	}
}

export function formatPawBuildCommandResult(result: PawBuildCommandResult): string {
	if (isPawBuildLoopResult(result)) {
		const lines = [
			"Paw build",
			`session: ${result.sessionId}`,
			`status: ${result.status}`,
			`steps run: ${result.stepsRun}`,
			`max steps: ${result.maxSteps}`,
			`stop reason: ${result.stopReason}`,
			`final state: ${result.finalStateName ?? "unknown"}`,
		];
		if (result.finalReport?.status === "completed") {
			lines.push(
				`final report: ${result.finalReport.reportStatus}`,
				`summary file: ${result.finalReport.summaryFile}`,
				`report json file: ${result.finalReport.reportJsonFile}`,
			);
		}
		return lines.join("\n");
	}

	if (isPawBuildVerifyCompletedResult(result)) {
		return [
			"Paw build",
			`session: ${result.sessionId}`,
			`status: ${result.status}`,
			`state: ${result.previousStateName} -> ${result.nextStateName}`,
			`slice: ${result.currentSliceId}`,
			`planned native gates: ${formatPlannedGateNames(result.nativeVerificationPlan)}`,
			`native executed gates: ${formatNativeExecutedGateNames(result.nativeVerificationRunResults)}`,
			`verified gates: ${formatGateNames(result.verifyDecisions.filter((decision) => decision.status === "verified"))}`,
			`unverified gates: ${formatGateNames(result.unverifiedDecisions)}`,
			`lock released: ${result.lockReleased ? "yes" : "no"}`,
		].join("\n");
	}

	switch (result.status) {
		case "advanced":
			return [
				"Paw build",
				`session: ${result.sessionId}`,
				`status: ${result.status}`,
				`selected slice: ${result.selectedSliceId}`,
				`state: ${result.previousStateName} -> ${result.nextStateName}`,
				`lock released: ${result.lockReleased ? "yes" : "no"}`,
			].join("\n");
		case "no_pending_slices":
			return [
				"Paw build",
				`session: ${result.sessionId}`,
				`status: ${result.status}`,
				`state: ${result.previousStateName}`,
				`lock released: ${result.lockReleased ? "yes" : "no"}`,
			].join("\n");
		case "completed":
			return [
				"Paw build",
				`session: ${result.sessionId}`,
				`status: ${result.status}`,
				`selected slice: ${result.selectedSliceId}`,
				`state: ${result.previousStateName} -> ${result.nextStateName}`,
				`attempts: ${result.attempts}`,
				`journal entries: ${result.journalEntryCount}`,
				`lock released: ${result.lockReleased ? "yes" : "no"}`,
			].join("\n");
		case "blocked":
			return [
				"Paw build",
				`session: ${result.sessionId}`,
				`status: ${result.status}`,
				`selected slice: ${result.selectedSliceId}`,
				`state: ${result.previousStateName} -> ${result.nextStateName}`,
				`attempts: ${result.attempts}`,
				`blocked reason: ${result.blockedReasonCode}: ${result.blockedReasonMessage}`,
				`lock released: ${result.lockReleased ? "yes" : "no"}`,
			].join("\n");
		case "worker_failed":
			return `Cannot build session ${result.sessionId}: worker output status is ${result.workerStatus}, expected pass, blocked, or needs_user_decision.`;
		case "reviewer_failed":
			return `Cannot build session ${result.sessionId}: reviewer output status is ${result.reviewerStatus}, expected pass, blocked, or needs_user_decision.`;
		case "invalid_state":
			return `Cannot build session ${result.sessionId} from ${result.previousStateName}: ${formatIssues(result.issues)}`;
		case "no_selected_slice":
			return "issues" in result
				? `Cannot build session ${result.sessionId}: ${formatIssues(result.issues)}`
				: `Cannot build session ${result.sessionId}: no selected slice in ${result.previousStateName}.`;
		case "invalid_worker_output":
			return `Cannot build session ${result.sessionId}: ${formatIssues(result.issues)}`;
		case "invalid_reviewer_output":
			return `Cannot build session ${result.sessionId}: ${formatIssues(result.issues)}`;
		case "invalid_verification":
			return `Cannot build session ${result.sessionId}: ${formatIssues(result.issues)}`;
		case "invalid_blocked_reason":
			return `Cannot build session ${result.sessionId}: ${formatIssues(result.issues)}`;
		case "invalid_transition":
			return `Cannot build session ${result.sessionId} from ${result.previousStateName}: ${formatIssues(result.issues)}`;
		case "missing_project":
			return `Paw is not initialized at ${result.pawDir}. Run \`${APP_NAME} paw init\`.`;
		case "missing_session":
			return `No Paw session state found for ${result.sessionId} at ${result.stateFile}.`;
		case "locked":
			return `Paw session ${result.sessionId} is locked by pid ${result.lock.pid} on ${result.lock.host}.`;
		case "not_locked":
			return "reason" in result && result.reason === "stale"
				? `Cannot build session ${result.sessionId}: session lock is stale (${result.staleReason ?? "unknown"}).`
				: `Cannot build session ${result.sessionId}: session lock is not held by this process.`;
		case "locked_by_other":
			return `Cannot build session ${result.sessionId}: locked by pid ${result.lock.pid} on ${result.lock.host}.`;
	}
}

export async function runPawBuildCommand(args: string[]): Promise<void> {
	const parsed = parsePawBuildArgs(args);

	if (parsed.kind === "help") {
		printPawBuildHelp();
		return;
	}

	if (parsed.kind === "error") {
		printPawBuildCommandError(parsed.message);
		return;
	}

	try {
		console.log(
			formatPawBuildCommandResult(await createPawBuildCommandResult(process.cwd(), parsed.sessionId, parsed.input)),
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		printPawBuildCommandError(message);
	}
}

async function readPawSessionStateIfExists(
	repoRoot: string,
	sessionId: string,
): Promise<{ name: PawSessionStateName } | null> {
	try {
		return await readPawSessionState(repoRoot, sessionId);
	} catch (error) {
		if (isFileSystemError(error) && error.code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

async function readPawSessionStateNameIfExists(
	repoRoot: string,
	sessionId: string,
): Promise<PawSessionStateName | null> {
	return (await readPawSessionStateIfExists(repoRoot, sessionId))?.name ?? null;
}

function stateNameCanSelectSlice(state: { name: string } | null): boolean {
	return state?.name === "PLAN_APPROVED" || state?.name === "SLICE_DONE";
}

function stateNameCanBeginImplementation(state: { name: string } | null): boolean {
	return state?.name === "SLICE_SELECT";
}

function stateNameIsReviewing(state: { name: string } | null): boolean {
	return state?.name === "REVIEWING";
}

function stateNameIsVerifying(state: { name: string } | null): boolean {
	return state?.name === "VERIFYING";
}

function resolvePawBuildSubAgentExecutor(
	commandInput: PawBuildCommandInput,
	config: PawRuntimeConfig,
): PawSubAgentRuntimeExecutor {
	if (commandInput.executor !== undefined && commandInput.providerExecutor !== undefined) {
		throw new Error("Paw build accepts either executor or providerExecutor, not both.");
	}
	if (commandInput.executor !== undefined) {
		return commandInput.executor;
	}
	if (commandInput.providerExecutor !== undefined) {
		return createPawProviderSubAgentRuntimeExecutor(commandInput.providerExecutor);
	}
	return createPawProviderSubAgentRuntimeExecutor({
		modelRegistry: ModelRegistry.create(AuthStorage.create()),
		defaultProvider: "primary",
		modelIdResolver: (invocation) => resolveDefaultPawBuildModelId(config, invocation),
	});
}

function resolveDefaultPawBuildModelId(config: PawRuntimeConfig, invocation: PawSubAgentRuntimeInvocation): string {
	const role = invocation.role === "reviewer" ? "reviewer" : "worker_simple";
	const route = resolvePawModelRoute(config, role, "standard");
	return `${route.providerName}/${route.model}`;
}

function resolvePawBuildNativeVerificationExecutor(
	repoRoot: string,
	config: PawRuntimeConfig,
	input: Extract<PawBuildParsedInput, { once: true }>,
	commandInput: PawBuildCommandInput,
): PawNativeVerificationExecutor | undefined {
	if (commandInput.nativeVerificationExecutor !== undefined) {
		return commandInput.nativeVerificationExecutor;
	}
	if (input.native !== true) {
		return undefined;
	}
	const plan = createPawNativeVerificationPlan(config.verify.v1_gates);
	const policy = createPawNativeVerificationCommandPolicy(plan);
	return createPawPolicyCheckedNativeVerificationExecutor(
		createPawNativeSubprocessExecutor({ cwd: repoRoot }),
		policy,
	);
}

function isFileSystemError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error;
}

function validatePawBuildTimestamp(timestamp: string): string | undefined {
	const date = new Date(timestamp);
	if (Number.isNaN(date.getTime())) {
		return `Invalid timestamp for "paw build": ${timestamp}`;
	}
	return undefined;
}

function parsePawBuildMaxSteps(value: string): number | string {
	if (!/^\d+$/.test(value)) {
		return `Option --max-steps for "paw build" must be a positive integer.`;
	}
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 1) {
		return `Option --max-steps for "paw build" must be a positive integer.`;
	}
	return parsed;
}

function isPawBuildLoopInput(input: PawBuildParsedInput): input is Extract<PawBuildParsedInput, { maxSteps: number }> {
	return "maxSteps" in input;
}

function isPawBuildLoopResult(result: PawBuildCommandResult): result is PawBuildLoopResult {
	return (
		result.status === "loop_completed" || result.status === "loop_stopped" || result.status === "max_steps_reached"
	);
}

function collectPawBuildLoopVerifyDecisions(stepResults: readonly PawBuildStepResult[]): PawVerifyGateDecision[] {
	return stepResults.flatMap((result) => ("verifyDecisions" in result ? [...result.verifyDecisions] : []));
}

function getPawBuildLoopStopReason(result: PawBuildStepResult): PawBuildLoopStopReason | null {
	switch (result.status) {
		case "advanced":
		case "completed":
		case "completed_with_unverified":
			return null;
		case "no_pending_slices":
			return "no_pending_slices";
		case "blocked":
			return "blocked";
		case "locked":
		case "locked_by_other":
		case "not_locked":
			return "locked";
		case "missing_project":
			return "missing_project";
		case "missing_session":
			return "missing_session";
		case "invalid_state":
		case "no_selected_slice":
		case "invalid_worker_output":
		case "invalid_reviewer_output":
		case "invalid_verification":
		case "invalid_blocked_reason":
		case "invalid_transition":
		case "worker_failed":
		case "reviewer_failed":
			return "failed";
	}
}

function isPawBuildVerifyCompletedResult(
	result: PawBuildCommandResult,
): result is Extract<PawVerifyCommandResult, { status: "completed" | "completed_with_unverified" }> {
	return "verifyDecisions" in result;
}

function formatGateNames(decisions: readonly PawVerifyGateDecision[]): string {
	if (decisions.length === 0) {
		return "none";
	}
	return decisions.map((decision) => decision.gate).join(", ");
}

function formatNativeExecutedGateNames(results: readonly PawNativeVerificationRunResult[]): string {
	const executed = results.filter((result) => result.executed);
	if (executed.length === 0) {
		return "none";
	}
	return executed.map((result) => `${result.gate}(${result.status})`).join(", ");
}

function formatPlannedGateNames(entries: readonly PawNativeVerificationPlanEntry[]): string {
	const plannedEntries = entries.filter((entry) => entry.status === "planned");
	if (plannedEntries.length === 0) {
		return "none";
	}
	return plannedEntries.map((entry) => entry.gate).join(", ");
}

function formatIssues(issues: readonly PawValidationIssue[]): string {
	return issues.map((issue) => `${issue.path} ${issue.message}`).join("; ");
}

function printPawBuildHelp(): void {
	console.log(`Usage:
  ${APP_NAME} paw build <session-id> --once [--native] [--handoff <text>] [--timestamp <iso>]
  ${APP_NAME} paw build <session-id> --max-steps <n> [--native] [--handoff <text>] [--timestamp <iso>]

Run bounded Paw build orchestration for the current session state.

Options:
  --once             Run exactly one build step
  --max-steps <n>    Run at most n build steps before stopping
  --native           Execute native verification gates during VERIFYING steps
  --handoff <text>   Optional worker or reviewer handoff text
  --timestamp <iso>  Optional ISO-8601 timestamp for journal entries

Commands:
  ${APP_NAME} paw build <session-id> --once         Run one build step
  ${APP_NAME} paw build <session-id> --max-steps 5  Run a bounded build loop
  ${APP_NAME} paw build --help                      Show this help
`);
}

function printPawBuildCommandError(message: string): void {
	console.error(`Error: ${message}`);
	process.exitCode = 1;
}
