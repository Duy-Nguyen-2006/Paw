import { relative } from "node:path";
import { APP_NAME } from "../config.ts";
import {
	type PawCliScalarFieldBinding,
	pawCliArgsShowHelp,
	pawCliParseRequiredSessionId,
	pawCliParseScalarFieldsFromArgs,
} from "./cli-arg-parsing.ts";
import { formatPawCliValidationIssues, pawCliIsDirectory, pawCliIsFile } from "./cli-fs.ts";
import type { PawSubAgentOutput, PawValidationIssue } from "./contracts.ts";
import { mapPawNotLockedCommandFields } from "./lock-result-mapping.ts";
import { resolvePawProjectPaths } from "./persistence.ts";
import { completePawReviewerPass, type PawReviewerPassResult } from "./reviewer-result.ts";
import {
	acquirePawSessionLock,
	type PawSessionLock,
	type PawSessionLockOptions,
	type PawSessionLockStaleReason,
	releasePawSessionLock,
	resolvePawSessionPaths,
} from "./session-store.ts";
import type { PawSessionStateName } from "./state.ts";
import { readPawSubAgentOutputFile } from "./subagent-output-file.ts";

const COMPLETE_REVIEWER_COMMAND_LABEL = "paw complete-reviewer";

export type PawCompleteReviewerCommandResult =
	| PawCompleteReviewerCommandCompletedResult
	| PawCompleteReviewerCommandInvalidOutputFileResult
	| PawCompleteReviewerCommandMissingOutputFileResult
	| PawCompleteReviewerCommandMissingProjectResult
	| PawCompleteReviewerCommandMissingSessionResult
	| PawCompleteReviewerCommandLockedResult
	| PawCompleteReviewerCommandInvalidStateResult
	| PawCompleteReviewerCommandNoSelectedSliceResult
	| PawCompleteReviewerCommandInvalidReviewerOutputResult
	| PawCompleteReviewerCommandReviewerNotPassedResult
	| PawCompleteReviewerCommandInvalidTransitionResult
	| PawCompleteReviewerCommandNotLockedResult
	| PawCompleteReviewerCommandLockedByOtherResult;

export interface PawCompleteReviewerCommandInput {
	lockOptions?: PawSessionLockOptions;
}

export interface PawCompleteReviewerCommandCompletedResult {
	status: "completed";
	sessionId: string;
	selectedSliceId: string;
	previousStateName: PawSessionStateName;
	nextStateName: PawSessionStateName;
	lockReleased: boolean;
}

export interface PawCompleteReviewerCommandInvalidOutputFileResult {
	status: "invalid_output_file";
	sessionId: string;
	outputFile: string;
	issues: readonly PawValidationIssue[];
}

export interface PawCompleteReviewerCommandMissingOutputFileResult {
	status: "missing_output_file";
	sessionId: string;
	outputFile: string;
}

export interface PawCompleteReviewerCommandMissingProjectResult {
	status: "missing_project";
	pawDir: string;
}

export interface PawCompleteReviewerCommandMissingSessionResult {
	status: "missing_session";
	sessionId: string;
	stateFile: string;
}

export interface PawCompleteReviewerCommandLockedResult {
	status: "locked";
	sessionId: string;
	lock: PawSessionLock;
}

