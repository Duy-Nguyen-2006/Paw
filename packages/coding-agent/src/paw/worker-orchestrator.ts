import { stat } from "node:fs/promises";
import { relative } from "node:path";
import { getPawSubAgentHandoffCap } from "./context-budget.ts";
import type { PawRuntimeConfig, PawSubAgentOutput, PawValidationIssue } from "./contracts.ts";
import { resolvePawModelRoute } from "./model-routing.ts";
import { resolvePawProjectPaths } from "./persistence.ts";
import {
	acquirePawSessionLock,
	type PawSessionLock,
	type PawSessionLockOptions,
	type PawSessionLockStaleReason,
	readPawSessionState,
	releasePawSessionLock,
	resolvePawSessionPaths,
} from "./session-store.ts";
import type { PawSessionStateName } from "./state.ts";
import {
	type PawSubAgentRuntimeDecision,
	type PawSubAgentRuntimeExecutor,
	type PawSubAgentRuntimeInvocation,
	runPawSubAgentRuntime,
} from "./subagent-runtime.ts";
import { blockPawWorkerResult, type PawWorkerBlockedResult } from "./worker-blocked-result.ts";
import { completePawWorkerPass, type PawWorkerPassResult } from "./worker-result.ts";

export type PawWorkerOnceResult =
	| PawWorkerOnceCompletedResult
	| PawWorkerOnceBlockedResult
	| PawWorkerOnceWorkerFailedResult
	| PawWorkerOnceInvalidStateResult
	| PawWorkerOnceNoSelectedSliceResult
	| PawWorkerOnceInvalidWorkerOutputResult
	| PawWorkerOnceInvalidBlockedReasonResult
	| PawWorkerOnceInvalidTransitionResult
	| PawWorkerOnceMissingProjectResult
	| PawWorkerOnceMissingSessionResult
	| PawWorkerOnceLockedResult
	| PawWorkerOnceNotLockedResult
	| PawWorkerOnceLockedByOtherResult;

export interface PawWorkerOnceInput {
	repoRoot: string;
	sessionId: string;
	config: PawRuntimeConfig;
	executor: PawSubAgentRuntimeExecutor;
	handoff?: string;
	lockOptions?: PawSessionLockOptions;
	timestamp?: string;
}

export interface PawWorkerOnceCompletedResult {
	status: "completed";
	sessionId: string;
	selectedSliceId: string;
	previousStateName: PawSessionStateName;
	nextStateName: PawSessionStateName;
	attempts: number;
	journalEntryCount: number;
	lockReleased: boolean;
	reclaimedLock: PawWorkerOnceReclaimedLock | null;
}

export interface PawWorkerOnceBlockedResult {
	status: "blocked";
	sessionId: string;
	selectedSliceId: string;
	previousStateName: PawSessionStateName;
	nextStateName: PawSessionStateName;
	attempts: number;
	blockedReasonCode: string;
	blockedReasonMessage: string;
	lockReleased: boolean;
	reclaimedLock: PawWorkerOnceReclaimedLock | null;
}

export interface PawWorkerOnceWorkerFailedResult {
	status: "worker_failed";
	sessionId: string;
	previousStateName: PawSessionStateName;
	workerStatus: PawSubAgentOutput["status"];
	attempts: number;
	lockReleased: boolean;
	reclaimedLock: PawWorkerOnceReclaimedLock | null;
}

export interface PawWorkerOnceInvalidStateResult {
	status: "invalid_state";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
	reclaimedLock: PawWorkerOnceReclaimedLock | null;
}

export interface PawWorkerOnceNoSelectedSliceResult {
	status: "no_selected_slice";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
	reclaimedLock: PawWorkerOnceReclaimedLock | null;
}

export interface PawWorkerOnceInvalidWorkerOutputResult {
	status: "invalid_worker_output";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
	reclaimedLock: PawWorkerOnceReclaimedLock | null;
}

export interface PawWorkerOnceInvalidBlockedReasonResult {
	status: "invalid_blocked_reason";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
	reclaimedLock: PawWorkerOnceReclaimedLock | null;
}

export interface PawWorkerOnceInvalidTransitionResult {
	status: "invalid_transition";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
	reclaimedLock: PawWorkerOnceReclaimedLock | null;
}

