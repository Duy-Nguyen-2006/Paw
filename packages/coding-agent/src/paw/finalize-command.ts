import { relative } from "node:path";
import { APP_NAME } from "../config.ts";
import {
	pawCliArgsShowHelp,
	pawCliCollectRepeatableScalarOption,
	pawCliParseRequiredSessionId,
	pawCliReadScalarOptionValue,
} from "./cli-arg-parsing.ts";
import { formatPawCliValidationIssues, pawCliIsDirectory, pawCliIsFile } from "./cli-fs.ts";
import type { PawValidationIssue } from "./contracts.ts";
import { emitPawFinalReport, type PawFinalReportEmissionResult } from "./final-report-emission.ts";
import { mapPawNotLockedCommandFields } from "./lock-result-mapping.ts";
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

const FINALIZE_COMMAND_LABEL = "paw finalize";

function pawCliParseFinalizeSummaryOption(
	args: readonly string[],
): PawFinalizeParsedArgs | { summary: string; nextIndex: number } {
	if (args.length < 2 || args[1] !== "--summary") {
		return { kind: "error", message: `Missing required option for "${FINALIZE_COMMAND_LABEL}": --summary` };
	}
	const scalar = pawCliReadScalarOptionValue(FINALIZE_COMMAND_LABEL, "--summary", args, 1, new Set());
	if ("kind" in scalar) {
		return scalar;
	}
	return { summary: scalar.value, nextIndex: scalar.nextIndex };
}

export type PawFinalizeParsedArgs =
	| { kind: "help" }
	| { kind: "error"; message: string }
	| { kind: "ok"; sessionId: string; summary: string; evidence: string[] };

export function parsePawFinalizeArgs(args: string[]): PawFinalizeParsedArgs {
	if (pawCliArgsShowHelp(args)) {
		return { kind: "help" };
	}

	const sessionIdResult = pawCliParseRequiredSessionId(args, FINALIZE_COMMAND_LABEL);
	if ("kind" in sessionIdResult) {
		return sessionIdResult;
	}

	const summaryParse = pawCliParseFinalizeSummaryOption(args);
	if ("kind" in summaryParse) {
		return summaryParse;
	}
	const { summary, nextIndex } = summaryParse;

	const evidenceParse = pawCliCollectRepeatableScalarOption(FINALIZE_COMMAND_LABEL, "--evidence", args, nextIndex);
	if ("kind" in evidenceParse) {
		return evidenceParse;
	}
	const { values: evidence, nextIndex: afterEvidence } = evidenceParse;

	if (afterEvidence < args.length) {
		return { kind: "error", message: `Unknown option for "${FINALIZE_COMMAND_LABEL}": ${args[afterEvidence]}` };
	}

	return { kind: "ok", sessionId: sessionIdResult.sessionId, summary, evidence };
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
	if (!(await pawCliIsDirectory(projectPaths.pawDir))) {
		return {
			status: "missing_project",
			pawDir,
		};
	}

	const sessionPaths = resolvePawSessionPaths(repoRoot, sessionId);
	const relativeStateFile = relative(projectPaths.repoRoot, sessionPaths.stateFile);
	if (!(await pawCliIsFile(sessionPaths.stateFile))) {
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
			return `Cannot finalize session ${result.sessionId} from ${result.previousStateName}: ${formatPawCliValidationIssues(result.issues)}`;
		case "pending_slices":
			return `Cannot finalize session ${result.sessionId} from ${result.previousStateName}: ${formatPawCliValidationIssues(result.issues)}`;
		case "invalid_report_input":
			return `Cannot finalize session ${result.sessionId}: ${formatPawCliValidationIssues(result.issues)}`;
		case "invalid_transition":
			return `Cannot finalize session ${result.sessionId} from ${result.previousStateName}: ${formatPawCliValidationIssues(result.issues)}`;
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
			return mapPawNotLockedCommandFields(
				sessionId,
				emission.reason,
				lockReleased,
				emission.reason === "stale" ? emission.staleReason : undefined,
			);
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
