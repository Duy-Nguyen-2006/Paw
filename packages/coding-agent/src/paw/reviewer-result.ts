
import { hostname } from "node:os";
import type { PawSubAgentOutput, PawValidationIssue } from "./contracts.ts";
import type { PawSessionLock, PawSessionLockOptions, PawSessionLockStaleReason } from "./session-store.ts";
import { getPawSessionLockStatus, readPawSessionState, writePawSessionState } from "./session-store.ts";
import type { PawSessionState } from "./state.ts";
import { transitionPawSessionState } from "./state.ts";

export interface PawReviewerPassInput {
	repoRoot: string;
	sessionId: string;
	reviewerOutput: PawSubAgentOutput;
	lockOptions?: PawSessionLockOptions;
}

export type PawReviewerPassResult =
	| PawReviewerPassCompletedResult
	| PawReviewerPassNotLockedResult
	| PawReviewerPassLockedByOtherResult
	| PawReviewerPassInvalidStateResult
	| PawReviewerPassNoSelectedSliceResult
	| PawReviewerPassInvalidOutputResult
	| PawReviewerPassNotPassedResult
	| PawReviewerPassInvalidTransitionResult;

export interface PawReviewerPassCompletedResult {
	status: "completed";
	lock: PawSessionLock;
	previousState: PawSessionState;
	nextState: PawSessionState;
	reviewerOutput: PawSubAgentOutput;
}

export type PawReviewerPassNotLockedResult =
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

export interface PawReviewerPassLockedByOtherResult {
	status: "locked_by_other";
	lock: PawSessionLock;
	expectedOwner: PawReviewerPassLockOwner;
}

export interface PawReviewerPassInvalidStateResult {
	status: "invalid_state";
	previousState: PawSessionState;
	issues: readonly PawValidationIssue[];
}

export interface PawReviewerPassNoSelectedSliceResult {
	status: "no_selected_slice";
	previousState: PawSessionState;
	issues: readonly PawValidationIssue[];
}

export interface PawReviewerPassInvalidOutputResult {
	status: "invalid_reviewer_output";
	previousState: PawSessionState;
	reviewerOutput: PawSubAgentOutput;
	issues: readonly PawValidationIssue[];
}

export interface PawReviewerPassNotPassedResult {
	status: "reviewer_not_passed";
	previousState: PawSessionState;
	reviewerOutput: PawSubAgentOutput;
}

export interface PawReviewerPassInvalidTransitionResult {
	status: "invalid_transition";
	previousState: PawSessionState;
	issues: readonly PawValidationIssue[];
}

export interface PawReviewerPassLockOwner {
	pid: number;
	host: string;
}

export async function completePawReviewerPass(input: PawReviewerPassInput): Promise<PawReviewerPassResult> {
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

	const expectedOwner = getPawReviewerPassLockOwner(lockOptions);
	if (!isPawReviewerPassLockOwner(lockStatus.lock, expectedOwner)) {
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
					message: "Reviewer pass completion requires REVIEWING state.",
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
					message: "Reviewer pass completion requires a current slice.",
				},
			],
		};
	}

	const outputIssues = validateReviewerOutput(input.reviewerOutput, input.sessionId, previousState.current_slice_id);
	if (outputIssues.length > 0) {
		return {
			status: "invalid_reviewer_output",
			previousState,
			reviewerOutput: input.reviewerOutput,
			issues: outputIssues,
		};
	}
	if (input.reviewerOutput.status !== "pass") {
		return {
			status: "reviewer_not_passed",
			previousState,
			reviewerOutput: input.reviewerOutput,
		};
	}

	const transitioned = transitionPawSessionState(previousState, { to: "VERIFYING" });
	if (!transitioned.ok) {
		return {
			status: "invalid_transition",
			previousState,
			issues: transitioned.issues,
		};
	}

	await writePawSessionState(input.repoRoot, transitioned.value);
	return {
		status: "completed",
		lock: lockStatus.lock,
		previousState,
		nextState: transitioned.value,
		reviewerOutput: input.reviewerOutput,
	};
}

function validateReviewerOutput(
	reviewerOutput: PawSubAgentOutput,
	sessionId: string,
	currentSliceId: string,
): PawValidationIssue[] {
	const issues: PawValidationIssue[] = [];
	if (reviewerOutput.agent !== "reviewer") {
		issues.push({
			path: "/agent",
			message: 'Reviewer pass completion requires agent "reviewer".',
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

function getPawReviewerPassLockOwner(options: PawSessionLockOptions): PawReviewerPassLockOwner {
	return {
		pid: options.pid ?? process.pid,
		host: options.host ?? hostname(),
	};
}

function isPawReviewerPassLockOwner(lock: PawSessionLock, owner: PawReviewerPassLockOwner): boolean {
	return lock.pid === owner.pid && lock.host === owner.host;
}