export interface PawWorkerOnceMissingProjectResult {
	status: "missing_project";
	pawDir: string;
}

export interface PawWorkerOnceMissingSessionResult {
	status: "missing_session";
	sessionId: string;
	stateFile: string;
}

export interface PawWorkerOnceLockedResult {
	status: "locked";
	sessionId: string;
	lock: PawSessionLock;
}

export interface PawWorkerOnceNotLockedResult {
	status: "not_locked";
	sessionId: string;
	reason: "unlocked" | "stale";
	staleReason?: PawSessionLockStaleReason;
	lockReleased: boolean;
	reclaimedLock: PawWorkerOnceReclaimedLock | null;
}

export interface PawWorkerOnceLockedByOtherResult {
	status: "locked_by_other";
	sessionId: string;
	lock: PawSessionLock;
	lockReleased: boolean;
	reclaimedLock: PawWorkerOnceReclaimedLock | null;
}

export interface PawWorkerOnceReclaimedLock {
	reason: PawSessionLockStaleReason;
	lock: PawSessionLock;
}

interface FileSystemError extends Error {
	code?: string;
}

export async function runPawWorkerOnce(input: PawWorkerOnceInput): Promise<PawWorkerOnceResult> {
	const projectPaths = resolvePawProjectPaths(input.repoRoot);
	const pawDir = relative(projectPaths.repoRoot, projectPaths.pawDir) || ".paw";
	if (!(await isDirectory(projectPaths.pawDir))) {
		return { status: "missing_project", pawDir };
	}

	const sessionPaths = resolvePawSessionPaths(input.repoRoot, input.sessionId);
	const stateFile = relative(projectPaths.repoRoot, sessionPaths.stateFile);
	if (!(await isFile(sessionPaths.stateFile))) {
		return { status: "missing_session", sessionId: input.sessionId, stateFile };
	}

	const lockResult = await acquirePawSessionLock(input.repoRoot, input.sessionId, input.lockOptions);
	if (!lockResult.acquired) {
		return { status: "locked", sessionId: input.sessionId, lock: lockResult.lock };
	}

	const reclaimedLock = lockResult.reclaimed;
	let lockReleased = false;
	try {
		const state = await readPawSessionState(input.repoRoot, input.sessionId);
		if (state.name !== "IMPLEMENTING") {
			lockReleased = await releasePawSessionLock(input.repoRoot, input.sessionId, input.lockOptions);
			return {
				status: "invalid_state",
				sessionId: input.sessionId,
				previousStateName: state.name,
				issues: [{ path: "/name", message: "Worker orchestration requires IMPLEMENTING state." }],
				lockReleased,
				reclaimedLock,
			};
		}
		if (state.current_slice_id === null) {
			lockReleased = await releasePawSessionLock(input.repoRoot, input.sessionId, input.lockOptions);
			return {
				status: "no_selected_slice",
				sessionId: input.sessionId,
				previousStateName: state.name,
				issues: [{ path: "/current_slice_id", message: "Worker orchestration requires a current slice." }],
				lockReleased,
				reclaimedLock,
			};
		}

		const decision = await runWorkerRuntimeWithRetry(input, state.current_slice_id);
		const output = decision.output;
		if (output.status === "pass") {
			const completed = await completePawWorkerPass({
				repoRoot: input.repoRoot,
				sessionId: input.sessionId,
				workerOutput: output,
				lockOptions: input.lockOptions,
				timestamp: input.timestamp,
			});
			lockReleased = await releasePawSessionLock(input.repoRoot, input.sessionId, input.lockOptions);
			return mapWorkerPassResult(input.sessionId, completed, decision.attempts, lockReleased, reclaimedLock);
		}

		if (output.status === "blocked" || output.status === "needs_user_decision") {
			const blocked = await blockPawWorkerResult({
				repoRoot: input.repoRoot,
				sessionId: input.sessionId,
				workerOutput: output,
				lockOptions: input.lockOptions,
			});
			lockReleased = await releasePawSessionLock(input.repoRoot, input.sessionId, input.lockOptions);
			return mapWorkerBlockedResult(input.sessionId, blocked, decision.attempts, lockReleased, reclaimedLock);
		}

		lockReleased = await releasePawSessionLock(input.repoRoot, input.sessionId, input.lockOptions);
		return {
			status: "worker_failed",
			sessionId: input.sessionId,
			previousStateName: state.name,
			workerStatus: output.status,
			attempts: decision.attempts,
			lockReleased,
			reclaimedLock,
		};
	} catch (error) {
		if (!lockReleased) {
			await releasePawSessionLock(input.repoRoot, input.sessionId, input.lockOptions);
		}
		throw error;
	}
}

