
import { stat } from "node:fs/promises";
import { relative } from "node:path";
import { APP_NAME } from "../config.ts";
import type { PawValidationIssue } from "./contracts.ts";
import { emitPawFinalReport, type PawFinalReportEmissionResult } from "./final-report-emission.ts";
import { resolvePawProjectPaths } from "./persistence.ts";
import {
	acquirePawSessionLock,
	type PawSessionLock,
	type PawSessionLockOptions,
	type PawSessionLockStaleReason,
	releasePawSessionLock,
	resolvePawSessionPaths,
} from "./session-store.ts";
import type { PawSessionStateName } from "./state.ts";

const DEFAULT_FINALIZE_EVIDENCE = ["manual finalization requested"] as const;

export type PawFinalizeCommandResult =
	| PawFinalizeCommandCompletedResult
	| PawFinalizeCommandMissingProjectResult
	| PawFinalizeCommandMissingSessionResult
	| PawFinalizeCommandLockedResult
	| PawFinalizeCommandNotLockedResult
	| PawFinalizeCommandInvalidStateResult
	| PawFinalizeCommandPendingSlicesResult
	| PawFinalizeCommandInvalidReportInputResult
	| PawFinalizeCommandInvalidTransitionResult;

export interface PawFinalizeCommandInput {
	lockOptions?: PawSessionLockOptions;
}

export interface PawFinalizeCommandCompletedResult {
	status: "completed";
	sessionId: string;
	summary: string;
	summaryFile: string;
	reportJsonFile: string;
	reportStatus: "done" | "done_with_unverified";
	previousStateName: PawSessionStateName;
	nextStateName: PawSessionStateName;
	lockReleased: boolean;
}

export interface PawFinalizeCommandMissingProjectResult {
	status: "missing_project";
	pawDir: string;
}

export interface PawFinalizeCommandMissingSessionResult {
	status: "missing_session";
	sessionId: string;
	stateFile: string;
}

export interface PawFinalizeCommandLockedResult {
	status: "locked";
	sessionId: string;
	lock: PawSessionLock;
}

export interface PawFinalizeCommandNotLockedResult {
	status: "not_locked";
	sessionId: string;
	reason: "unlocked" | "stale";
	staleReason?: PawSessionLockStaleReason;
	lockReleased: boolean;
}

