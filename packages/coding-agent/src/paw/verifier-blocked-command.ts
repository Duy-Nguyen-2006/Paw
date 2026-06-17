import { readFile, stat } from "node:fs/promises";
import { relative } from "node:path";
import { APP_NAME } from "../config.ts";
import type { PawValidationIssue } from "./contracts.ts";
import { resolvePawProjectPaths } from "./persistence.ts";
import type { PawVerifyGateDecision, PawVerifyGateSet } from "./resilience-policy.ts";
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

interface FileSystemError extends Error {
	code?: string;
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
	if (args.some((arg) => arg === "--help" || arg === "-h")) {
		return { kind: "help" };
	}

	if (args.length === 0) {
		return { kind: "error", message: 'Missing required session id for "paw block-verifier".' };
	}

	const sessionId = args[0];
	if (sessionId.startsWith("-")) {
		return { kind: "error", message: 'Missing required session id for "paw block-verifier".' };
	}

	let decisionFile: string | undefined;
	const seenScalarOptions = new Set<string>();

	for (let index = 1; index < args.length; ) {
		const arg = args[index];

		if (BLOCK_VERIFIER_SCALAR_OPTIONS.has(arg)) {
			if (seenScalarOptions.has(arg)) {
				return { kind: "error", message: `Duplicate option for "paw block-verifier": ${arg}` };
			}
			seenScalarOptions.add(arg);
			if (index + 1 >= args.length) {
				return { kind: "error", message: `Missing value for "paw block-verifier" option: ${arg}` };
			}
			const value = args[index + 1];
			if (value.trim().length === 0) {
				return {
					kind: "error",
					message: `Option ${arg} for "paw block-verifier" must be a non-empty string.`,
				};
			}
			if (arg === "--decision-file") {
				decisionFile = value;
			}
			index += 2;
			continue;
		}

		if (arg.startsWith("-")) {
			return { kind: "error", message: `Unknown option for "paw block-verifier": ${arg}` };
		}

		return { kind: "error", message: `Unknown option for "paw block-verifier": ${arg}` };
	}

	if (decisionFile === undefined) {
		return { kind: "error", message: 'Missing required option for "paw block-verifier": --decision-file' };
	}

	return { kind: "ok", sessionId, input: { decisionFile } };
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
	if (!(await isDirectory(projectPaths.pawDir))) {
		return {
			status: "missing_project",
			pawDir,
		};
	}

