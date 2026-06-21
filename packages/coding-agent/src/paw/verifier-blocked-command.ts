import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { APP_NAME } from "../config.ts";
import {
	type PawCliScalarFieldBinding,
	pawCliArgsShowHelp,
	pawCliParseRequiredSessionId,
	pawCliParseScalarFieldsFromArgs,
} from "./cli-arg-parsing.ts";
import { formatPawCliValidationIssues, isPawFileSystemError, pawCliIsDirectory, pawCliIsFile } from "./cli-fs.ts";
import type { PawValidationIssue } from "./contracts.ts";
import { mapPawNotLockedCommandFields } from "./lock-result-mapping.ts";
import { resolvePawProjectPaths } from "./persistence.ts";
import type { PawVerifyGateDecision } from "./resilience-policy.ts";
import {
	acquirePawSessionLock,
	type PawSessionLock,
	type PawSessionLockOptions,
	type PawSessionLockStaleReason,
	releasePawSessionLock,
	resolvePawSessionPaths,
} from "./session-store.ts";
import {
	PAW_BLOCKED_REASON_CODES,
	type PawBlockedReasonCode,
	type PawBlockedReasonInput,
	type PawSessionStateName,
} from "./state.ts";
import { blockPawVerifierResult, type PawVerifierBlockedResult } from "./verifier-blocked-result.ts";
import { extractPawVerifyDecisionsFromJson, normalizePawVerifyGateDecisionList } from "./verify-gate-decision-parse.ts";

const BLOCK_VERIFIER_COMMAND_LABEL = "paw block-verifier";

export type PawBlockVerifierCommandResult =
	| PawBlockVerifierCommandBlockedResult
	| PawBlockVerifierCommandInvalidDecisionFileResult
	| PawBlockVerifierCommandMissingDecisionFileResult
	| PawBlockVerifierCommandMissingProjectResult
	| PawBlockVerifierCommandMissingSessionResult
	| PawBlockVerifierCommandLockedResult
	| PawBlockVerifierCommandInvalidStateResult
	| PawBlockVerifierCommandNoSelectedSliceResult
	| PawBlockVerifierCommandInvalidBlockedDecisionsResult
	| PawBlockVerifierCommandInvalidBlockedReasonResult
	| PawBlockVerifierCommandInvalidTransitionResult
	| PawBlockVerifierCommandNotLockedResult
	| PawBlockVerifierCommandLockedByOtherResult;

export interface PawBlockVerifierCommandInput {
	lockOptions?: PawSessionLockOptions;
}

export interface PawBlockVerifierCommandBlockedResult {
	status: "blocked";
	sessionId: string;
	selectedSliceId: string;
	previousStateName: PawSessionStateName;
	nextStateName: PawSessionStateName;
	blockedReasonCode: string;
	blockedReasonMessage: string;
	lockReleased: boolean;
}

export interface PawBlockVerifierCommandInvalidDecisionFileResult {
	status: "invalid_decision_file";
	sessionId: string;
	decisionFile: string;
	issues: readonly PawValidationIssue[];
}

export interface PawBlockVerifierCommandMissingDecisionFileResult {
	status: "missing_decision_file";
	sessionId: string;
	decisionFile: string;
}

export interface PawBlockVerifierCommandMissingProjectResult {
	status: "missing_project";
	pawDir: string;
}

export interface PawBlockVerifierCommandMissingSessionResult {
	status: "missing_session";
	sessionId: string;
	stateFile: string;
}

export interface PawBlockVerifierCommandLockedResult {
	status: "locked";
	sessionId: string;
	lock: PawSessionLock;
}

