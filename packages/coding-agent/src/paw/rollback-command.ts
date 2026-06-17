import { readdir, stat } from "node:fs/promises";
import { relative } from "node:path";
import { APP_NAME } from "../config.ts";
import { type PawCheckpointMetadata, resolvePawCheckpointPaths, validatePawCheckpointMetadata } from "./checkpoints.ts";
import type { PawValidationIssue } from "./contracts.ts";
import { readPawJson, resolvePawProjectPaths } from "./persistence.ts";
import { readPawSessionState, resolvePawSessionPaths } from "./session-store.ts";
import type { PawSessionStateName } from "./state.ts";

export type PawRollbackCommandResult =
	| PawRollbackDryRunResult
	| PawRollbackBlockedMissingRestoreMetadataResult
	| PawRollbackMissingProjectResult
	| PawRollbackMissingSessionResult
	| PawRollbackNoCheckpointsResult
	| PawRollbackMissingCheckpointResult
	| PawRollbackInvalidCheckpointResult;

export interface PawRollbackDryRunResult {
	status: "dry_run";
	sessionId: string;
	checkpointName: string;
	metadataPath: string;
	stateName: PawSessionStateName;
	metadata: PawCheckpointMetadata;
	filesChanged: false;
	rollbackExecuted: false;
	gitTouched: false;
}

export interface PawRollbackBlockedMissingRestoreMetadataResult {
	status: "blocked_missing_restore_metadata";
	sessionId: string;
	checkpointName: string;
	metadataPath: string;
	stateName: PawSessionStateName;
	metadata: PawCheckpointMetadata;
	filesChanged: false;
	rollbackExecuted: false;
	gitTouched: false;
	blockedReason: string;
	externalSideEffectsNotReverted: readonly string[];
}

export interface PawRollbackMissingProjectResult {
	status: "missing_project";
	pawDir: string;
}

export interface PawRollbackMissingSessionResult {
	status: "missing_session";
	sessionId: string;
	stateFile: string;
}

export interface PawRollbackNoCheckpointsResult {
	status: "no_checkpoints";
	sessionId: string;
	checkpointDir: string;
}

export interface PawRollbackMissingCheckpointResult {
	status: "missing_checkpoint";
	sessionId: string;
	checkpointName: string;
	metadataFile: string;
}

export interface PawRollbackInvalidCheckpointResult {
	status: "invalid_checkpoint";
	sessionId: string;
	checkpointName: string;
	metadataFile: string;
	issues: readonly PawValidationIssue[];
}

export interface PawRollbackParsedInput {
	dryRun: boolean;
	checkpointName?: string;
}

export type PawRollbackParsedArgs =
	| { kind: "help" }
	| { kind: "error"; message: string }
	| { kind: "ok"; sessionId: string; input: PawRollbackParsedInput };

export function parsePawRollbackArgs(args: string[]): PawRollbackParsedArgs {
	if (args.some((arg) => arg === "--help" || arg === "-h")) {
		return { kind: "help" };
	}

	if (args.length === 0) {
		return { kind: "error", message: 'Missing required session id for "paw rollback".' };
	}

	const sessionId = args[0];
	if (sessionId.startsWith("-")) {
		return { kind: "error", message: 'Missing required session id for "paw rollback".' };
	}

	let dryRun = false;
	let checkpointName: string | undefined;
	const seenScalarOptions = new Set<string>();

	for (let index = 1; index < args.length; ) {
		const arg = args[index];
		if (arg === "--dry-run") {
			if (dryRun) {
				return { kind: "error", message: 'Duplicate option for "paw rollback": --dry-run' };
			}
			dryRun = true;
			index += 1;
			continue;
		}

		if (arg === "--checkpoint") {
			if (seenScalarOptions.has(arg)) {
				return { kind: "error", message: 'Duplicate option for "paw rollback": --checkpoint' };
			}
			seenScalarOptions.add(arg);
			if (index + 1 >= args.length) {
				return { kind: "error", message: 'Missing value for "paw rollback" option: --checkpoint' };
			}
			const value = args[index + 1];
			if (value.trim().length === 0) {
				return { kind: "error", message: 'Option --checkpoint for "paw rollback" must be a non-empty string.' };
			}
			checkpointName = value;
			index += 2;
			continue;
		}

		if (arg.startsWith("-")) {
			return { kind: "error", message: `Unknown option for "paw rollback": ${arg}` };
		}

		return { kind: "error", message: `Unknown option for "paw rollback": ${arg}` };
	}

	const input: PawRollbackParsedInput = { dryRun };
	if (checkpointName !== undefined) {
		input.checkpointName = checkpointName;
	}
	return { kind: "ok", sessionId, input };
}

