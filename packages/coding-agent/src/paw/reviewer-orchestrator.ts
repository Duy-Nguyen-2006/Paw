import { stat } from "node:fs/promises";
import { relative } from "node:path";
import { getPawSubAgentHandoffCap } from "./context-budget.ts";
import type { PawRuntimeConfig, PawSubAgentOutput, PawValidationIssue } from "./contracts.ts";
import { resolvePawModelRoute } from "./model-routing.ts";
import { resolvePawProjectPaths } from "./persistence.ts";
import { blockPawReviewerResult, type PawReviewerBlockedResult } from "./reviewer-blocked-result.ts";
import { completePawReviewerPass, type PawReviewerPassResult } from "./reviewer-result.ts";
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

export type PawReviewerOnceResult =
	| PawReviewerOnceCompletedResult
	| PawReviewerOnceBlockedResult
	| PawReviewerOnceReviewerFailedResult
	| PawReviewerOnceInvalidStateResult
	| PawReviewerOnceNoSelectedSliceResult
	| PawReviewerOnceInvalidReviewerOutputResult
	| PawReviewerOnceInvalidBlockedReasonResult
	| PawReviewerOnceInvalidTransitionResult
	| PawReviewerOnceMissingProjectResult
	| PawReviewerOnceMissingSessionResult
	| PawReviewerOnceLockedResult
	| PawReviewerOnceNotLockedResult
	| PawReviewerOnceLockedByOtherResult;

export interface PawReviewerOnceInput {
	repoRoot: string;
	sessionId: string;
	config: PawRuntimeConfig;
	executor: PawSubAgentRuntimeExecutor;
	handoff?: string;
	lockOptions?: PawSessionLockOptions;
}

export interface PawReviewerOnceCompletedResult {
	status: "completed";
	sessionId: string;
	selectedSliceId: string;
	previousStateName: PawSessionStateName;
	nextStateName: PawSessionStateName;
	attempts: number;
	journalEntryCount: 0;
	lockReleased: boolean;
	reclaimedLock: PawReviewerOnceReclaimedLock | null;
}

export interface PawReviewerOnceBlockedResult {
	status: "blocked";
	sessionId: string;
	selectedSliceId: string;
	previousStateName: PawSessionStateName;
	nextStateName: PawSessionStateName;
	attempts: number;
	blockedReasonCode: string;
	blockedReasonMessage: string;
	lockReleased: boolean;
	reclaimedLock: PawReviewerOnceReclaimedLock | null;
}

export interface PawReviewerOnceReviewerFailedResult {
	status: "reviewer_failed";
	sessionId: string;
	previousStateName: PawSessionStateName;
	reviewerStatus: PawSubAgentOutput["status"];
	attempts: number;
	lockReleased: boolean;
	reclaimedLock: PawReviewerOnceReclaimedLock | null;
}

export interface PawReviewerOnceInvalidStateResult {
	status: "invalid_state";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
	reclaimedLock: PawReviewerOnceReclaimedLock | null;
}

export interface PawReviewerOnceNoSelectedSliceResult {
	status: "no_selected_slice";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
	reclaimedLock: PawReviewerOnceReclaimedLock | null;
}

export interface PawReviewerOnceInvalidReviewerOutputResult {
	status: "invalid_reviewer_output";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
	reclaimedLock: PawReviewerOnceReclaimedLock | null;
}

export interface PawReviewerOnceInvalidBlockedReasonResult {
	status: "invalid_blocked_reason";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
	reclaimedLock: PawReviewerOnceReclaimedLock | null;
}

export interface PawReviewerOnceInvalidTransitionResult {
	status: "invalid_transition";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
	reclaimedLock: PawReviewerOnceReclaimedLock | null;
}

export interface PawReviewerOnceMissingProjectResult {
	status: "missing_project";
	pawDir: string;
}

export interface PawReviewerOnceMissingSessionResult {
	status: "missing_session";
	sessionId: string;
	stateFile: string;
}