export interface PawFinalizeCommandInvalidStateResult {
	status: "invalid_state";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawFinalizeCommandPendingSlicesResult {
	status: "pending_slices";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawFinalizeCommandInvalidReportInputResult {
	status: "invalid_report_input";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawFinalizeCommandInvalidTransitionResult {
	status: "invalid_transition";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

interface FileSystemError extends Error {
	code?: string;
}

export type PawFinalizeParsedArgs =
	| { kind: "help" }
	| { kind: "error"; message: string }
	| { kind: "ok"; sessionId: string; summary: string; evidence: string[] };

export function parsePawFinalizeArgs(args: string[]): PawFinalizeParsedArgs {
	if (args.includes("--help") || args.includes("-h")) {
		return { kind: "help" };
	}

	if (args.length === 0) {
		return { kind: "error", message: 'Missing required session id for "paw finalize".' };
	}

	const sessionId = args[0];
	if (sessionId.startsWith("-")) {
		return { kind: "error", message: 'Missing required session id for "paw finalize".' };
	}

	let summary: string | undefined;
	const evidence: string[] = [];

	for (let index = 1; index < args.length; ) {
		const arg = args[index];
		if (arg === "--summary") {
			if (index + 1 >= args.length) {
				return { kind: "error", message: 'Missing value for "paw finalize" option: --summary' };
			}
			const value = args[index + 1];
			if (value.trim().length === 0) {
				return { kind: "error", message: 'Option --summary for "paw finalize" must be a non-empty string.' };
			}
			summary = value;
			index += 2;
			continue;
		}

		if (arg === "--evidence") {
			if (index + 1 >= args.length) {
				return { kind: "error", message: 'Missing value for "paw finalize" option: --evidence' };
			}
			const value = args[index + 1];
			if (value.trim().length === 0) {
				return { kind: "error", message: 'Option --evidence for "paw finalize" must be a non-empty string.' };
			}
			evidence.push(value);
			index += 2;
			continue;
		}

		if (arg.startsWith("-")) {
			return { kind: "error", message: `Unknown option for "paw finalize": ${arg}` };
		}

		return { kind: "error", message: `Unknown option for "paw finalize": ${arg}` };
	}

	if (summary === undefined) {
		return { kind: "error", message: 'Missing required option for "paw finalize": --summary' };
	}

	return { kind: "ok", sessionId, summary, evidence };
}

export async function createPawFinalizeCommandResult(
	repoRoot: string,
	sessionId: string,
	summary: string,
	evidence: string[],
	input: PawFinalizeCommandInput = {},
): Promise<PawFinalizeCommandResult> {
	const projectPaths = resolvePawProjectPaths(repoRoot);
	const pawDir = relative(projectPaths.repoRoot, projectPaths.pawDir) || ".paw";
	if (!(await isDirectory(projectPaths.pawDir))) {
		return {
			status: "missing_project",
			pawDir,
		};
	}

	const sessionPaths = resolvePawSessionPaths(repoRoot, sessionId);
	const relativeStateFile = relative(projectPaths.repoRoot, sessionPaths.stateFile);
	if (!(await isFile(sessionPaths.stateFile))) {
		return {
			status: "missing_session",
			sessionId,
			stateFile: relativeStateFile,
		};
	}

	const lockResult = await acquirePawSessionLock(repoRoot, sessionId, input.lockOptions);
	if (!lockResult.acquired) {
		return {
			status: "locked",
			sessionId,
			lock: lockResult.lock,
		};
	}

	const emission = await emitPawFinalReport({
		repoRoot,
		sessionId,
		reportInput: {
			summary,
			evidence: evidence.length > 0 ? evidence : [...DEFAULT_FINALIZE_EVIDENCE],
			verifyDecisions: [],
		},
		lockOptions: input.lockOptions,
	});

	const lockReleased = await releasePawSessionLock(repoRoot, sessionId, input.lockOptions);
	return mapPawFinalizeEmissionResult(sessionId, summary, emission, lockReleased);
}

export function formatPawFinalizeCommandResult(result: PawFinalizeCommandResult): string {
	switch (result.status) {
		case "completed":
			return [
				"Paw finalize",
				`session: ${result.sessionId}`,
				`status: ${result.status}`,
				`report status: ${result.reportStatus}`,
				`state: ${result.previousStateName} -> ${result.nextStateName}`,
				`summary: ${result.summary}`,
				`summary file: ${result.summaryFile}`,
				`report json file: ${result.reportJsonFile}`,
				`lock released: ${result.lockReleased ? "yes" : "no"}`,
			].join("\n");
		case "missing_project":
			return `Paw is not initialized at ${result.pawDir}. Run \`${APP_NAME} paw init\`.`;
		case "missing_session":
			return `No Paw session state found for ${result.sessionId} at ${result.stateFile}.`;
		case "locked":
			return `Paw session ${result.sessionId} is locked by pid ${result.lock.pid} on ${result.lock.host}.`;
		case "not_locked":
			return result.reason === "stale"
				? `Cannot finalize session ${result.sessionId}: session lock is stale (${result.staleReason ?? "unknown"}).`
				: `Cannot finalize session ${result.sessionId}: session lock is not held by this process.`;
		case "invalid_state":
			return `Cannot finalize session ${result.sessionId} from ${result.previousStateName}: ${formatIssues(result.issues)}`;
		case "pending_slices":
			return `Cannot finalize session ${result.sessionId} from ${result.previousStateName}: ${formatIssues(result.issues)}`;
		case "invalid_report_input":
			return `Cannot finalize session ${result.sessionId}: ${formatIssues(result.issues)}`;
		case "invalid_transition":
			return `Cannot finalize session ${result.sessionId} from ${result.previousStateName}: ${formatIssues(result.issues)}`;
	}
}

export async function runPawFinalizeCommand(args: string[]): Promise<void> {
	const parsed = parsePawFinalizeArgs(args);

	if (parsed.kind === "help") {
		printPawFinalizeHelp();
		return;
	}

	if (parsed.kind === "error") {
		printPawFinalizeCommandError(parsed.message);
		return;
	}

	try {
		console.log(
			formatPawFinalizeCommandResult(
				await createPawFinalizeCommandResult(process.cwd(), parsed.sessionId, parsed.summary, parsed.evidence),
			),
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		printPawFinalizeCommandError(message);
	}
}

function mapPawFinalizeEmissionResult(
	sessionId: string,
	summary: string,
	emission: PawFinalReportEmissionResult,
	lockReleased: boolean,
): PawFinalizeCommandResult {
	switch (emission.status) {
		case "completed":
			return {
				status: "completed",
				sessionId,
				summary,
				summaryFile: emission.summaryFile,
				reportJsonFile: emission.reportJsonFile,
				reportStatus: emission.report.status,
				previousStateName: emission.previousState.name,
				nextStateName: emission.nextState.name,
				lockReleased,
			};
		case "not_locked":
			return emission.reason === "stale"
				? {
						status: "not_locked",
						sessionId,
						reason: "stale",
						staleReason: emission.staleReason,
						lockReleased,
					}
				: {
						status: "not_locked",
						sessionId,
						reason: "unlocked",
						lockReleased,
					};
		case "locked_by_other":
			return {
				status: "locked",
				sessionId,
				lock: emission.lock,
			};
		case "invalid_state":
			return {
				status: "invalid_state",
				sessionId,
				previousStateName: emission.previousState.name,
				issues: emission.issues,
				lockReleased,
			};
		case "pending_slices":
			return {
				status: "pending_slices",
				sessionId,
				previousStateName: emission.previousState.name,
				issues: emission.issues,
				lockReleased,
			};
		case "invalid_report_input":
			return {
				status: "invalid_report_input",
				sessionId,
				previousStateName: emission.previousState.name,
				issues: emission.issues,
				lockReleased,
			};
		case "invalid_transition":
			return {
				status: "invalid_transition",
				sessionId,
				previousStateName: emission.previousState.name,
				issues: emission.issues,
				lockReleased,
			};
	}
}

async function isDirectory(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory();
	} catch (error) {
		if (isFileSystemError(error) && error.code === "ENOENT") {
			return false;
		}
		throw error;
	}
}

async function isFile(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isFile();
	} catch (error) {
		if (isFileSystemError(error) && error.code === "ENOENT") {
			return false;
		}
		throw error;
	}
}

function formatIssues(issues: readonly PawValidationIssue[]): string {
	return issues.map((issue) => `${issue.path} ${issue.message}`).join("; ");
}

function printPawFinalizeHelp(): void {
	console.log(`Usage:
  ${APP_NAME} paw finalize <session-id> --summary <text> [--evidence <text>]...

Emit the final report for a Paw session in SLICE_DONE state.

Options:
  --summary <text>     Required non-empty final report summary
  --evidence <text>    Optional evidence line (repeatable)

Commands:
  ${APP_NAME} paw finalize <session-id> --summary <text> Emit final report artifacts
  ${APP_NAME} paw finalize --help                       Show this help
`);
}

function printPawFinalizeCommandError(message: string): void {
	console.error(`Error: ${message}`);
	process.exitCode = 1;
}

function isFileSystemError(error: unknown): error is FileSystemError {
	return error instanceof Error;
}
