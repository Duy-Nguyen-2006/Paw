import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { APP_NAME } from "../config.ts";
import {
	type PawCheckpointMetadata,
	type PawCheckpointRestorableFile,
	resolvePawCheckpointPaths,
	validatePawCheckpointMetadata,
} from "./checkpoints.ts";
import {
	pawCliArgsShowHelp,
	pawCliParseRequiredSessionId,
	pawCliReadScalarOptionValue,
	pawCliUnknownPositionalArg,
} from "./cli-arg-parsing.ts";
import { formatPawCliValidationIssues, isPawFileSystemError, pawCliIsDirectory, pawCliIsFile } from "./cli-fs.ts";
import type { PawValidationIssue } from "./contracts.ts";
import { readPawJson, resolvePawProjectPaths } from "./persistence.ts";
import { readPawSessionState, resolvePawSessionPaths } from "./session-store.ts";
import type { PawSessionStateName } from "./state.ts";

export type PawRollbackCommandResult =
	| PawRollbackDryRunResult
	| PawRollbackRestoredResult
	| PawRollbackBlockedMissingRestoreMetadataResult
	| PawRollbackBlockedUnsafeRestoreResult
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

export interface PawRollbackRestoredResult {
	status: "restored";
	sessionId: string;
	checkpointName: string;
	metadataPath: string;
	stateName: PawSessionStateName;
	metadata: PawCheckpointMetadata;
	filesChanged: boolean;
	rollbackExecuted: true;
	gitTouched: false;
	restoredFiles: PawRollbackRestoredFile[];
	deletedFiles: PawRollbackRestoredFile[];
	externalSideEffectsNotReverted: readonly string[];
}

