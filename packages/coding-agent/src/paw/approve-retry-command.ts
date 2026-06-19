import { APP_NAME } from "../config.ts";
import type { PawValidationIssue } from "./contracts.ts";
import {
	acquirePawSessionLock,
	type PawSessionLock,
	type PawSessionLockOptions,
	readPawSessionState,
	releasePawSessionLock,
	writePawSessionState,
} from "./session-store.ts";
import type { PawSessionState, PawSessionStateName } from "./state.ts";
import { isPawBlockedState, transitionPawSessionState } from "./state.ts";

export type PawApproveRetryAction = "approve" | "reject" | "retry";

export interface PawApproveRetryParsedArgs {
	action: PawApproveRetryAction;
	sessionId: string | null;
	reason: string | null;
}

export type PawApproveRetryParseResult =
	| { kind: "help" }
	| { kind: "error"; message: string }
	| { kind: "ok"; args: PawApproveRetryParsedArgs };

export interface PawApproveRetryInput {
	repoRoot: string;
	sessionId: string;
	action: PawApproveRetryAction;
	reason?: string;
	lockOptions?: PawSessionLockOptions;
}

export type PawApproveRetryResult =
	| PawApproveRetryAdvancedResult
	| PawApproveRetryRejectedResult
	| PawApproveRetryRetriedResult
	| PawApproveRetryNoOpResult
	| PawApproveRetryInvalidStateResult
	| PawApproveRetryMissingProjectResult
	| PawApproveRetryMissingSessionResult
	| PawApproveRetryLockedResult
	| PawApproveRetryNotLockedResult;

export interface PawApproveRetryAdvancedResult {
	status: "advanced";
	action: "approve";
	sessionId: string;
	previousStateName: PawSessionStateName;
	nextStateName: PawSessionStateName;
	lockReleased: boolean;
}

export interface PawApproveRetryRejectedResult {
	status: "rejected";
	sessionId: string;
	previousStateName: PawSessionStateName;
	blockedCode: "NEEDS_USER_DECISION";
	reason: string;
	lockReleased: boolean;
}

export interface PawApproveRetryRetriedResult {
	status: "retried";
	sessionId: string;
	previousStateName: PawSessionStateName;
	nextStateName: PawSessionStateName;
	lockReleased: boolean;
}

export interface PawApproveRetryNoOpResult {
	status: "no_op";
	sessionId: string;
	previousStateName: PawSessionStateName;
	reason: string;
	lockReleased: boolean;
}

export interface PawApproveRetryInvalidStateResult {
	status: "invalid_state";
	sessionId: string;
	previousStateName: PawSessionStateName;
	action: PawApproveRetryAction;
	reason: string;
	lockReleased: boolean;
}

export interface PawApproveRetryMissingProjectResult {
	status: "missing_project";
	pawDir: string;
}

export interface PawApproveRetryMissingSessionResult {
	status: "missing_session";
	sessionId: string;
	stateFile: string;
}

export interface PawApproveRetryLockedResult {
	status: "locked";
	sessionId: string;
	lock: PawSessionLock;
}

export interface PawApproveRetryNotLockedResult {
	status: "not_locked";
	sessionId: string;
	lockReleased: boolean;
}

export function parsePawApproveRetryArgs(args: string[]): PawApproveRetryParseResult {
	if (args.length === 0) {
		return { kind: "help" };
	}
	if (args[0] === "--help" || args[0] === "-h") {
		return { kind: "help" };
	}
	const action = args[0];
	if (action !== "approve" && action !== "reject" && action !== "retry") {
		return { kind: "error", message: `Unknown action: ${action}. Use approve, reject, or retry.` };
	}
	let sessionId: string | null = null;
	let reason: string | null = null;
	for (let index = 1; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--reason" || arg === "-r") {
			const value = args[index + 1];
			if (value === undefined) {
				return { kind: "error", message: `Missing value for ${arg}` };
			}
			reason = value;
			index += 1;
		} else if (arg.startsWith("--")) {
			return { kind: "error", message: `Unknown option for "paw ${action}": ${arg}` };
		} else if (sessionId === null) {
			sessionId = arg;
		} else {
			return { kind: "error", message: `Unexpected positional argument: ${arg}` };
		}
	}
	if (sessionId === null) {
		return { kind: "error", message: `Missing <session-id> for "paw ${action}"` };
	}
	return { kind: "ok", args: { action, sessionId, reason } };
}

