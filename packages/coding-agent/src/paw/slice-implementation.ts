
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

export interface PawSliceImplementationInput {
	repoRoot: string;
	sessionId: string;
	lockOptions?: PawSessionLockOptions;
}

export type PawSliceImplementationResult =
	| PawSliceImplementationAdvancedResult
	| PawSliceImplementationNoSelectedSliceResult
	| PawSliceImplementationInvalidTransitionResult
	| PawSliceImplementationNotLockedResult
	| PawSliceImplementationLockedByOtherResult;

export interface PawSliceImplementationAdvancedResult {
	status: "advanced";
	selectedSliceId: string;
	advance: PawTaskSessionAdvancedResult;
}

export interface PawSliceImplementationNoSelectedSliceResult {
	status: "no_selected_slice";
	previousState: PawSessionState;
	advance: PawTaskSessionInvalidTransitionResult;
}

export interface PawSliceImplementationInvalidTransitionResult {
	status: "invalid_transition";
	advance: PawTaskSessionInvalidTransitionResult;
}

export interface PawSliceImplementationNotLockedResult {
	status: "not_locked";
	advance: PawTaskSessionNotLockedResult;
}

export interface PawSliceImplementationLockedByOtherResult {
	status: "locked_by_other";
	advance: PawTaskSessionLockedByOtherResult;
}

export async function beginPawSliceImplementation(
	input: PawSliceImplementationInput,
): Promise<PawSliceImplementationResult> {
	const advance = await advancePawTaskSession({
		repoRoot: input.repoRoot,
		sessionId: input.sessionId,
		transition: { to: "IMPLEMENTING" },
		lockOptions: input.lockOptions,
	});

	return createPawSliceImplementationResult(advance);
}

function createPawSliceImplementationResult(advance: PawTaskSessionAdvanceResult): PawSliceImplementationResult {
	switch (advance.status) {
		case "advanced": {
			const selectedSliceId = advance.nextState.current_slice_id;
			if (selectedSliceId === null) {
				throw new Error("IMPLEMENTING advanced without a selected slice id.");
			}
			return { status: "advanced", selectedSliceId, advance };
		}
		case "invalid_transition":
			if (isNoSelectedSliceImplementationStart(advance)) {
				return { status: "no_selected_slice", previousState: advance.previousState, advance };
			}
			return { status: "invalid_transition", advance };
		case "not_locked":
			return { status: "not_locked", advance };
		case "locked_by_other":
			return { status: "locked_by_other", advance };
	}
}

function isNoSelectedSliceImplementationStart(advance: PawTaskSessionInvalidTransitionResult): boolean {
	return (
		advance.previousState.name === "SLICE_SELECT" &&
		advance.previousState.current_slice_id === null &&
		advance.issues.some((issue) => issue.path === "/current_slice_id")
	);
}