export interface PawBlockVerifierCommandInvalidStateResult {
	status: "invalid_state";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawBlockVerifierCommandNoSelectedSliceResult {
	status: "no_selected_slice";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawBlockVerifierCommandInvalidBlockedDecisionsResult {
	status: "invalid_blocked_decisions";
	sessionId: string;
	decisionFile: string;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawBlockVerifierCommandInvalidBlockedReasonResult {
	status: "invalid_blocked_reason";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawBlockVerifierCommandInvalidTransitionResult {
	status: "invalid_transition";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawBlockVerifierCommandNotLockedResult {
	status: "not_locked";
	sessionId: string;
	reason: "unlocked" | "stale";
	staleReason?: PawSessionLockStaleReason;
	lockReleased: boolean;
}

export interface PawBlockVerifierCommandLockedByOtherResult {
	status: "locked_by_other";
	sessionId: string;
	lock: PawSessionLock;
	lockReleased: boolean;
}

export interface PawBlockVerifierParsedInput {
	decisionFile: string;
}

export type PawBlockVerifierParsedArgs =
	| { kind: "help" }
	| { kind: "error"; message: string }
	| { kind: "ok"; sessionId: string; input: PawBlockVerifierParsedInput };

const BLOCK_VERIFIER_SCALAR_OPTIONS = new Set(["--decision-file"]);

export function parsePawBlockVerifierArgs(args: string[]): PawBlockVerifierParsedArgs {
	if (pawCliArgsShowHelp(args)) {
		return { kind: "help" };
	}

	const sessionIdResult = pawCliParseRequiredSessionId(args, BLOCK_VERIFIER_COMMAND_LABEL);
	if ("kind" in sessionIdResult) {
		return sessionIdResult;
	}

	let decisionFile: string | undefined;
	const bindings: PawCliScalarFieldBinding[] = [
		{
			option: "--decision-file",
			set: (value) => {
				decisionFile = value;
			},
		},
	];
	const fields = pawCliParseScalarFieldsFromArgs(
		BLOCK_VERIFIER_COMMAND_LABEL,
		args,
		1,
		BLOCK_VERIFIER_SCALAR_OPTIONS,
		bindings,
	);
	if ("kind" in fields) {
		return fields;
	}

	if (decisionFile === undefined) {
		return {
			kind: "error",
			message: `Missing required option for "${BLOCK_VERIFIER_COMMAND_LABEL}": --decision-file`,
		};
	}

	return { kind: "ok", sessionId: sessionIdResult.sessionId, input: { decisionFile } };
}

export async function createPawBlockVerifierCommandResult(
	repoRoot: string,
	sessionId: string,
	input: PawBlockVerifierParsedInput,
	commandInput: PawBlockVerifierCommandInput = {},
): Promise<PawBlockVerifierCommandResult> {
	const relativeDecisionFile = relative(repoRoot, input.decisionFile) || input.decisionFile;
	const projectPaths = resolvePawProjectPaths(repoRoot);
	const pawDir = relative(projectPaths.repoRoot, projectPaths.pawDir) || ".paw";
	if (!(await pawCliIsDirectory(projectPaths.pawDir))) {
		return {
			status: "missing_project",
			pawDir,
		};
	}

	const sessionPaths = resolvePawSessionPaths(repoRoot, sessionId);
	const relativeStateFile = relative(projectPaths.repoRoot, sessionPaths.stateFile);
	if (!(await pawCliIsFile(sessionPaths.stateFile))) {
		return {
			status: "missing_session",
			sessionId,
			stateFile: relativeStateFile,
		};
	}

	const decisionRead = await readVerifierBlockedDecisionFile(input.decisionFile);
	if (decisionRead.kind === "missing") {
		return {
			status: "missing_decision_file",
			sessionId,
			decisionFile: relativeDecisionFile,
		};
	}
	if (decisionRead.kind === "invalid") {
		return {
			status: "invalid_decision_file",
			sessionId,
			decisionFile: relativeDecisionFile,
			issues: decisionRead.issues,
		};
	}

	const lockResult = await acquirePawSessionLock(repoRoot, sessionId, commandInput.lockOptions);
	if (!lockResult.acquired) {
		return {
			status: "locked",
			sessionId,
			lock: lockResult.lock,
		};
	}

	const blocked = await blockPawVerifierResult({
		repoRoot,
		sessionId,
		blockedReason: decisionRead.value,
		lockOptions: commandInput.lockOptions,
	});
	const lockReleased = await releasePawSessionLock(repoRoot, sessionId, commandInput.lockOptions);
	return mapPawBlockVerifierResult(sessionId, blocked, lockReleased);
}

export function formatPawBlockVerifierCommandResult(result: PawBlockVerifierCommandResult): string {
	switch (result.status) {
		case "blocked":
			return [
				"Paw block-verifier",
				`session: ${result.sessionId}`,
				`status: ${result.status}`,
				`selected slice: ${result.selectedSliceId}`,
				`state: ${result.previousStateName} -> ${result.nextStateName}`,
				`blocked reason: ${result.blockedReasonCode} — ${result.blockedReasonMessage}`,
				`lock released: ${result.lockReleased ? "yes" : "no"}`,
			].join("\n");
		case "invalid_decision_file":
			return `Cannot block verifier for session ${result.sessionId}: invalid decision file at ${result.decisionFile}: ${formatPawCliValidationIssues(result.issues)}`;
		case "missing_decision_file":
			return `Cannot block verifier for session ${result.sessionId}: decision file not found at ${result.decisionFile}.`;
		case "missing_project":
			return `Paw is not initialized at ${result.pawDir}. Run \`${APP_NAME} paw init\`.`;
		case "missing_session":
			return `No Paw session state found for ${result.sessionId} at ${result.stateFile}.`;
		case "locked":
			return `Paw session ${result.sessionId} is locked by pid ${result.lock.pid} on ${result.lock.host}.`;
		case "invalid_state":
			return `Cannot block verifier for session ${result.sessionId} from ${result.previousStateName}: ${formatPawCliValidationIssues(result.issues)}`;
		case "no_selected_slice":
			return `Cannot block verifier for session ${result.sessionId}: no selected slice in ${result.previousStateName}.`;
		case "invalid_blocked_decisions":
			return `Cannot block verifier for session ${result.sessionId}: decision file at ${result.decisionFile} does not describe a blocked verification outcome: ${formatPawCliValidationIssues(result.issues)}`;
		case "invalid_blocked_reason":
			return `Cannot block verifier for session ${result.sessionId}: ${formatPawCliValidationIssues(result.issues)}`;
		case "invalid_transition":
			return `Cannot block verifier for session ${result.sessionId} from ${result.previousStateName}: ${formatPawCliValidationIssues(result.issues)}`;
		case "not_locked":
			return result.reason === "stale"
				? `Cannot block verifier for session ${result.sessionId}: session lock is stale (${result.staleReason ?? "unknown"}).`
				: `Cannot block verifier for session ${result.sessionId}: session lock is not held by this process.`;
		case "locked_by_other":
			return `Cannot block verifier for session ${result.sessionId}: locked by pid ${result.lock.pid} on ${result.lock.host}.`;
	}
}

export async function runPawBlockVerifierCommand(args: string[]): Promise<void> {
	const parsed = parsePawBlockVerifierArgs(args);

	if (parsed.kind === "help") {
		printPawBlockVerifierHelp();
		return;
	}

	if (parsed.kind === "error") {
		printPawBlockVerifierCommandError(parsed.message);
		return;
	}

	try {
		console.log(
			formatPawBlockVerifierCommandResult(
				await createPawBlockVerifierCommandResult(process.cwd(), parsed.sessionId, parsed.input),
			),
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		printPawBlockVerifierCommandError(message);
	}
}

function mapPawBlockVerifierResult(
	sessionId: string,
	blocked: PawVerifierBlockedResult,
	lockReleased: boolean,
): PawBlockVerifierCommandResult {
	switch (blocked.status) {
		case "blocked": {
			const reason = blocked.nextState.blocked_reason;
			return {
				status: "blocked",
				sessionId,
				selectedSliceId: blocked.previousState.current_slice_id ?? "",
				previousStateName: blocked.previousState.name,
				nextStateName: blocked.nextState.name,
				blockedReasonCode: reason?.code ?? "",
				blockedReasonMessage: reason?.message ?? "",
				lockReleased,
			};
		}
		case "invalid_state":
			return {
				status: "invalid_state",
				sessionId,
				previousStateName: blocked.previousState.name,
				issues: blocked.issues,
				lockReleased,
			};
		case "no_selected_slice":
			return {
				status: "no_selected_slice",
				sessionId,
				previousStateName: blocked.previousState.name,
				issues: blocked.issues,
				lockReleased,
			};
		case "invalid_blocked_reason":
			return {
				status: "invalid_blocked_reason",
				sessionId,
				previousStateName: blocked.previousState.name,
				issues: blocked.issues,
				lockReleased,
			};
		case "invalid_transition":
			return {
				status: "invalid_transition",
				sessionId,
				previousStateName: blocked.previousState.name,
				issues: blocked.issues,
				lockReleased,
			};
		case "not_locked":
			return mapPawNotLockedCommandFields(
				sessionId,
				blocked.reason,
				lockReleased,
				blocked.reason === "stale" ? blocked.staleReason : undefined,
			);
		case "locked_by_other":
			return {
				status: "locked_by_other",
				sessionId,
				lock: blocked.lock,
				lockReleased,
			};
	}
}

type VerifierBlockedDecisionReadResult =
	| { kind: "missing" }
	| { kind: "invalid"; issues: readonly PawValidationIssue[] }
	| { kind: "ok"; value: PawBlockedReasonInput };

async function readVerifierBlockedDecisionFile(decisionFile: string): Promise<VerifierBlockedDecisionReadResult> {
	try {
		const content = await readFile(decisionFile, "utf-8");
		return parseVerifierBlockedDecisionFileContent(content);
	} catch (error) {
		if (isPawFileSystemError(error) && error.code === "ENOENT") {
			return { kind: "missing" };
		}
		throw error;
	}
}

function parseVerifierBlockedDecisionFileContent(content: string): VerifierBlockedDecisionReadResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		return {
			kind: "invalid",
			issues: [{ path: "/", message: "Decision file must contain valid JSON." }],
		};
	}

	const directReason = extractBlockedReasonFromObject(parsed);
	if (directReason !== undefined) {
		return directReason;
	}

	const decisions = extractPawVerifyDecisionsFromJson(parsed);
	if (decisions === undefined) {
		return {
			kind: "invalid",
			issues: [
				{
					path: "/",
					message:
						"Decision file must include blocked_reason metadata or a verify decision array (or verify_decisions).",
				},
			],
		};
	}

	const normalizedResult = normalizePawVerifyGateDecisionList(decisions);
	if (!normalizedResult.ok) {
		return { kind: "invalid", issues: normalizedResult.issues };
	}
	const normalized = normalizedResult.value;

	const blockingDecision = normalized.find((decision) => decision.status === "unverified" && decision.applicable);
	if (blockingDecision === undefined) {
		return {
			kind: "invalid",
			issues: [
				{
					path: "/verify_decisions",
					message: "Verifier blocked result requires at least one applicable unverified gate decision.",
				},
			],
		};
	}

	return {
		kind: "ok",
		value: deriveBlockedReasonFromVerifyDecision(blockingDecision),
	};
}

function extractBlockedReasonFromObject(parsed: unknown): VerifierBlockedDecisionReadResult | undefined {
	if (typeof parsed !== "object" || parsed === null) {
		return undefined;
	}
	const record = parsed as Record<string, unknown>;
	const blockedReason = record.blocked_reason;
	if (blockedReason === undefined) {
		return undefined;
	}
	if (typeof blockedReason !== "object" || blockedReason === null) {
		return {
			kind: "invalid",
			issues: [{ path: "/blocked_reason", message: "blocked_reason must be an object." }],
		};
	}
	const reasonRecord = blockedReason as Record<string, unknown>;
	const code = reasonRecord.code;
	const message = reasonRecord.message;
	const suggestedAction = reasonRecord.suggested_action;
	const issues: PawValidationIssue[] = [];
	if (typeof code !== "string" || !isPawBlockedReasonCode(code)) {
		issues.push({ path: "/blocked_reason/code", message: "Verifier blocked reason code is invalid." });
	}
	if (typeof message !== "string" || message.trim().length === 0) {
		issues.push({ path: "/blocked_reason/message", message: "Verifier blocked reason message is required." });
	}
	if (typeof suggestedAction !== "string" || suggestedAction.trim().length === 0) {
		issues.push({
			path: "/blocked_reason/suggested_action",
			message: "Verifier blocked reason suggested action is required.",
		});
	}
	if (issues.length > 0) {
		return { kind: "invalid", issues };
	}
	return {
		kind: "ok",
		value: {
			code: code as PawBlockedReasonCode,
			message: message as string,
			suggested_action: suggestedAction as string,
		},
	};
}

function deriveBlockedReasonFromVerifyDecision(decision: PawVerifyGateDecision): PawBlockedReasonInput {
	const gate = decision.gate;
	const detail =
		decision.status === "unverified" && "reason" in decision && typeof decision.reason === "string"
			? decision.reason
			: "Verification gate failed.";
	return {
		code: mapVerifyGateToBlockedReasonCode(gate),
		message: `Verification gate failed for ${gate}: ${detail}`,
		suggested_action: "Fix the failing verification gate and resume verification.",
	};
}

function mapVerifyGateToBlockedReasonCode(gate: string): PawBlockedReasonCode {
	const normalized = gate.trim().toLowerCase();
	if (normalized.includes("build")) {
		return "BUILD_FAILURE";
	}
	return "TEST_FAILURE";
}

function isPawBlockedReasonCode(code: string): code is PawBlockedReasonCode {
	return PAW_BLOCKED_REASON_CODES.includes(code as PawBlockedReasonCode);
}

function printPawBlockVerifierHelp(): void {
	console.log(`Usage:
  ${APP_NAME} paw block-verifier <session-id> --decision-file <path>

Record a verifier blocked result from VERIFYING to a BLOCKED_* state using verify gate decision JSON or blocked_reason metadata.

Options:
  --decision-file <path>  Required verify decisions JSON file (array, { verify_decisions: [...] }, or { blocked_reason: {...} })

Commands:
  ${APP_NAME} paw block-verifier <session-id> --decision-file <path>  Block verifier pass
  ${APP_NAME} paw block-verifier --help                              Show this help
`);
}

function printPawBlockVerifierCommandError(message: string): void {
	console.error(`Error: ${message}`);
	process.exitCode = 1;
}
