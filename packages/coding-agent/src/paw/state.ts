import type { PawValidationIssue, PawValidationResult } from "./contracts.ts";

export const PAW_ACTIVE_STATE_NAMES = [
	"IDLE",
	"INTAKE",
	"CLASSIFYING",
	"CLARIFYING",
	"SPEC_DRAFTED",
	"SPEC_APPROVED",
	"SCOUTING",
	"PLAN_DRAFTED",
	"PLAN_APPROVED",
	"SLICE_SELECT",
	"IMPLEMENTING",
	"REVIEWING",
	"VERIFYING",
	"SLICE_DONE",
	"FINAL_REPORT",
] as const;

export const PAW_BLOCKED_REASON_CODES = [
	"NEEDS_USER_DECISION",
	"BUDGET_EXCEEDED",
	"TEST_FAILURE",
	"BUILD_FAILURE",
	"TOOL_PERMISSION",
	"CONTEXT_MISSING",
	"PROVIDER_UNAVAILABLE",
	"SANDBOX_UNAVAILABLE",
	"PATCH_APPLY_FAILED",
] as const;

export const PAW_BLOCKED_STATE_NAMES = [
	"BLOCKED_NEEDS_USER_DECISION",
	"BLOCKED_BUDGET_EXCEEDED",
	"BLOCKED_TEST_FAILURE",
	"BLOCKED_BUILD_FAILURE",
	"BLOCKED_TOOL_PERMISSION",
	"BLOCKED_CONTEXT_MISSING",
	"BLOCKED_PROVIDER_UNAVAILABLE",
	"BLOCKED_SANDBOX_UNAVAILABLE",
	"BLOCKED_PATCH_APPLY_FAILED",
] as const;

export const PAW_SESSION_STATE_NAMES = [...PAW_ACTIVE_STATE_NAMES, ...PAW_BLOCKED_STATE_NAMES] as const;

export type PawActiveStateName = (typeof PAW_ACTIVE_STATE_NAMES)[number];
export type PawBlockedReasonCode = (typeof PAW_BLOCKED_REASON_CODES)[number];
export type PawBlockedStateName = (typeof PAW_BLOCKED_STATE_NAMES)[number];
export type PawSessionStateName = (typeof PAW_SESSION_STATE_NAMES)[number];

export type PawBlockedReason = {
	code: PawBlockedReasonCode;
	message: string;
	suggested_action: string;
	slice_id: string | null;
	resume_state: PawActiveStateName;
};

export type PawSessionState = {
	session_id: string;
	name: PawSessionStateName;
	current_slice_id: string | null;
	pending_slice_ids: string[];
	completed_slice_ids: string[];
	blocked_reason: PawBlockedReason | null;
};

export type PawBlockedReasonInput = {
	code?: PawBlockedReasonCode;
	message: string;
	suggested_action: string;
	slice_id?: string | null;
};

export type PawStateTransition = {
	to: PawSessionStateName;
	slice_ids?: readonly string[];
	blocked_reason?: PawBlockedReasonInput | null;
};

export const PAW_ALLOWED_ACTIVE_TRANSITIONS: Record<PawActiveStateName, readonly PawActiveStateName[]> = {
	IDLE: ["INTAKE"],
	INTAKE: ["CLASSIFYING"],
	CLASSIFYING: ["CLARIFYING"],
	CLARIFYING: ["SPEC_DRAFTED"],
	SPEC_DRAFTED: ["SPEC_APPROVED"],
	SPEC_APPROVED: ["SCOUTING"],
	SCOUTING: ["PLAN_DRAFTED"],
	PLAN_DRAFTED: ["PLAN_APPROVED"],
	PLAN_APPROVED: ["SLICE_SELECT"],
	SLICE_SELECT: ["IMPLEMENTING"],
	IMPLEMENTING: ["REVIEWING"],
	REVIEWING: ["VERIFYING"],
	VERIFYING: ["SLICE_DONE"],
	SLICE_DONE: ["SLICE_SELECT", "FINAL_REPORT"],
	FINAL_REPORT: ["IDLE"],
};

export function createInitialPawSessionState(sessionId: string): PawSessionState {
	return {
		session_id: sessionId,
		name: "IDLE",
		current_slice_id: null,
		pending_slice_ids: [],
		completed_slice_ids: [],
		blocked_reason: null,
	};
}

export function isPawBlockedState(name: PawSessionStateName): name is PawBlockedStateName {
	return includesValue(PAW_BLOCKED_STATE_NAMES, name);
}