export async function createPawRollbackCommandResult(
	repoRoot: string,
	sessionId: string,
	input: PawRollbackParsedInput,
): Promise<PawRollbackCommandResult> {
	const projectPaths = resolvePawProjectPaths(repoRoot);
	const pawDir = relative(projectPaths.repoRoot, projectPaths.pawDir) || ".paw";
	if (!(await isDirectory(projectPaths.pawDir))) {
		return { status: "missing_project", pawDir };
	}

	const sessionPaths = resolvePawSessionPaths(repoRoot, sessionId);
	const stateFile = relative(projectPaths.repoRoot, sessionPaths.stateFile);
	if (!(await isFile(sessionPaths.stateFile))) {
		return { status: "missing_session", sessionId, stateFile };
	}

	const checkpointName = input.checkpointName ?? (await findLatestPawCheckpointName(repoRoot, sessionId));
	if (checkpointName === null) {
		return {
			status: "no_checkpoints",
			sessionId,
			checkpointDir: relative(projectPaths.repoRoot, resolvePawCheckpointSessionDir(repoRoot, sessionId)),
		};
	}

	const checkpointPaths = resolvePawCheckpointPaths(repoRoot, sessionId, checkpointName);
	const metadataFile = relative(projectPaths.repoRoot, checkpointPaths.metadataFile);
	if (!(await isFile(checkpointPaths.metadataFile))) {
		return { status: "missing_checkpoint", sessionId, checkpointName, metadataFile };
	}

	const validation = validatePawCheckpointMetadata(await readPawJson<unknown>(checkpointPaths.metadataFile));
	if (!validation.ok) {
		return { status: "invalid_checkpoint", sessionId, checkpointName, metadataFile, issues: validation.issues };
	}

	const state = await readPawSessionState(repoRoot, sessionId);
	if (!input.dryRun) {
		return {
			status: "blocked_missing_restore_metadata",
			sessionId,
			checkpointName,
			metadataPath: metadataFile,
			stateName: state.name,
			metadata: validation.value,
			filesChanged: false,
			rollbackExecuted: false,
			gitTouched: false,
			blockedReason:
				"Checkpoint metadata records changed paths and content hashes only; it does not contain restorable file content or a shadow snapshot reference.",
			externalSideEffectsNotReverted: [
				"migrations",
				"installed dependencies",
				"generated artifacts outside Paw-owned file changes",
				"external service or provider side effects",
			],
		};
	}

	return {
		status: "dry_run",
		sessionId,
		checkpointName,
		metadataPath: metadataFile,
		stateName: state.name,
		metadata: validation.value,
		filesChanged: false,
		rollbackExecuted: false,
		gitTouched: false,
	};
}

export function formatPawRollbackCommandResult(result: PawRollbackCommandResult): string {
	switch (result.status) {
		case "dry_run":
			return [
				"Paw rollback dry-run",
				...formatRollbackInspectionLines(result),
				"No files were changed.",
				"No rollback was executed.",
				"Git state was not touched.",
			].join("\n");
		case "blocked_missing_restore_metadata":
			return [
				"Paw rollback blocked",
				...formatRollbackInspectionLines(result),
				`blocked: ${result.blockedReason}`,
				"External side effects not reverted:",
				...result.externalSideEffectsNotReverted.map((sideEffect) => `  - ${sideEffect}`),
				"No files were changed.",
				"No rollback was executed.",
				"Git state was not touched.",
			].join("\n");
		case "missing_project":
			return `Paw is not initialized at ${result.pawDir}. Run \`${APP_NAME} paw init\`.`;
		case "missing_session":
			return `No Paw session state found for ${result.sessionId} at ${result.stateFile}.`;
		case "no_checkpoints":
			return `Cannot dry-run rollback for session ${result.sessionId}: no checkpoints found at ${result.checkpointDir}.`;
		case "missing_checkpoint":
			return `Cannot dry-run rollback for session ${result.sessionId}: checkpoint ${result.checkpointName} was not found at ${result.metadataFile}.`;
		case "invalid_checkpoint":
			return `Cannot dry-run rollback for session ${result.sessionId}: ${formatIssues(result.issues)}`;
	}
}

