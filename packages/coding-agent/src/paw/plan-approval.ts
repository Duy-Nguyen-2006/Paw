import type { PawValidationIssue } from "./contracts.ts";
import { createPawPlanSliceQueue, type PawPlanSliceQueue } from "./plan-slices.ts";
import type { PawSessionLockOptions } from "./session-store.ts";
import type {
	PawTaskSessionAdvancedResult,
	PawTaskSessionAdvanceResult,
	PawTaskSessionInvalidTransitionResult,
	PawTaskSessionLockedByOtherResult,
	PawTaskSessionNotLockedResult,
} from "./task-session.ts";
import { advancePawTaskSession } from "./task-session.ts";

export interface PawPlanApprovalInput {
	repoRoot: string;
	sessionId: string;
	plannerSlices: unknown;
	lockOptions?: PawSessionLockOptions;
}

export type PawPlanApprovalResult = PawPlanApprovalInvalidPlanResult | PawPlanApprovalTransitionResult;

export interface PawPlanApprovalInvalidPlanResult {
	status: "invalid_plan";
	issues: readonly PawValidationIssue[];
}

export type PawPlanApprovalTransitionResult =
	| PawPlanApprovalAdvancedResult
	| PawPlanApprovalInvalidTransitionResult
	| PawPlanApprovalNotLockedResult
	| PawPlanApprovalLockedByOtherResult;

export interface PawPlanApprovalAdvancedResult {
	status: "advanced";
	queue: PawPlanSliceQueue;
	advance: PawTaskSessionAdvancedResult;
}

export interface PawPlanApprovalInvalidTransitionResult {
	status: "invalid_transition";
	queue: PawPlanSliceQueue;
	advance: PawTaskSessionInvalidTransitionResult;
}

export interface PawPlanApprovalNotLockedResult {
	status: "not_locked";
	queue: PawPlanSliceQueue;
	advance: PawTaskSessionNotLockedResult;
}

export interface PawPlanApprovalLockedByOtherResult {
	status: "locked_by_other";
	queue: PawPlanSliceQueue;
	advance: PawTaskSessionLockedByOtherResult;
}

export async function approvePawPlanSlices(input: PawPlanApprovalInput): Promise<PawPlanApprovalResult> {
	const queueResult = createPawPlanSliceQueue(input.plannerSlices);
	if (!queueResult.ok) {
		return {
			status: "invalid_plan",
			issues: queueResult.issues,
		};
	}

	const advance = await advancePawTaskSession({
		repoRoot: input.repoRoot,
		sessionId: input.sessionId,
		transition: {
			to: "PLAN_APPROVED",
			slice_ids: queueResult.value.slice_ids,
		},
		lockOptions: input.lockOptions,
	});

	return createPawPlanApprovalTransitionResult(queueResult.value, advance);
}

function createPawPlanApprovalTransitionResult(
	queue: PawPlanSliceQueue,
	advance: PawTaskSessionAdvanceResult,
): PawPlanApprovalTransitionResult {
	switch (advance.status) {
		case "advanced":
			return { status: "advanced", queue, advance };
		case "invalid_transition":
			return { status: "invalid_transition", queue, advance };
		case "not_locked":
			return { status: "not_locked", queue, advance };
		case "locked_by_other":
			return { status: "locked_by_other", queue, advance };
	}
}