async function runWorkerRuntimeWithRetry(
	input: PawWorkerOnceInput,
	sliceId: string,
): Promise<Extract<PawSubAgentRuntimeDecision, { status: "accepted" | "blocked" }>> {
	let decision: PawSubAgentRuntimeDecision | undefined;
	for (let attempt = 1; attempt <= 2; attempt += 1) {
		decision = await runPawSubAgentRuntime(createWorkerInvocation(input, sliceId, attempt), input.executor);
		if (decision.status !== "retry") {
			return decision;
		}
	}

	if (decision === undefined || decision.status === "retry") {
		throw new Error("Paw worker runtime did not produce a terminal decision after retry.");
	}
	return decision;
}

function createWorkerInvocation(
	input: PawWorkerOnceInput,
	sliceId: string,
	attemptNumber: number,
): PawSubAgentRuntimeInvocation {
	const handoff = input.handoff ?? `Implement Paw slice ${sliceId} for session ${input.sessionId}.`;
	const route = resolvePawModelRoute(input.config, "worker_simple", "standard");
	return {
		role: "worker",
		session_id: input.sessionId,
		slice_id: sliceId,
		artifact_ref: `.paw/artifacts/${input.sessionId}/worker/report.md`,
		handoff,
		handoff_token_estimate: estimatePawTokens(handoff),
		max_handoff_tokens: getPawSubAgentHandoffCap(input.config.context, "worker"),
		attempt_number: attemptNumber,
		model_id: route.model,
	};
}

function estimatePawTokens(text: string): number {
	const trimmed = text.trim();
	if (trimmed.length === 0) {
		return 0;
	}
	return Math.ceil(trimmed.split(/\s+/).length * 1.3);
}

function mapWorkerPassResult(
	sessionId: string,
	completed: PawWorkerPassResult,
	attempts: number,
	lockReleased: boolean,
	reclaimedLock: PawWorkerOnceReclaimedLock | null,
): PawWorkerOnceResult {
	switch (completed.status) {
		case "completed":
			return {
				status: "completed",
				sessionId,
				selectedSliceId: completed.previousState.current_slice_id ?? "",
				previousStateName: completed.previousState.name,
				nextStateName: completed.nextState.name,
				attempts,
				journalEntryCount: completed.journalEntries.length,
				lockReleased,
				reclaimedLock,
			};
		case "invalid_state":
			return createInvalidStateResult(
				sessionId,
				completed.previousState.name,
				completed.issues,
				lockReleased,
				reclaimedLock,
			);
		case "no_selected_slice":
			return createNoSelectedSliceResult(
				sessionId,
				completed.previousState.name,
				completed.issues,
				lockReleased,
				reclaimedLock,
			);
		case "invalid_worker_output":
			return createInvalidWorkerOutputResult(
				sessionId,
				completed.previousState.name,
				completed.issues,
				lockReleased,
				reclaimedLock,
			);
		case "worker_not_passed":
			return {
				status: "worker_failed",
				sessionId,
				previousStateName: completed.previousState.name,
				workerStatus: completed.workerOutput.status,
				attempts,
				lockReleased,
				reclaimedLock,
			};
		case "invalid_transition":
			return createInvalidTransitionResult(
				sessionId,
				completed.previousState.name,
				completed.issues,
				lockReleased,
				reclaimedLock,
			);
		case "not_locked":
			return mapNotLockedResult(sessionId, completed, lockReleased, reclaimedLock);
		case "locked_by_other":
			return { status: "locked_by_other", sessionId, lock: completed.lock, lockReleased, reclaimedLock };
	}
}