export async function runPawApproveRetryCommand(args: string[]): Promise<void> {
	const parsed = parsePawApproveRetryArgs(args);
	if (parsed.kind === "help") {
		printApproveRetryHelp();
		return;
	}
	if (parsed.kind === "error") {
		console.error(`Error: ${parsed.message}`);
		process.exitCode = 1;
		return;
	}
	const repoRoot = process.cwd();
	const result = await createPawApproveRetryResult({
		repoRoot,
		sessionId: parsed.args.sessionId as string,
		action: parsed.args.action,
		...(parsed.args.reason !== null ? { reason: parsed.args.reason } : {}),
	});
	console.log(formatPawApproveRetryResult(result));
	if (
		result.status === "invalid_state" ||
		result.status === "missing_session" ||
		result.status === "missing_project" ||
		result.status === "locked" ||
		result.status === "not_locked"
	) {
		process.exitCode = 1;
	}
}

export async function createPawApproveRetryResult(input: PawApproveRetryInput): Promise<PawApproveRetryResult> {
	const lockResult = await acquirePawSessionLock(input.repoRoot, input.sessionId, input.lockOptions);
	if (!lockResult.acquired) {
		return {
			status: "locked",
			sessionId: input.sessionId,
			lock: lockResult.lock,
		};
	}
	try {
		const state = await readPawSessionStateOrNull(input.repoRoot, input.sessionId);
		if (state === null) {
			return {
				status: "missing_session",
				sessionId: input.sessionId,
				stateFile: `${input.repoRoot}/.paw/sessions/${input.sessionId}/state.json`,
			};
		}
		return await executePawApproveRetry(input, state);
	} finally {
		await releasePawSessionLock(input.repoRoot, input.sessionId, input.lockOptions);
	}
}

async function executePawApproveRetry(
	input: PawApproveRetryInput,
	state: PawSessionState,
): Promise<PawApproveRetryResult> {
	switch (input.action) {
		case "approve":
			return await executeApprove(input, state);
		case "reject":
			return await executeReject(input, state);
		case "retry":
			return await executeRetry(input, state);
	}
}

async function executeApprove(input: PawApproveRetryInput, state: PawSessionState): Promise<PawApproveRetryResult> {
	// Resume from BLOCKED_NEEDS_USER_DECISION
	if (isPawBlockedState(state.name) && state.blocked_reason?.code === "NEEDS_USER_DECISION") {
		const target = state.blocked_reason.resume_state;
		const resumed: PawSessionState = { ...state, name: target, blocked_reason: null };
		await writePawSessionState(input.repoRoot, resumed);
		return {
			status: "advanced",
			action: "approve",
			sessionId: input.sessionId,
			previousStateName: state.name,
			nextStateName: target,
			lockReleased: true,
		};
	}
	// Active state transitions
	if (state.name === "SPEC_DRAFTED") {
		const next: PawSessionState = { ...state, name: "SPEC_APPROVED" };
		await writePawSessionState(input.repoRoot, next);
		return {
			status: "advanced",
			action: "approve",
			sessionId: input.sessionId,
			previousStateName: state.name,
			nextStateName: "SPEC_APPROVED",
			lockReleased: true,
		};
	}
	if (state.name === "PLAN_DRAFTED") {
		if (state.pending_slice_ids.length === 0) {
			return {
				status: "no_op",
				sessionId: input.sessionId,
				previousStateName: state.name,
				reason: "PLAN_DRAFTED has no pending slices; use paw approve-plan --slice <id>[:<title>]...",
				lockReleased: true,
			};
		}
		const next: PawSessionState = {
			...state,
			name: "PLAN_APPROVED",
			pending_slice_ids: [...state.pending_slice_ids],
		};
		await writePawSessionState(input.repoRoot, next);
		return {
			status: "advanced",
			action: "approve",
			sessionId: input.sessionId,
			previousStateName: state.name,
			nextStateName: "PLAN_APPROVED",
			lockReleased: true,
		};
	}
	if (state.name === "SLICE_DONE" && state.pending_slice_ids.length === 0) {
		const next: PawSessionState = { ...state, name: "FINAL_REPORT" };
		await writePawSessionState(input.repoRoot, next);
		return {
			status: "advanced",
			action: "approve",
			sessionId: input.sessionId,
			previousStateName: state.name,
			nextStateName: "FINAL_REPORT",
			lockReleased: true,
		};
	}
	return {
		status: "invalid_state",
		sessionId: input.sessionId,
		previousStateName: state.name,
		action: "approve",
		reason: `Cannot approve from state ${state.name}; expected SPEC_DRAFTED, PLAN_DRAFTED, or BLOCKED_NEEDS_USER_DECISION.`,
		lockReleased: true,
	};
}