export async function runPawRollbackCommand(args: string[]): Promise<void> {
	const parsed = parsePawRollbackArgs(args);
	if (parsed.kind === "help") {
		printPawRollbackHelp();
		return;
	}
	if (parsed.kind === "error") {
		printPawRollbackCommandError(parsed.message);
		return;
	}

	try {
		const result = await createPawRollbackCommandResult(process.cwd(), parsed.sessionId, parsed.input);
		console.log(formatPawRollbackCommandResult(result));
		if (result.status === "blocked_missing_restore_metadata") {
			process.exitCode = 1;
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		printPawRollbackCommandError(message);
	}
}

function resolvePawCheckpointSessionDir(repoRoot: string, sessionId: string): string {
	return resolvePawCheckpointPaths(repoRoot, sessionId, "placeholder").checkpointDir.replace(/\/placeholder$/, "");
}

async function findLatestPawCheckpointName(repoRoot: string, sessionId: string): Promise<string | null> {
	const checkpointDir = resolvePawCheckpointSessionDir(repoRoot, sessionId);
	let entries: string[];
	try {
		entries = await readdir(checkpointDir);
	} catch (error) {
		if (isFileSystemError(error) && error.code === "ENOENT") {
			return null;
		}
		throw error;
	}

	const directories: string[] = [];
	for (const entry of entries) {
		if (await isDirectory(resolvePawCheckpointPaths(repoRoot, sessionId, entry).checkpointDir)) {
			directories.push(entry);
		}
	}
	return directories.sort().at(-1) ?? null;
}

function formatRollbackInspectionLines(
	result: PawRollbackDryRunResult | PawRollbackBlockedMissingRestoreMetadataResult,
): string[] {
	return [
		`session: ${result.sessionId}`,
		`status: ${result.status}`,
		`checkpoint: ${result.checkpointName}`,
		`metadata: ${result.metadataPath}`,
		`state: ${result.stateName}`,
		`scope: ${result.metadata.scope}`,
		`slice: ${result.metadata.slice_id ?? "none"}`,
		`base tree: ${result.metadata.base_tree}`,
		`changed files: ${result.metadata.changed_files.length}`,
		...formatRollbackChangedFiles(result.metadata.changed_files),
	];
}

function formatRollbackChangedFiles(changedFiles: PawCheckpointMetadata["changed_files"]): string[] {
	if (changedFiles.length === 0) {
		return ["files: none"];
	}
	return ["files:", ...changedFiles.map((file) => `  - ${file.path} (${file.content_hash ?? "deleted"})`)];
}

function formatIssues(issues: readonly PawValidationIssue[]): string {
	return issues.map((issue) => `${issue.path} ${issue.message}`).join("; ");
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

function printPawRollbackHelp(): void {
	console.log(`Usage:
  ${APP_NAME} paw rollback <session-id> --dry-run [--checkpoint <name>]

Inspect checkpoint metadata for a future rollback without changing files.

Without --dry-run, rollback fails closed unless checkpoint metadata includes enough restorable content for a safe Paw-owned file restore.

Options:
  --dry-run            Inspect only; do not change files.
  --checkpoint <name>  Optional checkpoint name. Defaults to the latest checkpoint.

Commands:
  ${APP_NAME} paw rollback <session-id> --dry-run
  ${APP_NAME} paw rollback <session-id> --dry-run --checkpoint <name>
  ${APP_NAME} paw rollback --help

This command never runs git, resets branches, or stashes changes. Non-dry-run rollback currently fails closed when restore metadata is insufficient.
`);
}

function printPawRollbackCommandError(message: string): void {
	console.error(`Error: ${message}`);
	process.exitCode = 1;
}

interface FileSystemError extends Error {
	code?: string;
}

function isFileSystemError(error: unknown): error is FileSystemError {
	return error instanceof Error;
}
