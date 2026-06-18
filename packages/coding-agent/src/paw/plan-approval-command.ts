import { stat } from "node:fs/promises";
import { relative } from "node:path";
import { APP_NAME } from "../config.ts";
import type { PawValidationIssue } from "./contracts.ts";
import { resolvePawProjectPaths } from "./persistence.ts";
import { approvePawPlanSlices, type PawPlanApprovalResult } from "./plan-approval.ts";
import type { PawPlannerSlice } from "./plan-slices.ts";
import {
	acquirePawSessionLock,
	type PawSessionLock,
	type PawSessionLockOptions,
	releasePawSessionLock,
	resolvePawSessionPaths,
} from "./session-store.ts";
import type { PawSessionStateName } from "./state.ts";

export type PawApprovePlanCommandResult =
	| PawApprovePlanCommandAdvancedResult
	| PawApprovePlanCommandMissingProjectResult
	| PawApprovePlanCommandMissingSessionResult
	| PawApprovePlanCommandLockedResult
	| PawApprovePlanCommandInvalidPlanResult
	| PawApprovePlanCommandInvalidTransitionResult
	| PawApprovePlanCommandNotLockedResult
	| PawApprovePlanCommandLockedByOtherResult;

export interface PawApprovePlanCommandInput {
	lockOptions?: PawSessionLockOptions;
}

export interface PawApprovePlanCommandAdvancedResult {
	status: "advanced";
	sessionId: string;
	queueSliceIds: readonly string[];
	previousStateName: PawSessionStateName;
	nextStateName: PawSessionStateName;
	lockReleased: boolean;
}

export interface PawApprovePlanCommandMissingProjectResult {
	status: "missing_project";
	pawDir: string;
}

export interface PawApprovePlanCommandMissingSessionResult {
	status: "missing_session";
	sessionId: string;
	stateFile: string;
}

export interface PawApprovePlanCommandLockedResult {
	status: "locked";
	sessionId: string;
	lock: PawSessionLock;
}

