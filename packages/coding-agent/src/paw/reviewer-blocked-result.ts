
import { hostname } from "node:os";
import type { PawSubAgentOutput, PawValidationIssue, PawValidationResult } from "./contracts.ts";
import type { PawSessionLock, PawSessionLockOptions, PawSessionLockStaleReason } from "./session-store.ts";
import { getPawSessionLockStatus, readPawSessionState, writePawSessionState } from "./session-store.ts";
import {
	PAW_BLOCKED_REASON_CODES,
	type PawBlockedReasonCode,
	type PawBlockedStateName,
	type PawSessionState,
	transitionPawSessionState,
} from "./state.ts";

export interface PawReviewerBlockedInput {
	repoRoot: string;
	sessionId: string;
	reviewerOutput: PawSubAgentOutput;
	lockOptions?: PawSessionLockOptions;
}

export type PawReviewerBlockedResult =
	| PawReviewerBlockedCompletedResult
	| PawReviewerBlockedNotLockedResult
	| PawReviewerBlockedLockedByOtherResult
	| PawReviewerBlockedInvalidStateResult
	| PawReviewerBlockedNoSelectedSliceResult
	| PawReviewerBlockedInvalidOutputResult
	| PawReviewerBlockedNotBlockedResult
	| PawReviewerBlockedInvalidReasonResult
	| PawReviewerBlockedInvalidTransitionResult;

export interface PawReviewerBlockedCompletedResult {
	status: "blocked";
	lock: PawSessionLock;
	previousState: PawSessionState;
	nextState: PawSessionState;
	reviewerOutput: PawSubAgentOutput;
}

export type PawReviewerBlockedNotLockedResult =
	| {
			status: "not_locked";
			reason: "unlocked";
	  }
	| {
			status: "not_locked";
			reason: "stale";
			staleReason: PawSessionLockStaleReason;
			lock: PawSessionLock;
	  };

export interface PawReviewerBlockedLockedByOtherResult {
	status: "locked_by_other";
	lock: PawSessionLock;
	expectedOwner: PawReviewerBlockedLockOwner;
}

export interface PawReviewerBlockedInvalidStateResult {
	status: "invalid_state";
	previousState: PawSessionState;
	issues: readonly PawValidationIssue[];
}

export interface PawReviewerBlockedNoSelectedSliceResult {
	status: "no_selected_slice";
	previousState: PawSessionState;
	issues: readonly PawValidationIssue[];
}

export interface PawReviewerBlockedInvalidOutputResult {
	status: "invalid_reviewer_output";
	previousState: PawSessionState;
	reviewerOutput: PawSubAgentOutput;
	issues: readonly PawValidationIssue[];
}

export interface PawReviewerBlockedNotBlockedResult {
	status: "reviewer_not_blocked";
	previousState: PawSessionState;
	reviewerOutput: PawSubAgentOutput;
}

export interface PawReviewerBlockedInvalidReasonResult {
	status: "invalid_blocked_reason";
	previousState: PawSessionState;
	reviewerOutput: PawSubAgentOutput;
	issues: readonly PawValidationIssue[];
}

export interface PawReviewerBlockedInvalidTransitionResult {
	status: "invalid_transition";
	previousState: PawSessionState;
	issues: readonly PawValidationIssue[];
}

export interface PawReviewerBlockedLockOwner {
	pid: number;
	host: string;
}

interface ValidPawReviewerBlockedReason {
	code: PawBlockedReasonCode;
	message: string;
	suggested_action: string;
}