export function assertValidPawSessionState(state: PawSessionState): PawValidationResult<PawSessionState> {
	const issues: PawValidationIssue[] = [];

	if (state.session_id.trim() === "") {
		issues.push({ path: "/session_id", message: "Session id is required." });
	}
	if (!includesValue(PAW_SESSION_STATE_NAMES, state.name)) {
		issues.push({ path: "/name", message: `Unknown Paw session state ${state.name}.` });
	}
	if (state.current_slice_id !== null && state.current_slice_id.trim() === "") {
		issues.push({ path: "/current_slice_id", message: "Current slice id cannot be empty." });
	}

	addDuplicateIssues(issues, "/pending_slice_ids", state.pending_slice_ids);
	addDuplicateIssues(issues, "/completed_slice_ids", state.completed_slice_ids);

	if (state.current_slice_id !== null && state.pending_slice_ids.includes(state.current_slice_id)) {
		issues.push({
			path: "/current_slice_id",
			message: "Current slice cannot also be pending.",
		});
	}
	if (state.current_slice_id !== null && state.completed_slice_ids.includes(state.current_slice_id)) {
		issues.push({
			path: "/current_slice_id",
			message: "Current slice cannot already be completed.",
		});
	}

	validatePawSliceListOverlap(issues, state);

	validatePawBlockedReasonField(issues, state.name, state.blocked_reason);

	if (issues.length > 0) {
		return { ok: false, issues };
	}

	return { ok: true, value: state };
}

export function transitionPawSessionState(
	state: PawSessionState,
	transition: PawStateTransition,
): PawValidationResult<PawSessionState> {
	const stateValidation = assertValidPawSessionState(state);
	if (!stateValidation.ok) return stateValidation;

	if (isPawBlockedState(state.name)) {
		return resumeBlockedState(state, transition);
	}

	if (isPawBlockedState(transition.to)) {
		return enterBlockedState(state, transition.to, transition.blocked_reason);
	}

	if (!PAW_ALLOWED_ACTIVE_TRANSITIONS[state.name].includes(transition.to)) {
		return invalidTransition(state.name, transition.to);
	}

	const guardIssues = validateActiveTransitionGuard(state, transition);
	if (guardIssues.length > 0) {
		return { ok: false, issues: guardIssues };
	}

	const next = applyActiveTransition(state, transition);
	return assertValidPawSessionState(next);
}

function resumeBlockedState(
	state: PawSessionState,
	transition: PawStateTransition,
): PawValidationResult<PawSessionState> {
	if (state.blocked_reason === null) {
		return {
			ok: false,
			issues: [
				{
					path: "/blocked_reason",
					message: "Blocked states require blocked_reason metadata.",
				},
			],
		};
	}
	if (isPawBlockedState(transition.to)) {
		return invalidTransition(state.name, transition.to);
	}
	if (transition.to !== state.blocked_reason.resume_state) {
		return {
			ok: false,
			issues: [
				{
					path: "/transition/to",
					message: `Blocked state ${state.name} can only resume to ${state.blocked_reason.resume_state}.`,
				},
			],
		};
	}

	return {
		ok: true,
		value: {
			...state,
			name: transition.to,
			blocked_reason: null,
		},
	};
}

function enterBlockedState(
	state: PawSessionState,
	to: PawBlockedStateName,
	blockedReason: PawBlockedReasonInput | null | undefined,
): PawValidationResult<PawSessionState> {
	if (isPawBlockedState(state.name)) {
		return invalidTransition(state.name, to);
	}

	const issues: PawValidationIssue[] = [];
	const code = blockedStateCode(to);
	const resumeState = state.name;

	if (resumeState === "IDLE" || resumeState === "FINAL_REPORT") {
		issues.push({
			path: "/transition/to",
			message: `Cannot transition from ${resumeState} to ${to}.`,
		});
	}
	if (blockedReason === null || blockedReason === undefined) {
		issues.push({
			path: "/transition/blocked_reason",
			message: "Blocked transitions require blocked_reason metadata.",
		});
	}
	if (blockedReason?.code !== undefined && blockedReason.code !== code) {
		issues.push({
			path: "/transition/blocked_reason/code",
			message: `Blocked reason code ${blockedReason.code} does not match ${to}.`,
		});
	}
	if (blockedReason !== null && blockedReason !== undefined && blockedReason.message.trim() === "") {
		issues.push({
			path: "/transition/blocked_reason/message",
			message: "Blocked reason message is required.",
		});
	}
	if (blockedReason !== null && blockedReason !== undefined && blockedReason.suggested_action.trim() === "") {
		issues.push({
			path: "/transition/blocked_reason/suggested_action",
			message: "Blocked reason suggested action is required.",
		});
	}
	if (issues.length > 0 || blockedReason === null || blockedReason === undefined) {
		return { ok: false, issues };
	}

	const next: PawSessionState = {
		...state,
		name: to,
		blocked_reason: {
			code,
			message: blockedReason.message,
			suggested_action: blockedReason.suggested_action,
			slice_id: blockedReason.slice_id ?? state.current_slice_id,
			resume_state: resumeState,
		},
	};

	return assertValidPawSessionState(next);
}