function mapWorkerBlockedResult(
	sessionId: string,
	blocked: PawWorkerBlockedResult,
	attempts: number,
	lockReleased: boolean,
	reclaimedLock: PawWorkerOnceReclaimedLock | null,
): PawWorkerOnceResult {
	switch (blocked.status) {
		case "blocked": {
			const reason = blocked.nextState.blocked_reason;
			return {
				status: "blocked",
				sessionId,
				selectedSliceId: blocked.previousState.current_slice_id ?? "",
				previousStateName: blocked.previousState.name,
				nextStateName: blocked.nextState.name,
				attempts,
				blockedReasonCode: reason?.code ?? "",
				blockedReasonMessage: reason?.message ?? "",
				lockReleased,
				reclaimedLock,
			};
		}
		case "invalid_state":
			return createInvalidStateResult(
				sessionId,
				blocked.previousState.name,
				blocked.issues,
				lockReleased,
				reclaimedLock,
			);
		case "no_selected_slice":
			return createNoSelectedSliceResult(
				sessionId,
				blocked.previousState.name,
				blocked.issues,
				lockReleased,
				reclaimedLock,
			);
		case "invalid_worker_output":
			return createInvalidWorkerOutputResult(
				sessionId,
				blocked.previousState.name,
				blocked.issues,
				lockReleased,
				reclaimedLock,
			);
		case "worker_not_blocked":
			return {
				status: "worker_failed",
				sessionId,
				previousStateName: blocked.previousState.name,
				workerStatus: blocked.workerOutput.status,
				attempts,
				lockReleased,
				reclaimedLock,
			};
		case "invalid_blocked_reason":
			return {
				status: "invalid_blocked_reason",
				sessionId,
				previousStateName: blocked.previousState.name,
				issues: blocked.issues,
				lockReleased,
				reclaimedLock,
			};
		case "invalid_transition":
			return createInvalidTransitionResult(
				sessionId,
				blocked.previousState.name,
				blocked.issues,
				lockReleased,
				reclaimedLock,
			);
		case "not_locked":
			return mapNotLockedResult(sessionId, blocked, lockReleased, reclaimedLock);
		case "locked_by_other":
			return { status: "locked_by_other", sessionId, lock: blocked.lock, lockReleased, reclaimedLock };
	}
}

function createInvalidStateResult(
	sessionId: string,
	previousStateName: PawSessionStateName,
	issues: readonly PawValidationIssue[],
	lockReleased: boolean,
	reclaimedLock: PawWorkerOnceReclaimedLock | null,
): PawWorkerOnceInvalidStateResult {
	return { status: "invalid_state", sessionId, previousStateName, issues, lockReleased, reclaimedLock };
}

function createNoSelectedSliceResult(
	sessionId: string,
	previousStateName: PawSessionStateName,
	issues: readonly PawValidationIssue[],
	lockReleased: boolean,
	reclaimedLock: PawWorkerOnceReclaimedLock | null,
): PawWorkerOnceNoSelectedSliceResult {
	return { status: "no_selected_slice", sessionId, previousStateName, issues, lockReleased, reclaimedLock };
}

function createInvalidWorkerOutputResult(
	sessionId: string,
	previousStateName: PawSessionStateName,
	issues: readonly PawValidationIssue[],
	lockReleased: boolean,
	reclaimedLock: PawWorkerOnceReclaimedLock | null,
): PawWorkerOnceInvalidWorkerOutputResult {
	return { status: "invalid_worker_output", sessionId, previousStateName, issues, lockReleased, reclaimedLock };
}

function createInvalidTransitionResult(
	sessionId: string,
	previousStateName: PawSessionStateName,
	issues: readonly PawValidationIssue[],
	lockReleased: boolean,
	reclaimedLock: PawWorkerOnceReclaimedLock | null,
): PawWorkerOnceInvalidTransitionResult {
	return { status: "invalid_transition", sessionId, previousStateName, issues, lockReleased, reclaimedLock };
}

function mapNotLockedResult(
	sessionId: string,
	result: { reason: "unlocked" } | { reason: "stale"; staleReason: PawSessionLockStaleReason },
	lockReleased: boolean,
	reclaimedLock: PawWorkerOnceReclaimedLock | null,
): PawWorkerOnceNotLockedResult {
	return result.reason === "stale"
		? {
				status: "not_locked",
				sessionId,
				reason: "stale",
				staleReason: result.staleReason,
				lockReleased,
				reclaimedLock,
			}
		: { status: "not_locked", sessionId, reason: "unlocked", lockReleased, reclaimedLock };
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

function isFileSystemError(error: unknown): error is FileSystemError {
	return error instanceof Error;
}