async function executeReject(input: PawApproveRetryInput, state: PawSessionState): Promise<PawApproveRetryResult> {
	if (isPawBlockedState(state.name)) {
		return {
			status: "invalid_state",
			sessionId: input.sessionId,
			previousStateName: state.name,
			action: "reject",
			reason: `Cannot reject from blocked state ${state.name}; use paw retry to resume.`,
			lockReleased: true,
		};
	}
	if (state.name === "FINAL_REPORT" || state.name === "IDLE") {
		return {
			status: "invalid_state",
			sessionId: input.sessionId,
			previousStateName: state.name,
			action: "reject",
			reason: `Cannot reject from terminal state ${state.name}.`,
			lockReleased: true,
		};
	}
	const reason = input.reason ?? "User rejected the current step.";
	// Use transitionPawSessionState to enter BLOCKED_NEEDS_USER_DECISION with proper blocked_reason
	const transitioned = transitionPawSessionState(state, {
		to: "BLOCKED_NEEDS_USER_DECISION",
		blocked_reason: {
			code: "NEEDS_USER_DECISION",
			message: reason,
			suggested_action: `paw approve ${input.sessionId}  # to resume, or paw retry ${input.sessionId} after fixing`,
			slice_id: state.current_slice_id,
		},
	});
	if (!transitioned.ok) {
		return {
			status: "invalid_state",
			sessionId: input.sessionId,
			previousStateName: state.name,
			action: "reject",
			reason: `Transition failed: ${formatTransitionIssues(transitioned.issues)}`,
			lockReleased: true,
		};
	}
	await writePawSessionState(input.repoRoot, transitioned.value);
	return {
		status: "rejected",
		sessionId: input.sessionId,
		previousStateName: state.name,
		blockedCode: "NEEDS_USER_DECISION",
		reason,
		lockReleased: true,
	};
}

async function executeRetry(input: PawApproveRetryInput, state: PawSessionState): Promise<PawApproveRetryResult> {
	if (isPawBlockedState(state.name)) {
		if (state.blocked_reason === null) {
			return {
				status: "invalid_state",
				sessionId: input.sessionId,
				previousStateName: state.name,
				action: "retry",
				reason: "Blocked state has no blocked_reason; cannot determine resume_state.",
				lockReleased: true,
			};
		}
		const target = state.blocked_reason.resume_state;
		const resumed: PawSessionState = { ...state, name: target, blocked_reason: null };
		await writePawSessionState(input.repoRoot, resumed);
		return {
			status: "retried",
			sessionId: input.sessionId,
			previousStateName: state.name,
			nextStateName: target,
			lockReleased: true,
		};
	}
	if (
		state.name === "SLICE_SELECT" ||
		state.name === "IMPLEMENTING" ||
		state.name === "REVIEWING" ||
		state.name === "VERIFYING"
	) {
		// Re-attempt the current step; the next paw build will re-enter the same state.
		return {
			status: "retried",
			sessionId: input.sessionId,
			previousStateName: state.name,
			nextStateName: state.name,
			lockReleased: true,
		};
	}
	return {
		status: "no_op",
		sessionId: input.sessionId,
		previousStateName: state.name,
		reason: `State ${state.name} does not require retry; use paw approve or paw reject instead.`,
		lockReleased: true,
	};
}

