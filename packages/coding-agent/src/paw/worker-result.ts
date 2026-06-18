
import { hostname } from "node:os";
import type { PawSubAgentOutput, PawValidationIssue } from "./contracts.ts";
import type { PawSessionLock, PawSessionLockOptions, PawSessionLockStaleReason } from "./session-store.ts";
import { getPawSessionLockStatus, readPawSessionState, writePawSessionState } from "./session-store.ts";
import { appendPawSliceJournalEntry, type PawSliceJournalEntry } from "./slice-journal.ts";
import type { PawSessionState } from "./state.ts";
import { transitionPawSessionState } from "./state.ts";

export interface PawWorkerPassInput {
	repoRoot: string;
	sessionId: string;
	workerOutput: PawSubAgentOutput;
	lockOptions?: PawSessionLockOptions;
	timestamp?: string;
}

export type PawWorkerPassResult =
	| PawWorkerPassCompletedResult
	| PawWorkerPassNotLockedResult
	| PawWorkerPassLockedByOtherResult
	| PawWorkerPassInvalidStateResult
	| PawWorkerPassNoSelectedSliceResult
	| PawWorkerPassInvalidOutputResult
	| PawWorkerPassNotPassedResult
	| PawWorkerPassInvalidTransitionResult;

export interface PawWorkerPassCompletedResult {
	status: "completed";
	lock: PawSessionLock;
	previousState: PawSessionState;
	nextState: PawSessionState;
	workerOutput: PawSubAgentOutput;
	journalEntries: PawSliceJournalEntry[];
}

export type PawWorkerPassNotLockedResult =
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

export interface PawWorkerPassLockedByOtherResult {
	status: "locked_by_other";
	lock: PawSessionLock;
	expectedOwner: PawWorkerPassLockOwner;
}

export interface PawWorkerPassInvalidStateResult {
	status: "invalid_state";
	previousState: PawSessionState;
	issues: readonly PawValidationIssue[];
}

export interface PawWorkerPassNoSelectedSliceResult {
	status: "no_selected_slice";
	previousState: PawSessionState;
	issues: readonly PawValidationIssue[];
}

export interface PawWorkerPassInvalidOutputResult {
	status: "invalid_worker_output";
	previousState: PawSessionState;
	workerOutput: PawSubAgentOutput;
	issues: readonly PawValidationIssue[];
}

export interface PawWorkerPassNotPassedResult {
	status: "worker_not_passed";
	previousState: PawSessionState;
	workerOutput: PawSubAgentOutput;
}

export interface PawWorkerPassInvalidTransitionResult {
	status: "invalid_transition";
	previousState: PawSessionState;
	issues: readonly PawValidationIssue[];
}

export interface PawWorkerPassLockOwner {
	pid: number;
	host: string;
}

export async function completePawWorkerPass(input: PawWorkerPassInput): Promise<PawWorkerPassResult> {
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

	const expectedOwner = getPawWorkerPassLockOwner(lockOptions);
	if (!isPawWorkerPassLockOwner(lockStatus.lock, expectedOwner)) {
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
					message: "Worker pass completion requires IMPLEMENTING state.",
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
					message: "Worker pass completion requires a current slice.",
				},
			],
		};
	}

	const currentSliceId = previousState.current_slice_id;
	const outputIssues = validateWorkerOutput(input.workerOutput, input.sessionId, currentSliceId);
	if (outputIssues.length > 0) {
		return {
			status: "invalid_worker_output",
			previousState,
			workerOutput: input.workerOutput,
			issues: outputIssues,
		};
	}
	if (input.workerOutput.status !== "pass") {
		return {
			status: "worker_not_passed",
			previousState,
			workerOutput: input.workerOutput,
		};
	}

	const transitioned = transitionPawSessionState(previousState, { to: "REVIEWING" });
	if (!transitioned.ok) {
		return {
			status: "invalid_transition",
			previousState,
			issues: transitioned.issues,
		};
	}

	const timestamp = input.timestamp ?? new Date().toISOString();
	const journalEntries = input.workerOutput.changed_files.map((changedFile) => {
		const entry: PawSliceJournalEntry = {
			session_id: input.sessionId,
			slice_id: currentSliceId,
			path: changedFile.path,
			change_type: changedFile.change_type,
			content_hash: changedFile.content_hash,
			timestamp,
		};
		if (changedFile.apply_method !== undefined) {
			entry.apply_method = changedFile.apply_method;
		}
		return entry;
	});

	for (const entry of journalEntries) {
		await appendPawSliceJournalEntry(input.repoRoot, entry);
	}
	await writePawSessionState(input.repoRoot, transitioned.value);

	return {
		status: "completed",
		lock: lockStatus.lock,
		previousState,
		nextState: transitioned.value,
		workerOutput: input.workerOutput,
		journalEntries,
	};
}

function validateWorkerOutput(
	workerOutput: PawSubAgentOutput,
	sessionId: string,
	currentSliceId: string,
): PawValidationIssue[] {
	const issues: PawValidationIssue[] = [];
	if (workerOutput.agent !== "worker") {
		issues.push({
			path: "/agent",
			message: 'Worker pass completion requires agent "worker".',
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

	for (const [index, changedFile] of workerOutput.changed_files.entries()) {
		if (changedFile.path.trim() === "") {
			issues.push({
				path: `/changed_files/${index}/path`,
				message: "Changed file path is required for journal persistence.",
			});
		}
		if (changedFile.content_hash.trim() === "") {
			issues.push({
				path: `/changed_files/${index}/content_hash`,
				message: "Changed file content hash is required for journal persistence.",
			});
		}
	}

	return issues;
}

function getPawWorkerPassLockOwner(options: PawSessionLockOptions): PawWorkerPassLockOwner {
	return {
		pid: options.pid ?? process.pid,
		host: options.host ?? hostname(),
	};
}

function isPawWorkerPassLockOwner(lock: PawSessionLock, owner: PawWorkerPassLockOwner): boolean {
	return lock.pid === owner.pid && lock.host === owner.host;
}