	const sessionPaths = resolvePawSessionPaths(repoRoot, sessionId);
	const relativeStateFile = relative(projectPaths.repoRoot, sessionPaths.stateFile);
	if (!(await isFile(sessionPaths.stateFile))) {
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
			return `Cannot block verifier for session ${result.sessionId}: invalid decision file at ${result.decisionFile}: ${formatIssues(result.issues)}`;
		case "missing_decision_file":
			return `Cannot block verifier for session ${result.sessionId}: decision file not found at ${result.decisionFile}.`;
		case "missing_project":
			return `Paw is not initialized at ${result.pawDir}. Run \`${APP_NAME} paw init\`.`;
		case "missing_session":
			return `No Paw session state found for ${result.sessionId} at ${result.stateFile}.`;
		case "locked":
			return `Paw session ${result.sessionId} is locked by pid ${result.lock.pid} on ${result.lock.host}.`;
		case "invalid_state":
			return `Cannot block verifier for session ${result.sessionId} from ${result.previousStateName}: ${formatIssues(result.issues)}`;
		case "no_selected_slice":
			return `Cannot block verifier for session ${result.sessionId}: no selected slice in ${result.previousStateName}.`;
		case "invalid_blocked_decisions":
			return `Cannot block verifier for session ${result.sessionId}: decision file at ${result.decisionFile} does not describe a blocked verification outcome: ${formatIssues(result.issues)}`;
		case "invalid_blocked_reason":
			return `Cannot block verifier for session ${result.sessionId}: ${formatIssues(result.issues)}`;
		case "invalid_transition":
			return `Cannot block verifier for session ${result.sessionId} from ${result.previousStateName}: ${formatIssues(result.issues)}`;
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
			return blocked.reason === "stale"
				? {
						status: "not_locked",
						sessionId,
						reason: "stale",
						staleReason: blocked.staleReason,
						lockReleased,
					}
				: {
						status: "not_locked",
						sessionId,
						reason: "unlocked",
						lockReleased,
					};
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
		if (isFileSystemError(error) && error.code === "ENOENT") {
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

	const decisions = extractVerifyDecisions(parsed);
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

	const issues: PawValidationIssue[] = [];
	const normalized: PawVerifyGateDecision[] = [];
	for (let index = 0; index < decisions.length; index += 1) {
		const decision = decisions[index];
		const basePath = `/verify_decisions/${index}`;
		const normalizedDecision = normalizeVerifyGateDecision(decision, basePath, issues);
		if (normalizedDecision !== undefined) {
			normalized.push(normalizedDecision);
		}
	}

	if (issues.length > 0) {
		return { kind: "invalid", issues };
	}

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
	if (normalized.includes("test") || normalized.includes("unit") || normalized.includes("integration")) {
		return "TEST_FAILURE";
	}
	if (normalized.includes("lint") || normalized.includes("type") || normalized.includes("check")) {
		return "TEST_FAILURE";
	}
	return "TEST_FAILURE";
}

function extractVerifyDecisions(parsed: unknown): unknown[] | undefined {
	if (Array.isArray(parsed)) {
		return parsed;
	}
	if (typeof parsed === "object" && parsed !== null && "verify_decisions" in parsed) {
		const verifyDecisions = (parsed as { verify_decisions?: unknown }).verify_decisions;
		if (Array.isArray(verifyDecisions)) {
			return verifyDecisions;
		}
	}
	return undefined;
}

function normalizeVerifyGateDecision(
	decision: unknown,
	basePath: string,
	issues: PawValidationIssue[],
): PawVerifyGateDecision | undefined {
	const itemIssues: PawValidationIssue[] = [];
	if (typeof decision !== "object" || decision === null) {
		itemIssues.push({ path: basePath, message: "Each verify decision must be an object." });
		issues.push(...itemIssues);
		return undefined;
	}

	const record = decision as Record<string, unknown>;
	const status = record.status;
	const gate = record.gate;
	const gateSet = record.gateSet;
	const verified = record.verified;
	const applicable = record.applicable;
	const reason = record.reason;

	if (typeof status !== "string") {
		itemIssues.push({ path: `${basePath}/status`, message: "status must be a string." });
	}
	if (typeof gate !== "string" || gate.trim().length === 0) {
		itemIssues.push({ path: `${basePath}/gate`, message: "gate must be a non-empty string." });
	}
	if (!isPawVerifyGateSet(gateSet)) {
		itemIssues.push({ path: `${basePath}/gateSet`, message: 'gateSet must be "v1", "v2", or "unconfigured".' });
	}
	if (typeof verified !== "boolean") {
		itemIssues.push({ path: `${basePath}/verified`, message: "verified must be a boolean." });
	}
	if (typeof applicable !== "boolean") {
		itemIssues.push({ path: `${basePath}/applicable`, message: "applicable must be a boolean." });
	}

	if (itemIssues.length > 0) {
		issues.push(...itemIssues);
		return undefined;
	}

	const normalizedStatus = status as string;
	const normalizedGate = gate as string;
	const normalizedGateSet = gateSet as PawVerifyGateSet;
	const normalizedApplicable = applicable as boolean;

	if (normalizedStatus === "verified") {
		if (verified !== true) {
			issues.push({ path: `${basePath}/verified`, message: "verified decisions must set verified=true." });
			return undefined;
		}
		return {
			status: "verified",
			gate: normalizedGate,
			verified: true,
			applicable: normalizedApplicable,
			gateSet: normalizedGateSet,
		};
	}

	if (normalizedStatus === "unverified") {
		if (verified !== false) {
			issues.push({ path: `${basePath}/verified`, message: "unverified decisions must set verified=false." });
			return undefined;
		}
		const unverifiedReason = typeof reason === "string" && reason.trim().length > 0 ? reason : "unverified";
		return {
			status: "unverified",
			gate: normalizedGate,
			verified: false,
			applicable: normalizedApplicable,
			gateSet: normalizedGateSet,
			reason: unverifiedReason,
		};
	}

	issues.push({ path: `${basePath}/status`, message: 'status must be "verified" or "unverified".' });
	return undefined;
}

function isPawVerifyGateSet(value: unknown): value is PawVerifyGateSet {
	return value === "v1" || value === "v2" || value === "unconfigured";
}

function isPawBlockedReasonCode(code: string): code is PawBlockedReasonCode {
	return PAW_BLOCKED_REASON_CODES.includes(code as PawBlockedReasonCode);
}

async function isDirectory(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory();
	} catch (error) {
		if (isFileSystemError(error) && error.code === "ENOENT") {
			return false;
		}
		throw error;
	}
}

async function isFile(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isFile();
	} catch (error) {
		if (isFileSystemError(error) && error.code === "ENOENT") {
			return false;
		}
		throw error;
	}
}

function formatIssues(issues: readonly PawValidationIssue[]): string {
	return issues.map((issue) => `${issue.path} ${issue.message}`).join("; ");
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

function isFileSystemError(error: unknown): error is FileSystemError {
	return error instanceof Error;
}