export interface PawCompleteReviewerCommandInvalidStateResult {
	status: "invalid_state";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawCompleteReviewerCommandNoSelectedSliceResult {
	status: "no_selected_slice";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawCompleteReviewerCommandInvalidReviewerOutputResult {
	status: "invalid_reviewer_output";
	sessionId: string;
	previousStateName: PawSessionStateName;
	reviewerOutput: PawSubAgentOutput;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawCompleteReviewerCommandReviewerNotPassedResult {
	status: "reviewer_not_passed";
	sessionId: string;
	previousStateName: PawSessionStateName;
	reviewerStatus: PawSubAgentOutput["status"];
	lockReleased: boolean;
}

export interface PawCompleteReviewerCommandInvalidTransitionResult {
	status: "invalid_transition";
	sessionId: string;
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawCompleteReviewerCommandNotLockedResult {
	status: "not_locked";
	sessionId: string;
	reason: "unlocked" | "stale";
	staleReason?: PawSessionLockStaleReason;
	lockReleased: boolean;
}

export interface PawCompleteReviewerCommandLockedByOtherResult {
	status: "locked_by_other";
	sessionId: string;
	lock: PawSessionLock;
	lockReleased: boolean;
}

export interface PawCompleteReviewerParsedInput {
	outputFile: string;
}

export type PawCompleteReviewerParsedArgs =
	| { kind: "help" }
	| { kind: "error"; message: string }
	| { kind: "ok"; sessionId: string; input: PawCompleteReviewerParsedInput };

const COMPLETE_REVIEWER_SCALAR_OPTIONS = new Set(["--output-file"]);

export function parsePawCompleteReviewerArgs(args: string[]): PawCompleteReviewerParsedArgs {
	if (pawCliArgsShowHelp(args)) {
		return { kind: "help" };
	}

	const sessionIdResult = pawCliParseRequiredSessionId(args, COMPLETE_REVIEWER_COMMAND_LABEL);
	if ("kind" in sessionIdResult) {
		return sessionIdResult;
	}

	let outputFile: string | undefined;
	const bindings: PawCliScalarFieldBinding[] = [
		{
			option: "--output-file",
			set: (value) => {
				outputFile = value;
			},
		},
	];
	const fields = pawCliParseScalarFieldsFromArgs(
		COMPLETE_REVIEWER_COMMAND_LABEL,
		args,
		1,
		COMPLETE_REVIEWER_SCALAR_OPTIONS,
		bindings,
	);
	if ("kind" in fields) {
		return fields;
	}

	if (outputFile === undefined) {
		return {
			kind: "error",
			message: `Missing required option for "${COMPLETE_REVIEWER_COMMAND_LABEL}": --output-file`,
		};
	}

	return { kind: "ok", sessionId: sessionIdResult.sessionId, input: { outputFile } };
}

export async function createPawCompleteReviewerCommandResult(
	repoRoot: string,
	sessionId: string,
	input: PawCompleteReviewerParsedInput,
	commandInput: PawCompleteReviewerCommandInput = {},
): Promise<PawCompleteReviewerCommandResult> {
	const relativeOutputFile = relative(repoRoot, input.outputFile) || input.outputFile;
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

	const outputRead = await readPawSubAgentOutputFile(input.outputFile);
	if (outputRead.kind === "missing") {
		return {
			status: "missing_output_file",
			sessionId,
			outputFile: relativeOutputFile,
		};
	}
	if (outputRead.kind === "invalid") {
		return {
			status: "invalid_output_file",
			sessionId,
			outputFile: relativeOutputFile,
			issues: outputRead.issues,
		};
	}

	const lockResult = await acquirePawSessionLock(repoRoot, sessionId, commandInput.lockOptions);
	if (!lockResult.acquired) {
		return {
			status: "locked",
			sessionId,
			lock: lockResult.lock,
		};
	}

	const completion = await completePawReviewerPass({
		repoRoot,
		sessionId,
		reviewerOutput: outputRead.value,
		lockOptions: commandInput.lockOptions,
	});
	const lockReleased = await releasePawSessionLock(repoRoot, sessionId, commandInput.lockOptions);
	return mapPawCompleteReviewerResult(sessionId, completion, lockReleased);
}

export function formatPawCompleteReviewerCommandResult(result: PawCompleteReviewerCommandResult): string {
	switch (result.status) {
		case "completed":
			return [
				"Paw complete-reviewer",
				`session: ${result.sessionId}`,
				`status: ${result.status}`,
				`selected slice: ${result.selectedSliceId}`,
				`state: ${result.previousStateName} -> ${result.nextStateName}`,
				`lock released: ${result.lockReleased ? "yes" : "no"}`,
			].join("\n");
		case "invalid_output_file":
			return `Cannot complete reviewer pass for session ${result.sessionId}: invalid reviewer output at ${result.outputFile}: ${formatPawCliValidationIssues(result.issues)}`;
		case "missing_output_file":
			return `Cannot complete reviewer pass for session ${result.sessionId}: reviewer output file not found at ${result.outputFile}.`;
		case "missing_project":
			return `Paw is not initialized at ${result.pawDir}. Run \`${APP_NAME} paw init\`.`;
		case "missing_session":
			return `No Paw session state found for ${result.sessionId} at ${result.stateFile}.`;
		case "locked":
			return `Paw session ${result.sessionId} is locked by pid ${result.lock.pid} on ${result.lock.host}.`;
		case "invalid_state":
			return `Cannot complete reviewer pass for session ${result.sessionId} from ${result.previousStateName}: ${formatPawCliValidationIssues(result.issues)}`;
		case "no_selected_slice":
			return `Cannot complete reviewer pass for session ${result.sessionId}: no selected slice in ${result.previousStateName}.`;
		case "invalid_reviewer_output":
			return `Cannot complete reviewer pass for session ${result.sessionId}: ${formatPawCliValidationIssues(result.issues)}`;
		case "reviewer_not_passed":
			return `Cannot complete reviewer pass for session ${result.sessionId}: reviewer output status is ${result.reviewerStatus}, expected pass.`;
		case "invalid_transition":
			return `Cannot complete reviewer pass for session ${result.sessionId} from ${result.previousStateName}: ${formatPawCliValidationIssues(result.issues)}`;
		case "not_locked":
			return result.reason === "stale"
				? `Cannot complete reviewer pass for session ${result.sessionId}: session lock is stale (${result.staleReason ?? "unknown"}).`
				: `Cannot complete reviewer pass for session ${result.sessionId}: session lock is not held by this process.`;
		case "locked_by_other":
			return `Cannot complete reviewer pass for session ${result.sessionId}: locked by pid ${result.lock.pid} on ${result.lock.host}.`;
	}
}

export async function runPawCompleteReviewerCommand(args: string[]): Promise<void> {
	const parsed = parsePawCompleteReviewerArgs(args);

	if (parsed.kind === "help") {
		printPawCompleteReviewerHelp();
		return;
	}

	if (parsed.kind === "error") {
		printPawCompleteReviewerCommandError(parsed.message);
		return;
	}

	try {
		console.log(
			formatPawCompleteReviewerCommandResult(
				await createPawCompleteReviewerCommandResult(process.cwd(), parsed.sessionId, parsed.input),
			),
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		printPawCompleteReviewerCommandError(message);
	}
}

function mapPawCompleteReviewerResult(
	sessionId: string,
	completion: PawReviewerPassResult,
	lockReleased: boolean,
): PawCompleteReviewerCommandResult {
	switch (completion.status) {
		case "completed":
			return {
				status: "completed",
				sessionId,
				selectedSliceId: completion.previousState.current_slice_id ?? "",
				previousStateName: completion.previousState.name,
				nextStateName: completion.nextState.name,
				lockReleased,
			};
		case "invalid_state":
			return {
				status: "invalid_state",
				sessionId,
				previousStateName: completion.previousState.name,
				issues: completion.issues,
				lockReleased,
			};
		case "no_selected_slice":
			return {
				status: "no_selected_slice",
				sessionId,
				previousStateName: completion.previousState.name,
				issues: completion.issues,
				lockReleased,
			};
		case "invalid_reviewer_output":
			return {
				status: "invalid_reviewer_output",
				sessionId,
				previousStateName: completion.previousState.name,
				reviewerOutput: completion.reviewerOutput,
				issues: completion.issues,
				lockReleased,
			};
		case "reviewer_not_passed":
			return {
				status: "reviewer_not_passed",
				sessionId,
				previousStateName: completion.previousState.name,
				reviewerStatus: completion.reviewerOutput.status,
				lockReleased,
			};
		case "invalid_transition":
			return {
				status: "invalid_transition",
				sessionId,
				previousStateName: completion.previousState.name,
				issues: completion.issues,
				lockReleased,
			};
		case "not_locked":
			return mapPawNotLockedCommandFields(
				sessionId,
				completion.reason,
				lockReleased,
				completion.reason === "stale" ? completion.staleReason : undefined,
			);
		case "locked_by_other":
			return {
				status: "locked_by_other",
				sessionId,
				lock: completion.lock,
				lockReleased,
			};
	}
}

function printPawCompleteReviewerHelp(): void {
	console.log(`Usage:
  ${APP_NAME} paw complete-reviewer <session-id> --output-file <path>

Complete a reviewer pass from REVIEWING to VERIFYING using reviewer sub-agent output JSON.

Options:
  --output-file <path>  Required reviewer sub-agent output JSON file

Commands:
  ${APP_NAME} paw complete-reviewer <session-id> --output-file <path>  Complete reviewer pass
  ${APP_NAME} paw complete-reviewer --help                                   Show this help
`);
}

function printPawCompleteReviewerCommandError(message: string): void {
	console.error(`Error: ${message}`);
	process.exitCode = 1;
}
