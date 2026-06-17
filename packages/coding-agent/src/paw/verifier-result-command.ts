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
import type { PawSessionStateName } from "./state.ts";
import { completePawVerification, type PawVerificationResult } from "./verifier-result.ts";

export type PawCompleteVerificationCommandResult =
	| PawCompleteVerificationCommandCompletedResult
	| PawCompleteVerificationCommandCompletedWithUnverifiedResult
	| PawCompleteVerificationCommandInvalidDecisionFileResult
	| PawCompleteVerificationCommandMissingDecisionFileResult
	| PawCompleteVerificationCommandMissingProjectResult
	| PawCompleteVerificationCommandMissingSessionResult
	| PawCompleteVerificationCommandLockedResult
	| PawCompleteVerificationCommandInvalidStateResult
	| PawCompleteVerificationCommandNoSelectedSliceResult
	| PawCompleteVerificationCommandInvalidVerifyDecisionsResult
	| PawCompleteVerificationCommandInvalidTransitionResult
	| PawCompleteVerificationCommandNotLockedResult
	| PawCompleteVerificationCommandLockedByOtherResult;

export interface PawCompleteVerificationCommandInput {
	lockOptions?: PawSessionLockOptions;
}

export interface PawCompleteVerificationCommandCompletedResult {
	status: "completed";
	sessionId: string;
	selectedSliceId: string;
	previousStateName: PawSessionStateName;
	nextStateName: PawSessionStateName;
	decisionCount: number;
	unverifiedCount: number;
	lockReleased: boolean;
}

export interface PawCompleteVerificationCommandCompletedWithUnverifiedResult {
	status: "completed_with_unverified";
	sessionId: string;
	selectedSliceId: string;
	previousStateName: PawSessionStateName;
	nextStateName: PawSessionStateName;
	decisionCount: number;
	unverifiedCount: number;
	lockReleased: boolean;
}

export interface PawCompleteVerificationCommandInvalidDecisionFileResult {
	status: "invalid_decision_file";
	sessionId: string;
	decisionFile: string;
	issues: readonly PawValidationIssue[];
}

export interface PawCompleteVerificationCommandMissingDecisionFileResult {
	status: "missing_decision_file";
	sessionId: string;
	decisionFile: string;
}

export interface PawCompleteVerificationCommandMissingProjectResult {
	status: "missing_project";
	pawDir: string;
}

export interface PawCompleteVerificationCommandMissingSessionResult {
	status: "missing_session";
	sessionId: string;
	stateFile: string;
}

export interface PawCompleteVerificationCommandLockedResult {
	status: "locked";
	sessionId: string;
	lock: PawSessionLock;
}

