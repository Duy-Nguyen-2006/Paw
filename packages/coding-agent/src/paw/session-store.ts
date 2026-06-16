import { type FileHandle, mkdir, open, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { readPawJson, resolvePawProjectPaths, writePawJsonAtomic } from "./persistence.ts";
import { assertValidPawSessionState, type PawBlockedReason, type PawSessionState } from "./state.ts";

export const DEFAULT_PAW_SESSION_LOCK_TTL_SEC = 120;

export interface PawSessionPaths {
	repoRoot: string;
	sessionId: string;
	sessionDir: string;
	stateFile: string;
	sliceJournalFile: string;
	summaryFile: string;
	transcriptFile: string;
	lockFile: string;
}

export interface PawSessionLock {
	pid: number;
	host: string;
	heartbeat_ts: number;
	ttl: number;
}

export type PawSessionLockStaleReason = "dead_pid" | "expired_heartbeat";

export interface PawSessionLockOptions {
	nowMs?: number;
	ttlSec?: number;
	pid?: number;
	host?: string;
}

export type PawLockAcquireResult =
	| {
			acquired: true;
			lock: PawSessionLock;
			reclaimed: {
				reason: PawSessionLockStaleReason;
				lock: PawSessionLock;
			} | null;
	  }
	| {
			acquired: false;
			reason: "live_lock";
			lock: PawSessionLock;
	  };

export type PawSessionLockStatus =
	| { status: "unlocked" }
	| { status: "locked"; lock: PawSessionLock }
	| { status: "stale"; reason: PawSessionLockStaleReason; lock: PawSessionLock };

interface FileSystemError extends Error {
	code?: string;
}

interface PawStoreValidationIssue {
	path: string;
	message: string;
}

export function resolvePawSessionPaths(repoRoot: string, sessionId: string): PawSessionPaths {
	assertValidSessionId(sessionId);

	const projectPaths = resolvePawProjectPaths(repoRoot);
	const sessionDir = join(projectPaths.pawDir, "sessions", sessionId);

	return {
		repoRoot: projectPaths.repoRoot,
		sessionId,
		sessionDir,
		stateFile: join(sessionDir, "state.json"),
		sliceJournalFile: join(sessionDir, "slice-journal.jsonl"),
		summaryFile: join(sessionDir, "summary.md"),
		transcriptFile: join(sessionDir, "transcript.jsonl"),
		lockFile: join(sessionDir, "session.lock"),
	};
}

export async function writePawSessionState(repoRoot: string, state: PawSessionState): Promise<void> {
	const validation = assertValidPawSessionState(state);
	if (!validation.ok) {
		throw new Error(formatValidationIssues("Invalid Paw session state", validation.issues));
	}

	const paths = resolvePawSessionPaths(repoRoot, validation.value.session_id);
	await writePawJsonAtomic(paths.stateFile, validation.value);
}

export async function readPawSessionState(repoRoot: string, sessionId: string): Promise<PawSessionState> {
	const paths = resolvePawSessionPaths(repoRoot, sessionId);
	return parsePawSessionState(await readPawJson<unknown>(paths.stateFile));
}

export async function acquirePawSessionLock(
	repoRoot: string,
	sessionId: string,
	options: PawSessionLockOptions = {},
): Promise<PawLockAcquireResult> {
	const paths = resolvePawSessionPaths(repoRoot, sessionId);
	const nextLock = createPawSessionLock(options);

	for (let attempt = 0; attempt < 5; attempt += 1) {
		if (await tryCreateLockFile(paths.lockFile, nextLock)) {
			return { acquired: true, lock: nextLock, reclaimed: null };
		}

		const status = await getPawSessionLockStatus(repoRoot, sessionId, options);
		if (status.status === "unlocked") {
			continue;
		}
		if (status.status === "locked") {
			return { acquired: false, reason: "live_lock", lock: status.lock };
		}

		await removeFileIfExists(paths.lockFile);
		if (await tryCreateLockFile(paths.lockFile, nextLock)) {
			return {
				acquired: true,
				lock: nextLock,
				reclaimed: {
					reason: status.reason,
					lock: status.lock,
				},
			};
		}
	}

	const status = await getPawSessionLockStatus(repoRoot, sessionId, options);
	if (status.status === "locked") {
		return { acquired: false, reason: "live_lock", lock: status.lock };
	}
	throw new Error(`Unable to acquire Paw session lock for ${sessionId}.`);
}

export async function getPawSessionLockStatus(
	repoRoot: string,
	sessionId: string,
	options: PawSessionLockOptions = {},
): Promise<PawSessionLockStatus> {
	const paths = resolvePawSessionPaths(repoRoot, sessionId);
	const lock = await readPawSessionLockIfExists(paths.lockFile);
	if (lock === null) {
		return { status: "unlocked" };
	}

	const staleReason = getPawSessionLockStaleReason(lock, options);
	if (staleReason !== null) {
		return { status: "stale", reason: staleReason, lock };
	}

	return { status: "locked", lock };
}

export async function refreshPawSessionLockHeartbeat(
	repoRoot: string,
	sessionId: string,
	options: PawSessionLockOptions = {},
): Promise<PawSessionLock | null> {
	const paths = resolvePawSessionPaths(repoRoot, sessionId);
	const status = await getPawSessionLockStatus(repoRoot, sessionId, options);
	if (status.status === "unlocked" || !isCurrentOwner(status.lock, options)) {
		return null;
	}

	const refreshedLock: PawSessionLock = {
		...status.lock,
		heartbeat_ts: options.nowMs ?? Date.now(),
		ttl: options.ttlSec ?? status.lock.ttl,
	};
	assertValidPawSessionLock(refreshedLock);

	await writePawJsonAtomic(paths.lockFile, refreshedLock);
	return refreshedLock;
}

export async function releasePawSessionLock(
	repoRoot: string,
	sessionId: string,
	options: PawSessionLockOptions = {},
): Promise<boolean> {
	const paths = resolvePawSessionPaths(repoRoot, sessionId);
	const status = await getPawSessionLockStatus(repoRoot, sessionId, options);
	if (status.status === "unlocked" || !isCurrentOwner(status.lock, options)) {
		return false;
	}

	return removeFileIfExists(paths.lockFile);
}

function createPawSessionLock(options: PawSessionLockOptions): PawSessionLock {
	const lock: PawSessionLock = {
		pid: options.pid ?? process.pid,
		host: options.host ?? hostname(),
		heartbeat_ts: options.nowMs ?? Date.now(),
		ttl: options.ttlSec ?? DEFAULT_PAW_SESSION_LOCK_TTL_SEC,
	};
	assertValidPawSessionLock(lock);
	return lock;
}

async function readPawSessionLockIfExists(lockFile: string): Promise<PawSessionLock | null> {
	try {
		return parsePawSessionLock(await readPawJson<unknown>(lockFile));
	} catch (error) {
		if (isFileSystemError(error) && error.code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

function getPawSessionLockStaleReason(
	lock: PawSessionLock,
	options: PawSessionLockOptions,
): PawSessionLockStaleReason | null {
	const currentHost = options.host ?? hostname();
	if (lock.host === currentHost && !isProcessAlive(lock.pid)) {
		return "dead_pid";
	}

	const nowMs = options.nowMs ?? Date.now();
	if (nowMs - lock.heartbeat_ts > lock.ttl * 1000) {
		return "expired_heartbeat";
	}

	return null;
}

function isCurrentOwner(lock: PawSessionLock, options: PawSessionLockOptions): boolean {
	return lock.pid === (options.pid ?? process.pid) && lock.host === (options.host ?? hostname());
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if (isFileSystemError(error) && (error.code === "ESRCH" || error.code === "EINVAL")) {
			return false;
		}
		return true;
	}
}

async function tryCreateLockFile(lockFile: string, lock: PawSessionLock): Promise<boolean> {
	await mkdir(dirname(lockFile), { recursive: true });

	const serialized = JSON.stringify(lock, null, "\t");
	if (serialized === undefined) {
		throw new Error("Cannot write undefined as JSON.");
	}

	let handle: FileHandle | undefined;
	let createdPath = false;
	let writeError: unknown;
	try {
		handle = await open(lockFile, "wx", 0o600);
		createdPath = true;
		await handle.writeFile(`${serialized}\n`, "utf-8");
		await handle.sync();
	} catch (error) {
		if (!createdPath && isFileSystemError(error) && error.code === "EEXIST") {
			return false;
		}
		writeError = error;
	} finally {
		await handle?.close();
	}

	if (writeError !== undefined) {
		if (createdPath) {
			await removeFileIfExists(lockFile);
		}
		throw writeError;
	}

	await syncDirectory(dirname(lockFile));
	return true;
}

async function syncDirectory(dirPath: string): Promise<void> {
	let handle: FileHandle | undefined;
	try {
		handle = await open(dirPath, "r");
		await handle.sync();
	} catch (error) {
		if (!isIgnorableDirectorySyncError(error)) {
			throw error;
		}
	} finally {
		await handle?.close();
	}
}

async function removeFileIfExists(filePath: string): Promise<boolean> {
	try {
		await unlink(filePath);
		await syncDirectory(dirname(filePath));
		return true;
	} catch (error) {
		if (isFileSystemError(error) && error.code === "ENOENT") {
			return false;
		}
		throw error;
	}
}

function parsePawSessionState(value: unknown): PawSessionState {
	const issues: PawStoreValidationIssue[] = [];
	const record = readRecord(value, "", issues);

	const state: PawSessionState = {
		session_id: readString(record, "session_id", issues),
		name: readString(record, "name", issues) as PawSessionState["name"],
		current_slice_id: readNullableString(record, "current_slice_id", issues),
		pending_slice_ids: readStringArray(record, "pending_slice_ids", issues),
		completed_slice_ids: readStringArray(record, "completed_slice_ids", issues),
		blocked_reason: readBlockedReason(record, issues),
	};

	if (issues.length > 0) {
		throw new Error(formatValidationIssues("Invalid Paw session state", issues));
	}

	const validation = assertValidPawSessionState(state);
	if (!validation.ok) {
		throw new Error(formatValidationIssues("Invalid Paw session state", validation.issues));
	}

	return validation.value;
}

function parsePawSessionLock(value: unknown): PawSessionLock {
	const issues: PawStoreValidationIssue[] = [];
	const record = readRecord(value, "", issues);
	const lock: PawSessionLock = {
		pid: readNumber(record, "pid", issues),
		host: readString(record, "host", issues),
		heartbeat_ts: readNumber(record, "heartbeat_ts", issues),
		ttl: readNumber(record, "ttl", issues),
	};

	if (issues.length > 0) {
		throw new Error(formatValidationIssues("Invalid Paw session lock", issues));
	}

	assertValidPawSessionLock(lock);
	return lock;
}

function assertValidPawSessionLock(lock: PawSessionLock): void {
	const issues: PawStoreValidationIssue[] = [];
	if (!Number.isInteger(lock.pid) || lock.pid <= 0) {
		issues.push({ path: "/pid", message: "Lock pid must be a positive integer." });
	}
	if (lock.host.trim() === "") {
		issues.push({ path: "/host", message: "Lock host is required." });
	}
	if (!Number.isFinite(lock.heartbeat_ts)) {
		issues.push({ path: "/heartbeat_ts", message: "Lock heartbeat timestamp must be finite." });
	}
	if (!Number.isFinite(lock.ttl) || lock.ttl < 0) {
		issues.push({ path: "/ttl", message: "Lock ttl must be a non-negative number of seconds." });
	}
	if (issues.length > 0) {
		throw new Error(formatValidationIssues("Invalid Paw session lock", issues));
	}
}

function readBlockedReason(
	record: Record<string, unknown>,
	issues: PawStoreValidationIssue[],
): PawBlockedReason | null {
	const value = record.blocked_reason;
	if (value === null) {
		return null;
	}

	const blockedReasonRecord = readRecord(value, "/blocked_reason", issues);
	return {
		code: readString(blockedReasonRecord, "code", issues, "/blocked_reason") as PawBlockedReason["code"],
		message: readString(blockedReasonRecord, "message", issues, "/blocked_reason"),
		suggested_action: readString(blockedReasonRecord, "suggested_action", issues, "/blocked_reason"),
		slice_id: readNullableString(blockedReasonRecord, "slice_id", issues, "/blocked_reason"),
		resume_state: readString(
			blockedReasonRecord,
			"resume_state",
			issues,
			"/blocked_reason",
		) as PawBlockedReason["resume_state"],
	};
}

function readRecord(value: unknown, path: string, issues: PawStoreValidationIssue[]): Record<string, unknown> {
	if (isRecord(value)) {
		return value;
	}

	issues.push({ path: path || "/", message: "Expected object." });
	return {};
}

function readString(
	record: Record<string, unknown>,
	key: string,
	issues: PawStoreValidationIssue[],
	prefix = "",
): string {
	const value = record[key];
	if (typeof value === "string") {
		return value;
	}

	issues.push({ path: `${prefix}/${key}`, message: "Expected string." });
	return "";
}

function readNullableString(
	record: Record<string, unknown>,
	key: string,
	issues: PawStoreValidationIssue[],
	prefix = "",
): string | null {
	const value = record[key];
	if (value === null) {
		return null;
	}
	if (typeof value === "string") {
		return value;
	}

	issues.push({ path: `${prefix}/${key}`, message: "Expected string or null." });
	return null;
}

function readStringArray(record: Record<string, unknown>, key: string, issues: PawStoreValidationIssue[]): string[] {
	const value = record[key];
	if (isStringArray(value)) {
		return value;
	}

	issues.push({ path: `/${key}`, message: "Expected string array." });
	return [];
}

function readNumber(record: Record<string, unknown>, key: string, issues: PawStoreValidationIssue[]): number {
	const value = record[key];
	if (typeof value === "number") {
		return value;
	}

	issues.push({ path: `/${key}`, message: "Expected number." });
	return Number.NaN;
}

function assertValidSessionId(sessionId: string): void {
	if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(sessionId)) {
		throw new Error(
			"Paw session id must be non-empty, contain only alphanumeric characters, '-', '_', and '.', and start and end with an alphanumeric character.",
		);
	}
}

function formatValidationIssues(prefix: string, issues: readonly PawStoreValidationIssue[]): string {
	return `${prefix}: ${issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isFileSystemError(error: unknown): error is FileSystemError {
	return error instanceof Error;
}

function isIgnorableDirectorySyncError(error: unknown): boolean {
	return (
		isFileSystemError(error) &&
		(error.code === "EISDIR" ||
			error.code === "EINVAL" ||
			error.code === "ENOTSUP" ||
			error.code === "EPERM" ||
			error.code === "EACCES")
	);
}