export async function blockPawReviewerResult(input: PawReviewerBlockedInput): Promise<PawReviewerBlockedResult> {
	const lockOptions = input.lockOptions ?? {};
	const lockStatus = await getPawSessionLockStatus(input.repoRoot, input.sessionId, lockOptions);
	if (lockStatus.status === "unlocked") {
		return {
			status: "not_locked",
			reason: "unlocked",
		};
	}
	if (lockStatus.status === "stale") {
		return {
			status: "not_locked",
			reason: "stale",
			staleReason: lockStatus.reason,
			lock: lockStatus.lock,
		};
	}

	const expectedOwner = getPawReviewerBlockedLockOwner(lockOptions);
	if (!isPawReviewerBlockedLockOwner(lockStatus.lock, expectedOwner)) {
		return {
			status: "locked_by_other",
			lock: lockStatus.lock,
			expectedOwner,
		};
	}

	const previousState = await readPawSessionState(input.repoRoot, input.sessionId);
	if (previousState.name !== "REVIEWING") {
		return {
			status: "invalid_state",
			previousState,
			issues: [
				{
					path: "/name",
					message: "Reviewer blocked result requires REVIEWING state.",
				},
			],
		};
	}
	if (previousState.current_slice_id === null) {
		return {
			status: "no_selected_slice",
			previousState,
			issues: [
				{
					path: "/current_slice_id",
					message: "Reviewer blocked result requires a current slice.",
				},
			],
		};
	}

	const outputIssues = validateReviewerBlockedOutput(
		input.reviewerOutput,
		input.sessionId,
		previousState.current_slice_id,
	);
	if (outputIssues.length > 0) {
		return {
			status: "invalid_reviewer_output",
			previousState,
			reviewerOutput: input.reviewerOutput,
			issues: outputIssues,
		};
	}
	if (input.reviewerOutput.status !== "blocked" && input.reviewerOutput.status !== "needs_user_decision") {
		return {
			status: "reviewer_not_blocked",
			previousState,
			reviewerOutput: input.reviewerOutput,
		};
	}

	const reasonValidation = validateBlockedReason(input.reviewerOutput);
	if (!reasonValidation.ok) {
		return {
			status: "invalid_blocked_reason",
			previousState,
			reviewerOutput: input.reviewerOutput,
			issues: reasonValidation.issues,
		};
	}

	const blockedReason = reasonValidation.value;
	const transitioned = transitionPawSessionState(previousState, {
		to: getBlockedStateName(blockedReason.code),
		blocked_reason: {
			code: blockedReason.code,
			message: blockedReason.message,
			suggested_action: blockedReason.suggested_action,
			slice_id: previousState.current_slice_id,
		},
	});
	if (!transitioned.ok) {
		return {
			status: "invalid_transition",
			previousState,
			issues: transitioned.issues,
		};
	}

	await writePawSessionState(input.repoRoot, transitioned.value);
	return {
		status: "blocked",
		lock: lockStatus.lock,
		previousState,
		nextState: transitioned.value,
		reviewerOutput: input.reviewerOutput,
	};
}

function validateReviewerBlockedOutput(
	reviewerOutput: PawSubAgentOutput,
	sessionId: string,
	currentSliceId: string,
): PawValidationIssue[] {
	const issues: PawValidationIssue[] = [];
	if (reviewerOutput.agent !== "reviewer") {
		issues.push({
			path: "/agent",
			message: 'Reviewer blocked result requires agent "reviewer".',
		});
	}
	if (reviewerOutput.session_id !== sessionId) {
		issues.push({
			path: "/session_id",
			message: `Reviewer output session id must match ${sessionId}.`,
		});
	}
	if (reviewerOutput.slice_id !== currentSliceId) {
		issues.push({
			path: "/slice_id",
			message: `Reviewer output slice id must match ${currentSliceId}.`,
		});
	}

	return issues;
}

function validateBlockedReason(reviewerOutput: PawSubAgentOutput): PawValidationResult<ValidPawReviewerBlockedReason> {
	const issues: PawValidationIssue[] = [];
	const blockedReason = reviewerOutput.blocked_reason;
	if (blockedReason === undefined || blockedReason === null) {
		return {
			ok: false,
			issues: [
				{
					path: "/blocked_reason",
					message: "Reviewer blocked result requires blocked_reason metadata.",
				},
			],
		};
	}
	const code = blockedReason.code;
	const message = blockedReason.message;
	const suggestedAction = blockedReason.suggested_action;
	const hasValidCode = isPawBlockedReasonCode(code);
	const hasValidMessage = message !== undefined && message.trim() !== "";
	const hasValidSuggestedAction = suggestedAction !== undefined && suggestedAction.trim() !== "";

	if (!hasValidCode) {
		issues.push({
			path: "/blocked_reason/code",
			message: "Reviewer blocked reason code is invalid.",
		});
	}
	if (!hasValidMessage) {
		issues.push({
			path: "/blocked_reason/message",
			message: "Reviewer blocked reason message is required.",
		});
	}
	if (!hasValidSuggestedAction) {
		issues.push({
			path: "/blocked_reason/suggested_action",
			message: "Reviewer blocked reason suggested action is required.",
		});
	}
	if (!hasValidCode || !hasValidMessage || !hasValidSuggestedAction) {
		return { ok: false, issues };
	}

	return {
		ok: true,
		value: {
			code,
			message,
			suggested_action: suggestedAction,
		},
	};
}

function getBlockedStateName(code: PawBlockedReasonCode): PawBlockedStateName {
	return `BLOCKED_${code}`;
}

function isPawBlockedReasonCode(code: string | undefined): code is PawBlockedReasonCode {
	if (code === undefined) return false;
	return PAW_BLOCKED_REASON_CODES.includes(code as PawBlockedReasonCode);
}

function getPawReviewerBlockedLockOwner(options: PawSessionLockOptions): PawReviewerBlockedLockOwner {
	return {
		pid: options.pid ?? process.pid,
		host: options.host ?? hostname(),
	};
}

function isPawReviewerBlockedLockOwner(lock: PawSessionLock, owner: PawReviewerBlockedLockOwner): boolean {
	return lock.pid === owner.pid && lock.host === owner.host;
}