export interface PawCompleteVerificationCommandInvalidStateResult {
	status: "invalid_state";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawCompleteVerificationCommandNoSelectedSliceResult {
	status: "no_selected_slice";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawCompleteVerificationCommandInvalidVerifyDecisionsResult {
	status: "invalid_verify_decisions";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawCompleteVerificationCommandInvalidTransitionResult {
	status: "invalid_transition";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawCompleteVerificationCommandNotLockedResult {
	status: "not_locked";
	sessionId: string;
	reason: "unlocked" | "stale";
	staleReason?: PawSessionLockStaleReason;
	lockReleased: boolean;
}

export interface PawCompleteVerificationCommandLockedByOtherResult {
	status: "locked_by_other";
	sessionId: string;
	lock: PawSessionLock;
	lockReleased: boolean;
}

interface FileSystemError extends Error {
	code?: string;
}

export interface PawCompleteVerificationParsedInput {
	decisionFile: string;
}

export type PawCompleteVerificationParsedArgs =
	| { kind: "help" }
	| { kind: "error"; message: string }
	| { kind: "ok"; sessionId: string; input: PawCompleteVerificationParsedInput };

const COMPLETE_VERIFICATION_SCALAR_OPTIONS = new Set(["--decision-file"]);

export function parsePawCompleteVerificationArgs(args: string[]): PawCompleteVerificationParsedArgs {
	if (args.some((arg) => arg === "--help" || arg === "-h")) {
		return { kind: "help" };
	}

	if (args.length === 0) {
		return { kind: "error", message: 'Missing required session id for "paw complete-verification".' };
	}

	const sessionId = args[0];
	if (sessionId.startsWith("-")) {
		return { kind: "error", message: 'Missing required session id for "paw complete-verification".' };
	}

	let decisionFile: string | undefined;
	const seenScalarOptions = new Set<string>();

	for (let index = 1; index < args.length; ) {
		const arg = args[index];

		if (COMPLETE_VERIFICATION_SCALAR_OPTIONS.has(arg)) {
			if (seenScalarOptions.has(arg)) {
				return { kind: "error", message: `Duplicate option for "paw complete-verification": ${arg}` };
			}
			seenScalarOptions.add(arg);
			if (index + 1 >= args.length) {
				return { kind: "error", message: `Missing value for "paw complete-verification" option: ${arg}` };
			}
			const value = args[index + 1];
			if (value.trim().length === 0) {
				return {
					kind: "error",
					message: `Option ${arg} for "paw complete-verification" must be a non-empty string.`,
				};
			}
			if (arg === "--decision-file") {
				decisionFile = value;
			}
			index += 2;
			continue;
		}

		if (arg.startsWith("-")) {
			return { kind: "error", message: `Unknown option for "paw complete-verification": ${arg}` };
		}

		return { kind: "error", message: `Unknown option for "paw complete-verification": ${arg}` };
	}

	if (decisionFile === undefined) {
		return { kind: "error", message: 'Missing required option for "paw complete-verification": --decision-file' };
	}

	return { kind: "ok", sessionId, input: { decisionFile } };
}

export async function createPawCompleteVerificationCommandResult(
	repoRoot: string,
	sessionId: string,
	input: PawCompleteVerificationParsedInput,
	commandInput: PawCompleteVerificationCommandInput = {},
): Promise<PawCompleteVerificationCommandResult> {
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

	const decisionRead = await readVerificationDecisionFile(input.decisionFile);
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

	const completion = await completePawVerification({
		repoRoot,
		sessionId,
		verifyDecisions: decisionRead.value,
		lockOptions: commandInput.lockOptions,
	});
	const lockReleased = await releasePawSessionLock(repoRoot, sessionId, commandInput.lockOptions);
	return mapPawCompleteVerificationResult(sessionId, completion, lockReleased);
}

export function formatPawCompleteVerificationCommandResult(result: PawCompleteVerificationCommandResult): string {
	switch (result.status) {
		case "completed":
		case "completed_with_unverified":
			return [
				"Paw complete-verification",
				`session: ${result.sessionId}`,
				`status: ${result.status}`,
				`selected slice: ${result.selectedSliceId}`,
				`state: ${result.previousStateName} -> ${result.nextStateName}`,
				`decisions: ${result.decisionCount}`,
				`unverified: ${result.unverifiedCount}`,
				`lock released: ${result.lockReleased ? "yes" : "no"}`,
			].join("\n");
		case "invalid_decision_file":
			return `Cannot complete verification for session ${result.sessionId}: invalid decision file at ${result.decisionFile}: ${formatIssues(result.issues)}`;
		case "missing_decision_file":
			return `Cannot complete verification for session ${result.sessionId}: decision file not found at ${result.decisionFile}.`;
		case "missing_project":
			return `Paw is not initialized at ${result.pawDir}. Run \`${APP_NAME} paw init\`.`;
		case "missing_session":
			return `No Paw session state found for ${result.sessionId} at ${result.stateFile}.`;
		case "locked":
			return `Paw session ${result.sessionId} is locked by pid ${result.lock.pid} on ${result.lock.host}.`;
		case "invalid_state":
			return `Cannot complete verification for session ${result.sessionId} from ${result.previousStateName}: ${formatIssues(result.issues)}`;
		case "no_selected_slice":
			return `Cannot complete verification for session ${result.sessionId}: no selected slice in ${result.previousStateName}.`;
		case "invalid_verify_decisions":
			return `Cannot complete verification for session ${result.sessionId} from ${result.previousStateName}: ${formatIssues(result.issues)}`;
		case "invalid_transition":
			return `Cannot complete verification for session ${result.sessionId} from ${result.previousStateName}: ${formatIssues(result.issues)}`;
		case "not_locked":
			return result.reason === "stale"
				? `Cannot complete verification for session ${result.sessionId}: session lock is stale (${result.staleReason ?? "unknown"}).`
				: `Cannot complete verification for session ${result.sessionId}: session lock is not held by this process.`;
		case "locked_by_other":
			return `Cannot complete verification for session ${result.sessionId}: locked by pid ${result.lock.pid} on ${result.lock.host}.`;
	}
}

export async function runPawCompleteVerificationCommand(args: string[]): Promise<void> {
	const parsed = parsePawCompleteVerificationArgs(args);

	if (parsed.kind === "help") {
		printPawCompleteVerificationHelp();
		return;
	}

	if (parsed.kind === "error") {
		printPawCompleteVerificationCommandError(parsed.message);
		return;
	}

	try {
		console.log(
			formatPawCompleteVerificationCommandResult(
				await createPawCompleteVerificationCommandResult(process.cwd(), parsed.sessionId, parsed.input),
			),
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		printPawCompleteVerificationCommandError(message);
	}
}

function mapPawCompleteVerificationResult(
	sessionId: string,
	completion: PawVerificationResult,
	lockReleased: boolean,
): PawCompleteVerificationCommandResult {
	switch (completion.status) {
		case "completed":
			return {
				status: "completed",
				sessionId,
				selectedSliceId: completion.previousState.current_slice_id ?? "",
				previousStateName: completion.previousState.name,
				nextStateName: completion.nextState.name,
				decisionCount: completion.verifyDecisions.length,
				unverifiedCount: completion.unverifiedDecisions.length,
				lockReleased,
			};
		case "completed_with_unverified":
			return {
				status: "completed_with_unverified",
				sessionId,
				selectedSliceId: completion.previousState.current_slice_id ?? "",
				previousStateName: completion.previousState.name,
				nextStateName: completion.nextState.name,
				decisionCount: completion.verifyDecisions.length,
				unverifiedCount: completion.unverifiedDecisions.length,
				lockReleased,
			};
		case "invalid_state":
			return {
				status: "invalid_state",
				sessionId,
				previousStateName: completion.previousState.name,
				issues: completion.issues,
				lockReleased,
			};
		case "no_selected_slice":
			return {
				status: "no_selected_slice",
				sessionId,
				previousStateName: completion.previousState.name,
				issues: completion.issues,
				lockReleased,
			};
		case "invalid_verify_decisions":
			return {
				status: "invalid_verify_decisions",
				sessionId,
				previousStateName: completion.previousState.name,
				issues: completion.issues,
				lockReleased,
			};
		case "invalid_transition":
			return {
				status: "invalid_transition",
				sessionId,
				previousStateName: completion.previousState.name,
				issues: completion.issues,
				lockReleased,
			};
		case "not_locked":
			return completion.reason === "stale"
				? {
						status: "not_locked",
						sessionId,
						reason: "stale",
						staleReason: completion.staleReason,
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
				lock: completion.lock,
				lockReleased,
			};
	}
}

type VerificationDecisionReadResult =
	| { kind: "missing" }
	| { kind: "invalid"; issues: readonly PawValidationIssue[] }
	| { kind: "ok"; value: PawVerifyGateDecision[] };

async function readVerificationDecisionFile(decisionFile: string): Promise<VerificationDecisionReadResult> {
	try {
		const content = await readFile(decisionFile, "utf-8");
		return parseVerificationDecisionFileContent(content);
	} catch (error) {
		if (isFileSystemError(error) && error.code === "ENOENT") {
			return { kind: "missing" };
		}
		throw error;
	}
}

function parseVerificationDecisionFileContent(content: string): VerificationDecisionReadResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		return {
			kind: "invalid",
			issues: [{ path: "/", message: "Decision file must contain valid JSON." }],
		};
	}

	const decisions = extractVerifyDecisions(parsed);
	if (decisions === undefined) {
		return {
			kind: "invalid",
			issues: [
				{
					path: "/",
					message: "Decision file must be a verify decision array or an object with verify_decisions.",
				},
			],
		};
	}

	if (decisions.length === 0) {
		return {
			kind: "invalid",
			issues: [
				{
					path: "/verify_decisions",
					message: "Verification completion requires at least one gate decision.",
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

	return { kind: "ok", value: normalized };
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

function printPawCompleteVerificationHelp(): void {
	console.log(`Usage:
  ${APP_NAME} paw complete-verification <session-id> --decision-file <path>

Complete verification from VERIFYING to SLICE_DONE using verify gate decision JSON.

Options:
  --decision-file <path>  Required verify decisions JSON file (array or { verify_decisions: [...] })

Commands:
  ${APP_NAME} paw complete-verification <session-id> --decision-file <path>  Complete verification
  ${APP_NAME} paw complete-verification --help                                   Show this help
`);
}

function printPawCompleteVerificationCommandError(message: string): void {
	console.error(`Error: ${message}`);
	process.exitCode = 1;
}

function isFileSystemError(error: unknown): error is FileSystemError {
	return error instanceof Error;
}