export interface PawReviewerOnceLockedResult {
	status: "locked";
	sessionId: string;
	lock: PawSessionLock;
}

export interface PawReviewerOnceNotLockedResult {
	status: "not_locked";
	sessionId: string;
	reason: "unlocked" | "stale";
	staleReason?: PawSessionLockStaleReason;
	lockReleased: boolean;
	reclaimedLock: PawReviewerOnceReclaimedLock | null;
}

export interface PawReviewerOnceLockedByOtherResult {
	status: "locked_by_other";
	sessionId: string;
	lock: PawSessionLock;
	lockReleased: boolean;
	reclaimedLock: PawReviewerOnceReclaimedLock | null;
}

export interface PawReviewerOnceReclaimedLock {
	reason: PawSessionLockStaleReason;
	lock: PawSessionLock;
}

interface FileSystemError extends Error {
	code?: string;
}

export async function runPawReviewerOnce(input: PawReviewerOnceInput): Promise<PawReviewerOnceResult> {
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
		if (state.name !== "REVIEWING") {
			lockReleased = await releasePawSessionLock(input.repoRoot, input.sessionId, input.lockOptions);
			return {
				status: "invalid_state",
				sessionId: input.sessionId,
				previousStateName: state.name,
				issues: [{ path: "/name", message: "Reviewer orchestration requires REVIEWING state." }],
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
				issues: [{ path: "/current_slice_id", message: "Reviewer orchestration requires a current slice." }],
				lockReleased,
				reclaimedLock,
			};
		}

		const decision = await runReviewerRuntimeWithRetry(input, state.current_slice_id);
		const output = decision.output;
		if (output.status === "pass") {
			const completed = await completePawReviewerPass({
				repoRoot: input.repoRoot,
				sessionId: input.sessionId,
				reviewerOutput: output,
				lockOptions: input.lockOptions,
			});
			lockReleased = await releasePawSessionLock(input.repoRoot, input.sessionId, input.lockOptions);
			return mapReviewerPassResult(input.sessionId, completed, decision.attempts, lockReleased, reclaimedLock);
		}

		if (output.status === "blocked" || output.status === "needs_user_decision") {
			const blocked = await blockPawReviewerResult({
				repoRoot: input.repoRoot,
				sessionId: input.sessionId,
				reviewerOutput: output,
				lockOptions: input.lockOptions,
			});
			lockReleased = await releasePawSessionLock(input.repoRoot, input.sessionId, input.lockOptions);
			return mapReviewerBlockedResult(input.sessionId, blocked, decision.attempts, lockReleased, reclaimedLock);
		}

		lockReleased = await releasePawSessionLock(input.repoRoot, input.sessionId, input.lockOptions);
		return {
			status: "reviewer_failed",
			sessionId: input.sessionId,
			previousStateName: state.name,
			reviewerStatus: output.status,
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

async function runReviewerRuntimeWithRetry(
	input: PawReviewerOnceInput,
	sliceId: string,
): Promise<Extract<PawSubAgentRuntimeDecision, { status: "accepted" | "blocked" }>> {
	let decision: PawSubAgentRuntimeDecision | undefined;
	for (let attempt = 1; attempt <= 2; attempt += 1) {
		decision = await runPawSubAgentRuntime(createReviewerInvocation(input, sliceId, attempt), input.executor);
		if (decision.status !== "retry") {
			return decision;
		}
	}

	if (decision === undefined || decision.status === "retry") {
		throw new Error("Paw reviewer runtime did not produce a terminal decision after retry.");
	}
	return decision;
}

function createReviewerInvocation(
	input: PawReviewerOnceInput,
	sliceId: string,
	attemptNumber: number,
): PawSubAgentRuntimeInvocation {
	const handoff = input.handoff ?? `Review Paw slice ${sliceId} for session ${input.sessionId}.`;
	const route = resolvePawModelRoute(input.config, "reviewer", "standard");
	return {
		role: "reviewer",
		session_id: input.sessionId,
		slice_id: sliceId,
		artifact_ref: `.paw/artifacts/${input.sessionId}/reviewer/report.md`,
		handoff,
		handoff_token_estimate: estimatePawTokens(handoff),
		max_handoff_tokens: getPawSubAgentHandoffCap(input.config.context, "reviewer"),
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

function mapReviewerPassResult(
	sessionId: string,
	completed: PawReviewerPassResult,
	attempts: number,
	lockReleased: boolean,
	reclaimedLock: PawReviewerOnceReclaimedLock | null,
): PawReviewerOnceResult {
	switch (completed.status) {
		case "completed":
			return {
				status: "completed",
				sessionId,
				selectedSliceId: completed.previousState.current_slice_id ?? "",
				previousStateName: completed.previousState.name,
				nextStateName: completed.nextState.name,
				attempts,
				journalEntryCount: 0,
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
		case "invalid_reviewer_output":
			return createInvalidReviewerOutputResult(
				sessionId,
				completed.previousState.name,
				completed.issues,
				lockReleased,
				reclaimedLock,
			);
		case "reviewer_not_passed":
			return {
				status: "reviewer_failed",
				sessionId,
				previousStateName: completed.previousState.name,
				reviewerStatus: completed.reviewerOutput.status,
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

function mapReviewerBlockedResult(
	sessionId: string,
	blocked: PawReviewerBlockedResult,
	attempts: number,
	lockReleased: boolean,
	reclaimedLock: PawReviewerOnceReclaimedLock | null,
): PawReviewerOnceResult {
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
		case "invalid_reviewer_output":
			return createInvalidReviewerOutputResult(
				sessionId,
				blocked.previousState.name,
				blocked.issues,
				lockReleased,
				reclaimedLock,
			);
		case "reviewer_not_blocked":
			return {
				status: "reviewer_failed",
				sessionId,
				previousStateName: blocked.previousState.name,
				reviewerStatus: blocked.reviewerOutput.status,
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
	reclaimedLock: PawReviewerOnceReclaimedLock | null,
): PawReviewerOnceInvalidStateResult {
	return { status: "invalid_state", sessionId, previousStateName, issues, lockReleased, reclaimedLock };
}

function createNoSelectedSliceResult(
	sessionId: string,
	previousStateName: PawSessionStateName,
	issues: readonly PawValidationIssue[],
	lockReleased: boolean,
	reclaimedLock: PawReviewerOnceReclaimedLock | null,
): PawReviewerOnceNoSelectedSliceResult {
	return { status: "no_selected_slice", sessionId, previousStateName, issues, lockReleased, reclaimedLock };
}

function createInvalidReviewerOutputResult(
	sessionId: string,
	previousStateName: PawSessionStateName,
	issues: readonly PawValidationIssue[],
	lockReleased: boolean,
	reclaimedLock: PawReviewerOnceReclaimedLock | null,
): PawReviewerOnceInvalidReviewerOutputResult {
	return { status: "invalid_reviewer_output", sessionId, previousStateName, issues, lockReleased, reclaimedLock };
}

function createInvalidTransitionResult(
	sessionId: string,
	previousStateName: PawSessionStateName,
	issues: readonly PawValidationIssue[],
	lockReleased: boolean,
	reclaimedLock: PawReviewerOnceReclaimedLock | null,
): PawReviewerOnceInvalidTransitionResult {
	return { status: "invalid_transition", sessionId, previousStateName, issues, lockReleased, reclaimedLock };
}

function mapNotLockedResult(
	sessionId: string,
	result: { reason: "unlocked" } | { reason: "stale"; staleReason: PawSessionLockStaleReason },
	lockReleased: boolean,
	reclaimedLock: PawReviewerOnceReclaimedLock | null,
): PawReviewerOnceNotLockedResult {
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
