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

export interface PawWorkerBlockedInput {
	repoRoot: string;
	sessionId: string;
	workerOutput: PawSubAgentOutput;
	lockOptions?: PawSessionLockOptions;
}

export type PawWorkerBlockedResult =
	| PawWorkerBlockedCompletedResult
	| PawWorkerBlockedNotLockedResult
	| PawWorkerBlockedLockedByOtherResult
	| PawWorkerBlockedInvalidStateResult
	| PawWorkerBlockedNoSelectedSliceResult
	| PawWorkerBlockedInvalidOutputResult
	| PawWorkerBlockedNotBlockedResult
	| PawWorkerBlockedInvalidReasonResult
	| PawWorkerBlockedInvalidTransitionResult;

export interface PawWorkerBlockedCompletedResult {
	status: "blocked";
	lock: PawSessionLock;
	previousState: PawSessionState;
	nextState: PawSessionState;
	workerOutput: PawSubAgentOutput;
}

export type PawWorkerBlockedNotLockedResult =
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

export interface PawWorkerBlockedLockedByOtherResult {
	status: "locked_by_other";
	lock: PawSessionLock;
	expectedOwner: PawWorkerBlockedLockOwner;
}

export interface PawWorkerBlockedInvalidStateResult {
	status: "invalid_state";
	previousState: PawSessionState;
	issues: readonly PawValidationIssue[];
}

export interface PawWorkerBlockedNoSelectedSliceResult {
	status: "no_selected_slice";
	previousState: PawSessionState;
	issues: readonly PawValidationIssue[];
}

export interface PawWorkerBlockedInvalidOutputResult {
	status: "invalid_worker_output";
	previousState: PawSessionState;
	workerOutput: PawSubAgentOutput;
	issues: readonly PawValidationIssue[];
}

export interface PawWorkerBlockedNotBlockedResult {
	status: "worker_not_blocked";
	previousState: PawSessionState;
	workerOutput: PawSubAgentOutput;
}

export interface PawWorkerBlockedInvalidReasonResult {
	status: "invalid_blocked_reason";
	previousState: PawSessionState;
	workerOutput: PawSubAgentOutput;
	issues: readonly PawValidationIssue[];
}

export interface PawWorkerBlockedInvalidTransitionResult {
	status: "invalid_transition";
	previousState: PawSessionState;
	issues: readonly PawValidationIssue[];
}

export interface PawWorkerBlockedLockOwner {
	pid: number;
	host: string;
}

interface ValidPawWorkerBlockedReason {
	code: PawBlockedReasonCode;
	message: string;
	suggested_action: string;
}

export async function blockPawWorkerResult(input: PawWorkerBlockedInput): Promise<PawWorkerBlockedResult> {
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

	const expectedOwner = getPawWorkerBlockedLockOwner(lockOptions);
	if (!isPawWorkerBlockedLockOwner(lockStatus.lock, expectedOwner)) {
		return {
			status: "locked_by_other",
			lock: lockStatus.lock,
			expectedOwner,
		};
	}

	const previousState = await readPawSessionState(input.repoRoot, input.sessionId);
	if (previousState.name !== "IMPLEMENTING") {
		return {
			status: "invalid_state",
			previousState,
			issues: [
				{
					path: "/name",
					message: "Worker blocked result requires IMPLEMENTING state.",
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
					message: "Worker blocked result requires a current slice.",
				},
			],
		};
	}

	const outputIssues = validateWorkerBlockedOutput(
		input.workerOutput,
		input.sessionId,
		previousState.current_slice_id,
	);
	if (outputIssues.length > 0) {
		return {
			status: "invalid_worker_output",
			previousState,
			workerOutput: input.workerOutput,
			issues: outputIssues,
		};
	}
	if (input.workerOutput.status !== "blocked" && input.workerOutput.status !== "needs_user_decision") {
		return {
			status: "worker_not_blocked",
			previousState,
			workerOutput: input.workerOutput,
		};
	}

	const reasonValidation = validateBlockedReason(input.workerOutput);
	if (!reasonValidation.ok) {
		return {
			status: "invalid_blocked_reason",
			previousState,
			workerOutput: input.workerOutput,
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
		workerOutput: input.workerOutput,
	};
}

function validateWorkerBlockedOutput(
	workerOutput: PawSubAgentOutput,
	sessionId: string,
	currentSliceId: string,
): PawValidationIssue[] {
	const issues: PawValidationIssue[] = [];
	if (workerOutput.agent !== "worker") {
		issues.push({
			path: "/agent",
			message: 'Worker blocked result requires agent "worker".',
		});
	}
	if (workerOutput.session_id !== sessionId) {
		issues.push({
			path: "/session_id",
			message: `Worker output session id must match ${sessionId}.`,
		});
	}
	if (workerOutput.slice_id !== currentSliceId) {
		issues.push({
			path: "/slice_id",
			message: `Worker output slice id must match ${currentSliceId}.`,
		});
	}

	return issues;
}

function validateBlockedReason(workerOutput: PawSubAgentOutput): PawValidationResult<ValidPawWorkerBlockedReason> {
	const issues: PawValidationIssue[] = [];
	const blockedReason = workerOutput.blocked_reason;
	if (blockedReason === undefined || blockedReason === null) {
		return {
			ok: false,
			issues: [
				{
					path: "/blocked_reason",
					message: "Worker blocked result requires blocked_reason metadata.",
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
			message: "Worker blocked reason code is invalid.",
		});
	}
	if (!hasValidMessage) {
		issues.push({
			path: "/blocked_reason/message",
			message: "Worker blocked reason message is required.",
		});
	}
	if (!hasValidSuggestedAction) {
		issues.push({
			path: "/blocked_reason/suggested_action",
			message: "Worker blocked reason suggested action is required.",
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

function getPawWorkerBlockedLockOwner(options: PawSessionLockOptions): PawWorkerBlockedLockOwner {
	return {
		pid: options.pid ?? process.pid,
		host: options.host ?? hostname(),
	};
}

function isPawWorkerBlockedLockOwner(lock: PawSessionLock, owner: PawWorkerBlockedLockOwner): boolean {
	return lock.pid === owner.pid && lock.host === owner.host;
}