async function readPawSessionStateOrNull(repoRoot: string, sessionId: string): Promise<PawSessionState | null> {
	try {
		return await readPawSessionState(repoRoot, sessionId);
	} catch (error) {
		if (error instanceof Error && "code" in error && (error as { code?: string }).code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

function formatTransitionIssues(issues: readonly PawValidationIssue[]): string {
	return issues.map((issue) => `${issue.path} ${issue.message}`).join("; ");
}

export function formatPawApproveRetryResult(result: PawApproveRetryResult): string {
	switch (result.status) {
		case "advanced":
			return [
				`Paw ${result.action}`,
				`status: ${result.status}`,
				`session: ${result.sessionId}`,
				`previous: ${result.previousStateName}`,
				`next: ${result.nextStateName}`,
				`lock released: ${result.lockReleased ? "yes" : "no"}`,
			].join("\n");
		case "rejected":
			return [
				"Paw reject",
				"status: rejected",
				`session: ${result.sessionId}`,
				`previous: ${result.previousStateName}`,
				`blocked_code: ${result.blockedCode}`,
				`reason: ${result.reason}`,
				`lock released: ${result.lockReleased ? "yes" : "no"}`,
			].join("\n");
		case "retried":
			return [
				"Paw retry",
				"status: retried",
				`session: ${result.sessionId}`,
				`previous: ${result.previousStateName}`,
				`next: ${result.nextStateName}`,
				`lock released: ${result.lockReleased ? "yes" : "no"}`,
			].join("\n");
		case "no_op":
			return [
				`Paw approve`,
				"status: no_op",
				`session: ${result.sessionId}`,
				`previous: ${result.previousStateName}`,
				`reason: ${result.reason}`,
				`lock released: ${result.lockReleased ? "yes" : "no"}`,
			].join("\n");
		case "invalid_state":
			return [
				`Paw ${result.action}`,
				"status: invalid_state",
				`session: ${result.sessionId}`,
				`previous: ${result.previousStateName}`,
				`reason: ${result.reason}`,
				`lock released: ${result.lockReleased ? "yes" : "no"}`,
			].join("\n");
		case "missing_session":
			return [
				"Paw",
				"status: missing_session",
				`session: ${result.sessionId}`,
				`state file: ${result.stateFile}`,
			].join("\n");
		case "missing_project":
			return ["Paw", "status: missing_project", `paw dir: ${result.pawDir}`].join("\n");
		case "locked":
			return [
				"Paw",
				"status: locked",
				`session: ${result.sessionId}`,
				`lock: pid ${result.lock.pid} on ${result.lock.host}`,
			].join("\n");
		case "not_locked":
			return [
				"Paw",
				"status: not_locked",
				`session: ${result.sessionId}`,
				`lock released: ${result.lockReleased ? "yes" : "no"}`,
			].join("\n");
	}
}

function printApproveRetryHelp(): void {
	console.log(`Usage:
  ${APP_NAME} paw approve <session-id> [--reason <text>]
  ${APP_NAME} paw reject <session-id> --reason <text>
  ${APP_NAME} paw retry <session-id>

Standalone approval/rejection/retry commands:
  approve   Advance from SPEC_DRAFTED, PLAN_DRAFTED, or BLOCKED_NEEDS_USER_DECISION
  reject    Move to BLOCKED_NEEDS_USER_DECISION with a reason
  retry     Resume from a blocked state or restart the current slice step
`);
}
