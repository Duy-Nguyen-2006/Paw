import type { PawSessionLockOptions } from "./session-store.ts";
import type { PawSessionState } from "./state.ts";
import {
	advancePawTaskSession,
	type PawTaskSessionAdvancedResult,
	type PawTaskSessionAdvanceResult,
	type PawTaskSessionInvalidTransitionResult,
	type PawTaskSessionLockedByOtherResult,
	type PawTaskSessionNotLockedResult,
} from "./task-session.ts";

export interface PawSliceSelectionInput {
	repoRoot: string;
	sessionId: string;
	lockOptions?: PawSessionLockOptions;
}

export type PawSliceSelectionResult =
	| PawSliceSelectionAdvancedResult
	| PawSliceSelectionNoPendingResult
	| PawSliceSelectionInvalidTransitionResult
	| PawSliceSelectionNotLockedResult
	| PawSliceSelectionLockedByOtherResult;

export interface PawSliceSelectionAdvancedResult {
	status: "advanced";
	selectedSliceId: string;
	advance: PawTaskSessionAdvancedResult;
}

export interface PawSliceSelectionNoPendingResult {
	status: "no_pending_slices";
	previousState: PawSessionState;
}

export interface PawSliceSelectionInvalidTransitionResult {
	status: "invalid_transition";
	advance: PawTaskSessionInvalidTransitionResult;
}

export interface PawSliceSelectionNotLockedResult {
	status: "not_locked";
	advance: PawTaskSessionNotLockedResult;
}

export interface PawSliceSelectionLockedByOtherResult {
	status: "locked_by_other";
	advance: PawTaskSessionLockedByOtherResult;
}

export async function selectNextPawPlanSlice(input: PawSliceSelectionInput): Promise<PawSliceSelectionResult> {
	const advance = await advancePawTaskSession({
		repoRoot: input.repoRoot,
		sessionId: input.sessionId,
		transition: { to: "SLICE_SELECT" },
		lockOptions: input.lockOptions,
	});

	return createPawSliceSelectionResult(advance);
}

function createPawSliceSelectionResult(advance: PawTaskSessionAdvanceResult): PawSliceSelectionResult {
	switch (advance.status) {
		case "advanced": {
			const selectedSliceId = advance.nextState.current_slice_id;
			if (selectedSliceId === null) {
				throw new Error("SLICE_SELECT advanced without a selected slice id.");
			}
			return { status: "advanced", selectedSliceId, advance };
		}
		case "invalid_transition":
			if (isNoPendingSliceSelection(advance)) {
				return { status: "no_pending_slices", previousState: advance.previousState };
			}
			return { status: "invalid_transition", advance };
		case "not_locked":
			return { status: "not_locked", advance };
		case "locked_by_other":
			return { status: "locked_by_other", advance };
	}
}

function isNoPendingSliceSelection(advance: PawTaskSessionInvalidTransitionResult): boolean {
	return (
		(advance.previousState.name === "PLAN_APPROVED" || advance.previousState.name === "SLICE_DONE") &&
		advance.previousState.pending_slice_ids.length === 0 &&
		advance.issues.some((issue) => issue.path === "/pending_slice_ids")
	);
}
