import { mkdir, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname } from "node:path";
import type { PawValidationIssue } from "./contracts.ts";
import {
	createPawFinalReport,
	type PawFinalReport,
	type PawFinalReportInput,
	renderPawFinalReportMarkdown,
} from "./final-report.ts";
import type { PawSessionLock, PawSessionLockOptions, PawSessionLockStaleReason } from "./session-store.ts";
import {
	getPawSessionLockStatus,
	readPawSessionState,
	resolvePawSessionPaths,
	writePawSessionState,
} from "./session-store.ts";
import type { PawSessionState } from "./state.ts";
import { transitionPawSessionState } from "./state.ts";

export interface PawFinalReportEmissionInput {
	repoRoot: string;
	sessionId: string;
	reportInput: Omit<PawFinalReportInput, "sessionId">;
	lockOptions?: PawSessionLockOptions;
}

export type PawFinalReportEmissionResult =
	| PawFinalReportEmissionCompletedResult
	| PawFinalReportEmissionNotLockedResult
	| PawFinalReportEmissionLockedByOtherResult
	| PawFinalReportEmissionInvalidStateResult
	| PawFinalReportEmissionPendingSlicesResult
	| PawFinalReportEmissionInvalidReportInputResult
	| PawFinalReportEmissionInvalidTransitionResult;

export interface PawFinalReportEmissionCompletedResult {
	status: "completed";
	lock: PawSessionLock;
	previousState: PawSessionState;
	nextState: PawSessionState;
	report: PawFinalReport;
	markdown: string;
	summaryFile: string;
}

export type PawFinalReportEmissionNotLockedResult =
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

export interface PawFinalReportEmissionLockedByOtherResult {
	status: "locked_by_other";
	lock: PawSessionLock;
	expectedOwner: PawFinalReportEmissionLockOwner;
}

export interface PawFinalReportEmissionInvalidStateResult {
	status: "invalid_state";
	previousState: PawSessionState;
	issues: readonly PawValidationIssue[];
}

export interface PawFinalReportEmissionPendingSlicesResult {
	status: "pending_slices";
	previousState: PawSessionState;
	issues: readonly PawValidationIssue[];
}

export interface PawFinalReportEmissionInvalidReportInputResult {
	status: "invalid_report_input";
	previousState: PawSessionState;
	issues: readonly PawValidationIssue[];
}

export interface PawFinalReportEmissionInvalidTransitionResult {
	status: "invalid_transition";
	previousState: PawSessionState;
	issues: readonly PawValidationIssue[];
}

export interface PawFinalReportEmissionLockOwner {
	pid: number;
	host: string;
}

export async function emitPawFinalReport(input: PawFinalReportEmissionInput): Promise<PawFinalReportEmissionResult> {
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

	const expectedOwner = getPawFinalReportEmissionLockOwner(lockOptions);
	if (!isPawFinalReportEmissionLockOwner(lockStatus.lock, expectedOwner)) {
		return {
			status: "locked_by_other",
			lock: lockStatus.lock,
			expectedOwner,
		};
	}

	const previousState = await readPawSessionState(input.repoRoot, input.sessionId);
	if (previousState.name !== "SLICE_DONE") {
		return {
			status: "invalid_state",
			previousState,
			issues: [
				{
					path: "/name",
					message: "Final report emission requires SLICE_DONE state.",
				},
			],
		};
	}
	if (previousState.pending_slice_ids.length > 0) {
		return {
			status: "pending_slices",
			previousState,
			issues: [
				{
					path: "/pending_slice_ids",
					message: "Final report emission requires no pending slices.",
				},
			],
		};
	}

	const reportResult = createFinalReport(input.sessionId, input.reportInput);
	if (!reportResult.ok) {
		return {
			status: "invalid_report_input",
			previousState,
			issues: reportResult.issues,
		};
	}

	const transitioned = transitionPawSessionState(previousState, { to: "FINAL_REPORT" });
	if (!transitioned.ok) {
		return {
			status: "invalid_transition",
			previousState,
			issues: transitioned.issues,
		};
	}

	const paths = resolvePawSessionPaths(input.repoRoot, input.sessionId);
	const markdown = renderPawFinalReportMarkdown(reportResult.report);
	await mkdir(dirname(paths.summaryFile), { recursive: true });
	await writeFile(paths.summaryFile, markdown, "utf-8");
	await writePawSessionState(input.repoRoot, transitioned.value);

	return {
		status: "completed",
		lock: lockStatus.lock,
		previousState,
		nextState: transitioned.value,
		report: reportResult.report,
		markdown,
		summaryFile: paths.summaryFile,
	};
}

type FinalReportCreationResult =
	| {
			ok: true;
			report: PawFinalReport;
	  }
	| {
			ok: false;
			issues: PawValidationIssue[];
	  };

function createFinalReport(
	sessionId: string,
	input: Omit<PawFinalReportInput, "sessionId">,
): FinalReportCreationResult {
	try {
		return {
			ok: true,
			report: createPawFinalReport({
				...input,
				sessionId,
			}),
		};
	} catch (error) {
		return {
			ok: false,
			issues: [
				{
					path: "/report_input",
					message: error instanceof Error ? error.message : String(error),
				},
			],
		};
	}
}

function getPawFinalReportEmissionLockOwner(options: PawSessionLockOptions): PawFinalReportEmissionLockOwner {
	return {
		pid: options.pid ?? process.pid,
		host: options.host ?? hostname(),
	};
}

function isPawFinalReportEmissionLockOwner(lock: PawSessionLock, owner: PawFinalReportEmissionLockOwner): boolean {
	return lock.pid === owner.pid && lock.host === owner.host;
}