export interface PawApprovePlanCommandInvalidPlanResult {
	status: "invalid_plan";
	sessionId: string;
	queueSliceIds: readonly string[];
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawApprovePlanCommandInvalidTransitionResult {
	status: "invalid_transition";
	sessionId: string;
	queueSliceIds: readonly string[];
	previousStateName: PawSessionStateName;
	issues: readonly PawValidationIssue[];
	lockReleased: boolean;
}

export interface PawApprovePlanCommandNotLockedResult {
	status: "not_locked";
	sessionId: string;
	queueSliceIds: readonly string[];
	lockReleased: boolean;
}

export interface PawApprovePlanCommandLockedByOtherResult {
	status: "locked_by_other";
	sessionId: string;
	queueSliceIds: readonly string[];
	lock: PawSessionLock;
	lockReleased: boolean;
}

interface FileSystemError extends Error {
	code?: string;
}

export type PawApprovePlanParsedArgs =
	| { kind: "help" }
	| { kind: "error"; message: string }
	| { kind: "ok"; sessionId: string; sliceValues: string[] };

export function parsePawApprovePlanArgs(args: string[]): PawApprovePlanParsedArgs {
	if (args.includes("--help") || args.includes("-h")) {
		return { kind: "help" };
	}

	if (args.length === 0) {
		return { kind: "error", message: 'Missing required session id for "paw approve-plan".' };
	}

	const sessionId = args[0];
	if (sessionId.startsWith("-")) {
		return { kind: "error", message: 'Missing required session id for "paw approve-plan".' };
	}

	const sliceValues: string[] = [];
	for (let index = 1; index < args.length; ) {
		const arg = args[index];

		if (arg !== "--slice") {
			return { kind: "error", message: `Unknown option for "paw approve-plan": ${arg}` };
		}

		const error = validateSliceOption(args, index);
		if (error) return { kind: "error", message: error };
		sliceValues.push(args[index + 1]);
		index += 2;
	}

	if (sliceValues.length === 0) {
		return { kind: "error", message: 'Missing required option for "paw approve-plan": --slice' };
	}

	return { kind: "ok", sessionId, sliceValues };
}

function validateSliceOption(args: string[], index: number): string | null {
	if (index + 1 >= args.length) {
		return 'Missing value for "paw approve-plan" option: --slice';
	}
	const value = args[index + 1];
	if (value.trim().length === 0) {
		return 'Option --slice for "paw approve-plan" must be a non-empty string.';
	}
	const sliceId = value.split(":", 1)[0]?.trim() ?? "";
	if (sliceId.length === 0) {
		return 'Option --slice for "paw approve-plan" must include a non-empty slice id.';
	}
	return null;
}

export function buildPawPlannerSlicesFromCliSliceValues(sliceValues: readonly string[]): PawPlannerSlice[] {
	return sliceValues.map((value, index) => {
		const colonIndex = value.indexOf(":");
		if (colonIndex === -1) {
			const sliceId = value.trim();
			return {
				slice_id: sliceId,
				title: sliceId,
				order: index,
			};
		}

		const sliceId = value.slice(0, colonIndex).trim();
		const title = value.slice(colonIndex + 1).trim();
		return {
			slice_id: sliceId,
			title: title.length > 0 ? title : sliceId,
			order: index,
		};
	});
}

export async function createPawApprovePlanCommandResult(
	repoRoot: string,
	sessionId: string,
	sliceValues: readonly string[],
	input: PawApprovePlanCommandInput = {},
): Promise<PawApprovePlanCommandResult> {
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

	const plannerSlices = buildPawPlannerSlicesFromCliSliceValues(sliceValues);
	const queueSliceIds = plannerSlices.map((slice) => slice.slice_id);

	const lockResult = await acquirePawSessionLock(repoRoot, sessionId, input.lockOptions);
	if (!lockResult.acquired) {
		return {
			status: "locked",
			sessionId,
			lock: lockResult.lock,
		};
	}

	const approval = await approvePawPlanSlices({
		repoRoot,
		sessionId,
		plannerSlices,
		lockOptions: input.lockOptions,
	});
	const lockReleased = await releasePawSessionLock(repoRoot, sessionId, input.lockOptions);
	return mapPawApprovePlanApprovalResult(sessionId, queueSliceIds, approval, lockReleased);
}

export function formatPawApprovePlanCommandResult(result: PawApprovePlanCommandResult): string {
	switch (result.status) {
		case "advanced":
			return [
				"Paw approve-plan",
				`session: ${result.sessionId}`,
				`status: ${result.status}`,
				`queue slice ids: ${formatSliceIds(result.queueSliceIds)}`,
				`state: ${result.previousStateName} -> ${result.nextStateName}`,
				`lock released: ${result.lockReleased ? "yes" : "no"}`,
			].join("\n");
		case "missing_project":
			return `Paw is not initialized at ${result.pawDir}. Run \`${APP_NAME} paw init\`.`;
		case "missing_session":
			return `No Paw session state found for ${result.sessionId} at ${result.stateFile}.`;
		case "locked":
			return `Paw session ${result.sessionId} is locked by pid ${result.lock.pid} on ${result.lock.host}.`;
		case "invalid_plan":
			return `Cannot approve plan for session ${result.sessionId}: ${formatIssues(result.issues)}`;
		case "invalid_transition":
			return `Cannot approve plan for session ${result.sessionId} from ${result.previousStateName}: ${formatIssues(result.issues)}`;
		case "not_locked":
			return `Cannot approve plan for session ${result.sessionId}: session lock is not held by this process.`;
		case "locked_by_other":
			return `Cannot approve plan for session ${result.sessionId}: locked by pid ${result.lock.pid} on ${result.lock.host}.`;
	}
}

export async function runPawApprovePlanCommand(args: string[]): Promise<void> {
	const parsed = parsePawApprovePlanArgs(args);

	if (parsed.kind === "help") {
		printPawApprovePlanHelp();
		return;
	}

	if (parsed.kind === "error") {
		printPawApprovePlanCommandError(parsed.message);
		return;
	}

	try {
		console.log(
			formatPawApprovePlanCommandResult(
				await createPawApprovePlanCommandResult(process.cwd(), parsed.sessionId, parsed.sliceValues),
			),
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		printPawApprovePlanCommandError(message);
	}
}

function mapPawApprovePlanApprovalResult(
	sessionId: string,
	queueSliceIds: readonly string[],
	approval: PawPlanApprovalResult,
	lockReleased: boolean,
): PawApprovePlanCommandResult {
	switch (approval.status) {
		case "invalid_plan":
			return {
				status: "invalid_plan",
				sessionId,
				queueSliceIds,
				issues: approval.issues,
				lockReleased,
			};
		case "advanced":
			return {
				status: "advanced",
				sessionId,
				queueSliceIds,
				previousStateName: approval.advance.previousState.name,
				nextStateName: approval.advance.nextState.name,
				lockReleased,
			};
		case "invalid_transition":
			return {
				status: "invalid_transition",
				sessionId,
				queueSliceIds,
				previousStateName: approval.advance.previousState.name,
				issues: approval.advance.issues,
				lockReleased,
			};
		case "not_locked":
			return {
				status: "not_locked",
				sessionId,
				queueSliceIds,
				lockReleased,
			};
		case "locked_by_other":
			return {
				status: "locked_by_other",
				sessionId,
				queueSliceIds,
				lock: approval.advance.lock,
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

function formatSliceIds(sliceIds: readonly string[]): string {
	if (sliceIds.length === 0) {
		return "none";
	}
	return sliceIds.join(", ");
}

function formatIssues(issues: readonly PawValidationIssue[]): string {
	return issues.map((issue) => `${issue.path} ${issue.message}`).join("; ");
}

function printPawApprovePlanHelp(): void {
	console.log(`Usage:
  ${APP_NAME} paw approve-plan <session-id> --slice <slice-id>[:<title>]...

Approve a Paw plan from PLAN_DRAFTED and persist ordered pending slice ids.

Options:
  --slice <slice-id>[:<title>]  Required planner slice (repeatable, order preserved)

Commands:
  ${APP_NAME} paw approve-plan <session-id> --slice <id>[:<title>]...  Approve plan slices
  ${APP_NAME} paw approve-plan --help                                   Show this help
`);
}

function printPawApprovePlanCommandError(message: string): void {
	console.error(`Error: ${message}`);
	process.exitCode = 1;
}

function isFileSystemError(error: unknown): error is FileSystemError {
	return error instanceof Error;
}