export interface PawRollbackRestoredFile {
	path: string;
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

export interface PawRollbackBlockedUnsafeRestoreResult {
	status: "blocked_unsafe_restore";
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

const ROLLBACK_COMMAND_LABEL = "paw rollback";

export type PawRollbackParsedArgs =
	| { kind: "help" }
	| { kind: "error"; message: string }
	| { kind: "ok"; sessionId: string; input: PawRollbackParsedInput };

export function parsePawRollbackArgs(args: string[]): PawRollbackParsedArgs {
	if (pawCliArgsShowHelp(args)) {
		return { kind: "help" };
	}

	const sessionIdResult = pawCliParseRequiredSessionId(args, ROLLBACK_COMMAND_LABEL);
	if ("kind" in sessionIdResult) {
		return sessionIdResult;
	}

	let dryRun = false;
	let checkpointName: string | undefined;
	const seenCheckpoint = new Set<string>();

	for (let index = 1; index < args.length; ) {
		const arg = args[index];
		if (arg === "--dry-run") {
			if (dryRun) {
				return { kind: "error", message: `Duplicate option for "${ROLLBACK_COMMAND_LABEL}": --dry-run` };
			}
			dryRun = true;
			index += 1;
			continue;
		}

		if (arg === "--checkpoint") {
			const scalar = pawCliReadScalarOptionValue(ROLLBACK_COMMAND_LABEL, arg, args, index, seenCheckpoint);
			if ("kind" in scalar) {
				return scalar;
			}
			checkpointName = scalar.value;
			index = scalar.nextIndex;
			continue;
		}

		return pawCliUnknownPositionalArg(ROLLBACK_COMMAND_LABEL, arg);
	}

	const input: PawRollbackParsedInput = { dryRun };
	if (checkpointName !== undefined) {
		input.checkpointName = checkpointName;
	}
	return { kind: "ok", sessionId: sessionIdResult.sessionId, input };
}

export async function createPawRollbackCommandResult(
	repoRoot: string,
	sessionId: string,
	input: PawRollbackParsedInput,
): Promise<PawRollbackCommandResult> {
	const projectPaths = resolvePawProjectPaths(repoRoot);
	const pawDir = relative(projectPaths.repoRoot, projectPaths.pawDir) || ".paw";
	if (!(await pawCliIsDirectory(projectPaths.pawDir))) {
		return { status: "missing_project", pawDir };
	}

	const sessionPaths = resolvePawSessionPaths(repoRoot, sessionId);
	const stateFile = relative(projectPaths.repoRoot, sessionPaths.stateFile);
	if (!(await pawCliIsFile(sessionPaths.stateFile))) {
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
	if (!(await pawCliIsFile(checkpointPaths.metadataFile))) {
		return { status: "missing_checkpoint", sessionId, checkpointName, metadataFile };
	}

	const validation = validatePawCheckpointMetadata(await readPawJson<unknown>(checkpointPaths.metadataFile));
	if (!validation.ok) {
		return { status: "invalid_checkpoint", sessionId, checkpointName, metadataFile, issues: validation.issues };
	}

	const state = await readPawSessionState(repoRoot, sessionId);
	if (!input.dryRun) {
		const restoreFiles = validation.value.restore_files ?? [];
		if (restoreFiles.length === 0) {
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
					"Checkpoint metadata records changed paths and content hashes only; it does not contain restorable Paw-owned file snapshots.",
				externalSideEffectsNotReverted: getExternalSideEffectsNotReverted(),
			};
		}

		const unsafeReason = await findUnsafeRestoreReason(projectPaths.repoRoot, restoreFiles);
		if (unsafeReason !== null) {
			return {
				status: "blocked_unsafe_restore",
				sessionId,
				checkpointName,
				metadataPath: metadataFile,
				stateName: state.name,
				metadata: validation.value,
				filesChanged: false,
				rollbackExecuted: false,
				gitTouched: false,
				blockedReason: unsafeReason,
				externalSideEffectsNotReverted: getExternalSideEffectsNotReverted(),
			};
		}

		const restoredFiles = restoreFiles
			.filter((file) => file.restore_content !== null)
			.map((file) => ({ path: file.path }));
		const deletedFiles = restoreFiles
			.filter((file) => file.restore_content === null)
			.map((file) => ({ path: file.path }));
		await restorePawOwnedFiles(projectPaths.repoRoot, restoreFiles);
		return {
			status: "restored",
			sessionId,
			checkpointName,
			metadataPath: metadataFile,
			stateName: state.name,
			metadata: validation.value,
			filesChanged: restoreFiles.length > 0,
			rollbackExecuted: true,
			gitTouched: false,
			restoredFiles,
			deletedFiles,
			externalSideEffectsNotReverted: getExternalSideEffectsNotReverted(),
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
		case "restored":
			return [
				"Paw rollback restored",
				...formatRollbackInspectionLines(result),
				`restored files: ${result.restoredFiles.length}`,
				...result.restoredFiles.map((file) => `  - ${file.path}`),
				`deleted files: ${result.deletedFiles.length}`,
				...result.deletedFiles.map((file) => `  - ${file.path}`),
				"External side effects not reverted:",
				...result.externalSideEffectsNotReverted.map((sideEffect) => `  - ${sideEffect}`),
				"Rollback executed for declared Paw-owned files only.",
				"Git state was not touched.",
			].join("\n");
		case "blocked_missing_restore_metadata":
		case "blocked_unsafe_restore":
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
			return `Cannot dry-run rollback for session ${result.sessionId}: ${formatPawCliValidationIssues(result.issues)}`;
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
		if (result.status === "blocked_missing_restore_metadata" || result.status === "blocked_unsafe_restore") {
			process.exitCode = 1;
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		printPawRollbackCommandError(message);
	}
}

function getExternalSideEffectsNotReverted(): readonly string[] {
	return [
		"migrations",
		"installed dependencies",
		"generated artifacts outside Paw-owned file changes",
		"external service or provider side effects",
	];
}

async function findUnsafeRestoreReason(
	repoRoot: string,
	restoreFiles: readonly PawCheckpointRestorableFile[],
): Promise<string | null> {
	const seenPaths = new Set<string>();
	for (const file of restoreFiles) {
		const targetPath = resolveRestoreTargetPath(repoRoot, file.path);
		if (targetPath === null) {
			return `Restore path ${file.path} is outside the repository root.`;
		}
		if (seenPaths.has(file.path)) {
			return `Restore path ${file.path} is declared more than once.`;
		}
		seenPaths.add(file.path);

		if (await hasSymlinkedAncestor(repoRoot, targetPath)) {
			return `Restore path ${file.path} has a symlinked ancestor and cannot be restored safely.`;
		}

		const currentHash = await readCurrentFileHash(targetPath);
		if (currentHash !== file.current_content_hash) {
			return `Current content for ${file.path} does not match checkpoint safety hash.`;
		}
	}
	return null;
}

async function restorePawOwnedFiles(
	repoRoot: string,
	restoreFiles: readonly PawCheckpointRestorableFile[],
): Promise<void> {
	for (const file of restoreFiles) {
		const targetPath = resolveRestoreTargetPath(repoRoot, file.path);
		if (targetPath === null) {
			throw new Error(`Restore path ${file.path} is outside the repository root.`);
		}
		if (await hasSymlinkedAncestor(repoRoot, targetPath)) {
			throw new Error(`Restore path ${file.path} has a symlinked ancestor and cannot be restored safely.`);
		}
		if (file.restore_content === null) {
			await removeFileIfExists(targetPath);
			continue;
		}

		await writeRestoreContentAtomic(targetPath, file.restore_content);
	}
}

async function writeRestoreContentAtomic(targetPath: string, content: string): Promise<void> {
	const targetDir = dirname(targetPath);
	const tempPath = resolve(targetDir, `.${basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`);
	let wroteTemp = false;
	await mkdir(targetDir, { recursive: true });
	try {
		await writeFile(tempPath, content, { encoding: "utf-8", flag: "wx", mode: 0o600 });
		wroteTemp = true;
		await rename(tempPath, targetPath);
		wroteTemp = false;
	} finally {
		if (wroteTemp) {
			await removeFileIfExists(tempPath);
		}
	}
}

function resolveRestoreTargetPath(repoRoot: string, path: string): string | null {
	const root = resolve(repoRoot);
	const target = resolve(root, path);
	if (target !== root && !target.startsWith(`${root}/`)) {
		return null;
	}
	return target;
}

async function hasSymlinkedAncestor(repoRoot: string, targetPath: string): Promise<boolean> {
	const root = resolve(repoRoot);
	let currentPath = targetPath;
	for (;;) {
		if (currentPath === root) {
			return false;
		}

		try {
			if ((await lstat(currentPath)).isSymbolicLink()) {
				return true;
			}
		} catch (error) {
			if (!isPawFileSystemError(error) || error.code !== "ENOENT") {
				throw error;
			}
		}

		const parentPath = dirname(currentPath);
		if (parentPath === currentPath) {
			return true;
		}
		currentPath = parentPath;
	}
}

async function readCurrentFileHash(path: string): Promise<string | null> {
	try {
		const content = await readFile(path);
		return `sha256:${createHash("sha256").update(content).digest("hex")}`;
	} catch (error) {
		if (isPawFileSystemError(error) && error.code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

async function removeFileIfExists(path: string): Promise<void> {
	try {
		await unlink(path);
	} catch (error) {
		if (!isPawFileSystemError(error) || error.code !== "ENOENT") {
			throw error;
		}
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
		if (isPawFileSystemError(error) && error.code === "ENOENT") {
			return null;
		}
		throw error;
	}

	const directories: string[] = [];
	for (const entry of entries) {
		if (await pawCliIsDirectory(resolvePawCheckpointPaths(repoRoot, sessionId, entry).checkpointDir)) {
			directories.push(entry);
		}
	}
	return [...directories].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })).at(-1) ?? null;
}

function formatRollbackInspectionLines(
	result:
		| PawRollbackDryRunResult
		| PawRollbackRestoredResult
		| PawRollbackBlockedMissingRestoreMetadataResult
		| PawRollbackBlockedUnsafeRestoreResult,
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
