import { hostname } from "node:os";
import type { PawValidationIssue, PawValidationResult } from "./contracts.ts";
import type { PawSessionLock, PawSessionLockOptions, PawSessionLockStaleReason } from "./session-store.ts";
import { getPawSessionLockStatus, readPawSessionState, writePawSessionState } from "./session-store.ts";
import {
	PAW_BLOCKED_REASON_CODES,
	type PawBlockedReasonCode,
	type PawBlockedReasonInput,
	type PawBlockedStateName,
	type PawSessionState,
	transitionPawSessionState,
} from "./state.ts";

export interface PawVerifierBlockedInput {
	repoRoot: string;
	sessionId: string;
	blockedReason: PawBlockedReasonInput;
	lockOptions?: PawSessionLockOptions;
}

export type PawVerifierBlockedResult =
	| PawVerifierBlockedCompletedResult
	| PawVerifierBlockedNotLockedResult
	| PawVerifierBlockedLockedByOtherResult
	| PawVerifierBlockedInvalidStateResult
	| PawVerifierBlockedNoSelectedSliceResult
	| PawVerifierBlockedInvalidReasonResult
	| PawVerifierBlockedInvalidTransitionResult;

export interface PawVerifierBlockedCompletedResult {
	status: "blocked";
	lock: PawSessionLock;
	previousState: PawSessionState;
	nextState: PawSessionState;
}

export type PawVerifierBlockedNotLockedResult =
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

export interface PawVerifierBlockedLockedByOtherResult {
	status: "locked_by_other";
	lock: PawSessionLock;
	expectedOwner: PawVerifierBlockedLockOwner;
}

export interface PawVerifierBlockedInvalidStateResult {
	status: "invalid_state";
	previousState: PawSessionState;
	issues: readonly PawValidationIssue[];
}

export interface PawVerifierBlockedNoSelectedSliceResult {
	status: "no_selected_slice";
	previousState: PawSessionState;
	issues: readonly PawValidationIssue[];
}

export interface PawVerifierBlockedInvalidReasonResult {
	status: "invalid_blocked_reason";
	previousState: PawSessionState;
	issues: readonly PawValidationIssue[];
}

export interface PawVerifierBlockedInvalidTransitionResult {
	status: "invalid_transition";
	previousState: PawSessionState;
	issues: readonly PawValidationIssue[];
}

export interface PawVerifierBlockedLockOwner {
	pid: number;
	host: string;
}

interface ValidPawVerifierBlockedReason {
	code: PawBlockedReasonCode;
	message: string;
	suggested_action: string;
}

export async function blockPawVerifierResult(input: PawVerifierBlockedInput): Promise<PawVerifierBlockedResult> {
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

	const expectedOwner = getPawVerifierBlockedLockOwner(lockOptions);
	if (!isPawVerifierBlockedLockOwner(lockStatus.lock, expectedOwner)) {
		return {
			status: "locked_by_other",
			lock: lockStatus.lock,
			expectedOwner,
		};
	}

	const previousState = await readPawSessionState(input.repoRoot, input.sessionId);
	if (previousState.name !== "VERIFYING") {
		return {
			status: "invalid_state",
			previousState,
			issues: [
				{
					path: "/name",
					message: "Verifier blocked result requires VERIFYING state.",
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
					message: "Verifier blocked result requires a current slice.",
				},
			],
		};
	}

	const reasonValidation = validateBlockedReason(input.blockedReason);
	if (!reasonValidation.ok) {
		return {
			status: "invalid_blocked_reason",
			previousState,
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
	};
}

function validateBlockedReason(
	blockedReason: PawBlockedReasonInput,
): PawValidationResult<ValidPawVerifierBlockedReason> {
	const issues: PawValidationIssue[] = [];
	const code = blockedReason.code;
	const message = blockedReason.message;
	const suggestedAction = blockedReason.suggested_action;
	const hasValidCode = isPawBlockedReasonCode(code);
	const hasValidMessage = message.trim() !== "";
	const hasValidSuggestedAction = suggestedAction.trim() !== "";

	if (!hasValidCode) {
		issues.push({
			path: "/blocked_reason/code",
			message: "Verifier blocked reason code is invalid.",
		});
	}
	if (!hasValidMessage) {
		issues.push({
			path: "/blocked_reason/message",
			message: "Verifier blocked reason message is required.",
		});
	}
	if (!hasValidSuggestedAction) {
		issues.push({
			path: "/blocked_reason/suggested_action",
			message: "Verifier blocked reason suggested action is required.",
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

function getPawVerifierBlockedLockOwner(options: PawSessionLockOptions): PawVerifierBlockedLockOwner {
	return {
		pid: options.pid ?? process.pid,
		host: options.host ?? hostname(),
	};
}

function isPawVerifierBlockedLockOwner(lock: PawSessionLock, owner: PawVerifierBlockedLockOwner): boolean {
	return lock.pid === owner.pid && lock.host === owner.host;
}
