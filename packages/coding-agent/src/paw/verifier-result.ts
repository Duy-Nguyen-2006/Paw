import { hostname } from "node:os";
import type { PawValidationIssue } from "./contracts.ts";
import type { PawVerifyGateDecision } from "./resilience-policy.ts";
import type { PawSessionLock, PawSessionLockOptions, PawSessionLockStaleReason } from "./session-store.ts";
import { getPawSessionLockStatus, readPawSessionState, writePawSessionState } from "./session-store.ts";
import type { PawSessionState } from "./state.ts";
import { transitionPawSessionState } from "./state.ts";

export interface PawVerificationInput {
	repoRoot: string;
	sessionId: string;
	verifyDecisions: readonly PawVerifyGateDecision[];
	lockOptions?: PawSessionLockOptions;
}

export type PawVerificationResult =
	| PawVerificationCompletedResult
	| PawVerificationCompletedWithUnverifiedResult
	| PawVerificationNotLockedResult
	| PawVerificationLockedByOtherResult
	| PawVerificationInvalidStateResult
	| PawVerificationNoSelectedSliceResult
	| PawVerificationInvalidDecisionsResult
	| PawVerificationInvalidTransitionResult;

export interface PawVerificationCompletedResult {
	status: "completed";
	lock: PawSessionLock;
	previousState: PawSessionState;
	nextState: PawSessionState;
	verifyDecisions: readonly PawVerifyGateDecision[];
	unverifiedDecisions: readonly PawVerifyGateDecision[];
}

export interface PawVerificationCompletedWithUnverifiedResult {
	status: "completed_with_unverified";
	lock: PawSessionLock;
	previousState: PawSessionState;
	nextState: PawSessionState;
	verifyDecisions: readonly PawVerifyGateDecision[];
	unverifiedDecisions: readonly PawVerifyGateDecision[];
}

export type PawVerificationNotLockedResult =
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

export interface PawVerificationLockedByOtherResult {
	status: "locked_by_other";
	lock: PawSessionLock;
	expectedOwner: PawVerificationLockOwner;
}

export interface PawVerificationInvalidStateResult {
	status: "invalid_state";
	previousState: PawSessionState;
	issues: readonly PawValidationIssue[];
}

export interface PawVerificationNoSelectedSliceResult {
	status: "no_selected_slice";
	previousState: PawSessionState;
	issues: readonly PawValidationIssue[];
}

export interface PawVerificationInvalidDecisionsResult {
	status: "invalid_verify_decisions";
	previousState: PawSessionState;
	issues: readonly PawValidationIssue[];
}

export interface PawVerificationInvalidTransitionResult {
	status: "invalid_transition";
	previousState: PawSessionState;
	issues: readonly PawValidationIssue[];
}

export interface PawVerificationLockOwner {
	pid: number;
	host: string;
}

export async function completePawVerification(input: PawVerificationInput): Promise<PawVerificationResult> {
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

	const expectedOwner = getPawVerificationLockOwner(lockOptions);
	if (!isPawVerificationLockOwner(lockStatus.lock, expectedOwner)) {
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
					message: "Verification completion requires VERIFYING state.",
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
					message: "Verification completion requires a current slice.",
				},
			],
		};
	}

	if (input.verifyDecisions.length === 0) {
		return {
			status: "invalid_verify_decisions",
			previousState,
			issues: [
				{
					path: "/verify_decisions",
					message: "Verification completion requires at least one gate decision.",
				},
			],
		};
	}

	const transitioned = transitionPawSessionState(previousState, { to: "SLICE_DONE" });
	if (!transitioned.ok) {
		return {
			status: "invalid_transition",
			previousState,
			issues: transitioned.issues,
		};
	}

	await writePawSessionState(input.repoRoot, transitioned.value);
	const unverifiedDecisions = input.verifyDecisions.filter((decision) => decision.status === "unverified");
	return {
		status: unverifiedDecisions.length > 0 ? "completed_with_unverified" : "completed",
		lock: lockStatus.lock,
		previousState,
		nextState: transitioned.value,
		verifyDecisions: input.verifyDecisions,
		unverifiedDecisions,
	};
}

function getPawVerificationLockOwner(options: PawSessionLockOptions): PawVerificationLockOwner {
	return {
		pid: options.pid ?? process.pid,
		host: options.host ?? hostname(),
	};
}

function isPawVerificationLockOwner(lock: PawSessionLock, owner: PawVerificationLockOwner): boolean {
	return lock.pid === owner.pid && lock.host === owner.host;
}