function validateActiveTransitionGuard(state: PawSessionState, transition: PawStateTransition): PawValidationIssue[] {
	if (transition.to === "PLAN_APPROVED" && (transition.slice_ids === undefined || transition.slice_ids.length === 0)) {
		return [
			{
				path: "/transition/slice_ids",
				message: "PLAN_APPROVED requires at least one planned slice id.",
			},
		];
	}
	if (transition.to === "SLICE_SELECT" && state.pending_slice_ids.length === 0) {
		return [
			{
				path: "/pending_slice_ids",
				message: "SLICE_SELECT requires at least one pending slice.",
			},
		];
	}
	if (transition.to === "IMPLEMENTING" && state.current_slice_id === null) {
		return [
			{
				path: "/current_slice_id",
				message: "IMPLEMENTING requires a current slice.",
			},
		];
	}
	if (
		(transition.to === "REVIEWING" || transition.to === "VERIFYING" || transition.to === "SLICE_DONE") &&
		state.current_slice_id === null
	) {
		return [
			{
				path: "/current_slice_id",
				message: `${transition.to} requires a current slice.`,
			},
		];
	}
	if (state.name === "SLICE_DONE" && transition.to === "FINAL_REPORT" && state.pending_slice_ids.length > 0) {
		return [
			{
				path: "/pending_slice_ids",
				message: "FINAL_REPORT requires all planned slices to be completed.",
			},
		];
	}

	return [];
}

function applyActiveTransition(state: PawSessionState, transition: PawStateTransition): PawSessionState {
	if (transition.to === "PLAN_APPROVED") {
		return {
			...state,
			name: transition.to,
			pending_slice_ids: [...(transition.slice_ids ?? [])],
		};
	}
	if (transition.to === "SLICE_SELECT") {
		const [selectedSliceId, ...remainingSliceIds] = state.pending_slice_ids;
		return {
			...state,
			name: transition.to,
			current_slice_id: selectedSliceId ?? null,
			pending_slice_ids: remainingSliceIds,
		};
	}
	if (transition.to === "SLICE_DONE") {
		const completedSliceIds =
			state.current_slice_id === null || state.completed_slice_ids.includes(state.current_slice_id)
				? state.completed_slice_ids
				: [...state.completed_slice_ids, state.current_slice_id];
		return {
			...state,
			name: transition.to,
			current_slice_id: null,
			completed_slice_ids: completedSliceIds,
		};
	}

	return {
		...state,
		name: transition.to,
		blocked_reason: null,
	};
}

function invalidTransition(from: PawSessionStateName, to: PawSessionStateName): PawValidationResult<PawSessionState> {
	return {
		ok: false,
		issues: [
			{
				path: "/transition/to",
				message: `Cannot transition from ${from} to ${to}.`,
			},
		],
	};
}

function validateBlockedReason(
	issues: PawValidationIssue[],
	blockedState: PawBlockedStateName,
	blockedReason: PawBlockedReason,
): void {
	const expectedCode = blockedStateCode(blockedState);
	if (blockedReason.code !== expectedCode) {
		issues.push({
			path: "/blocked_reason/code",
			message: `Blocked reason code ${blockedReason.code} does not match ${blockedState}.`,
		});
	}
	if (blockedReason.message.trim() === "") {
		issues.push({ path: "/blocked_reason/message", message: "Blocked reason message is required." });
	}
	if (blockedReason.suggested_action.trim() === "") {
		issues.push({
			path: "/blocked_reason/suggested_action",
			message: "Blocked reason suggested action is required.",
		});
	}
	if (!includesValue(PAW_ACTIVE_STATE_NAMES, blockedReason.resume_state)) {
		issues.push({ path: "/blocked_reason/resume_state", message: "Blocked reason resume state must be active." });
	}
}

function blockedStateCode(state: PawBlockedStateName): PawBlockedReasonCode {
	return state.slice("BLOCKED_".length) as PawBlockedReasonCode;
}

function validatePawSliceListOverlap(issues: PawValidationIssue[], state: PawSessionState): void {
	for (const sliceId of state.pending_slice_ids) {
		if (state.completed_slice_ids.includes(sliceId)) {
			issues.push({
				path: "/pending_slice_ids",
				message: `Slice ${sliceId} cannot be both pending and completed.`,
			});
		}
	}
}

function validatePawBlockedReasonField(
	issues: PawValidationIssue[],
	name: PawSessionStateName,
	blockedReason: PawSessionState["blocked_reason"],
): void {
	if (isPawBlockedState(name)) {
		if (blockedReason === null) {
			issues.push({
				path: "/blocked_reason",
				message: "Blocked states require blocked_reason metadata.",
			});
			return;
		}
		validateBlockedReason(issues, name, blockedReason);
		return;
	}
	if (blockedReason !== null) {
		issues.push({
			path: "/blocked_reason",
			message: "Unblocked states must not carry blocked_reason metadata.",
		});
	}
}

function addDuplicateIssues(issues: PawValidationIssue[], path: string, values: readonly string[]): void {
	const seen = new Set<string>();
	for (const value of values) {
		if (value.trim() === "") {
			issues.push({ path, message: "Slice ids cannot be empty." });
		}
		if (seen.has(value)) {
			issues.push({ path, message: `Duplicate slice id ${value}.` });
		}
		seen.add(value);
	}
}

function includesValue<T extends string>(values: readonly T[], value: string): value is T {
	return values.includes(value as T);
}
