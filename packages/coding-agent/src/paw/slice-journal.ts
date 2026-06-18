
import { type FileHandle, mkdir, open, readFile } from "node:fs/promises";
import { resolvePawSessionPaths } from "./session-store.ts";

export type PawSliceJournalChangeType = "create" | "modify" | "delete" | "rename";
export type PawSliceJournalApplyMethod = "diff" | "fuzzy_diff" | "full_file";

export interface PawSliceJournalEntry {
	session_id: string;
	slice_id: string;
	path: string;
	change_type: PawSliceJournalChangeType;
	content_hash: string;
	apply_method?: PawSliceJournalApplyMethod;
	timestamp: string;
}

export interface PawAppliedChangeLookupInput {
	sliceId: string;
	path: string;
	contentHash: string;
}

interface FileSystemError extends Error {
	code?: string;
}

interface PawJournalValidationIssue {
	path: string;
	message: string;
}

const CHANGE_TYPES: readonly PawSliceJournalChangeType[] = ["create", "modify", "delete", "rename"];
const APPLY_METHODS: readonly PawSliceJournalApplyMethod[] = ["diff", "fuzzy_diff", "full_file"];
const ENTRY_KEYS = new Set([
	"session_id",
	"slice_id",
	"path",
	"change_type",
	"content_hash",
	"apply_method",
	"timestamp",
]);

export async function appendPawSliceJournalEntry(repoRoot: string, entry: PawSliceJournalEntry): Promise<void> {
	const validated = parsePawSliceJournalEntry(entry);
	const paths = resolvePawSessionPaths(repoRoot, validated.session_id);
	const serialized = JSON.stringify(validated);
	if (serialized === undefined) {
		throw new Error("Cannot write undefined as JSON.");
	}

	await mkdir(paths.sessionDir, { recursive: true });

	const handle = await open(paths.sliceJournalFile, "a", 0o600);
	try {
		await handle.writeFile(`${serialized}\n`, "utf-8");
		await handle.sync();
	} finally {
		await handle.close();
	}
	await syncDirectory(paths.sessionDir);
}

export async function readPawSliceJournal(repoRoot: string, sessionId: string): Promise<PawSliceJournalEntry[]> {
	const paths = resolvePawSessionPaths(repoRoot, sessionId);
	let content: string;
	try {
		content = await readFile(paths.sliceJournalFile, "utf-8");
	} catch (error) {
		if (isFileSystemError(error) && error.code === "ENOENT") {
			return [];
		}
		throw error;
	}

	const entries: PawSliceJournalEntry[] = [];
	const lines = content.split("\n");
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (line.trim() === "") {
			continue;
		}

		const lineNumber = index + 1;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch (error) {
			throw new Error(`Invalid Paw slice journal JSON on line ${lineNumber}: ${formatErrorMessage(error)}`);
		}

		const entry = parsePawSliceJournalEntry(parsed, lineNumber);
		if (entry.session_id !== sessionId) {
			throw new Error(`Invalid Paw slice journal entry on line ${lineNumber}: /session_id Expected ${sessionId}.`);
		}
		entries.push(entry);
	}

	return entries;
}

export function findPawAppliedChange(
	entries: readonly PawSliceJournalEntry[],
	input: PawAppliedChangeLookupInput,
): PawSliceJournalEntry | null {
	return (
		entries.find(
			(entry) =>
				entry.slice_id === input.sliceId && entry.path === input.path && entry.content_hash === input.contentHash,
		) ?? null
	);
}

export function hasPawAppliedChange(
	entries: readonly PawSliceJournalEntry[],
	input: PawAppliedChangeLookupInput,
): boolean {
	return findPawAppliedChange(entries, input) !== null;
}

function parsePawSliceJournalEntry(value: unknown, lineNumber?: number): PawSliceJournalEntry {
	const issues: PawJournalValidationIssue[] = [];
	const record = readRecord(value, "", issues);
	const entry: PawSliceJournalEntry = {
		session_id: readString(record, "session_id", issues),
		slice_id: readString(record, "slice_id", issues),
		path: readString(record, "path", issues),
		change_type: readStringUnion(record, "change_type", CHANGE_TYPES, issues),
		content_hash: readString(record, "content_hash", issues),
		timestamp: readString(record, "timestamp", issues),
	};

	const applyMethod = readOptionalStringUnion(record, "apply_method", APPLY_METHODS, issues);
	if (applyMethod !== undefined) {
		entry.apply_method = applyMethod;
	}

	if (issues.length > 0) {
		throw new Error(formatValidationIssues("Invalid Paw slice journal entry", issues, lineNumber));
	}

	assertValidEntrySessionId(entry.session_id, lineNumber);
	return entry;
}

function readRecord(value: unknown, path: string, issues: PawJournalValidationIssue[]): Record<string, unknown> {
	if (isRecord(value)) {
		for (const key of Object.keys(value)) {
			if (!ENTRY_KEYS.has(key)) {
				issues.push({ path: path || "/", message: `Unexpected property ${key}.` });
			}
		}
		return value;
	}

	issues.push({ path: path || "/", message: "Expected object." });
	return {};
}

function readString(record: Record<string, unknown>, key: string, issues: PawJournalValidationIssue[]): string {
	const value = record[key];
	if (typeof value === "string" && value.length > 0) {
		return value;
	}

	issues.push({ path: `/${key}`, message: "Expected non-empty string." });
	return "";
}

function readStringUnion<T extends string>(
	record: Record<string, unknown>,
	key: string,
	allowed: readonly T[],
	issues: PawJournalValidationIssue[],
): T {
	const value = record[key];
	if (typeof value === "string" && isAllowedString(value, allowed)) {
		return value;
	}

	issues.push({ path: `/${key}`, message: `Expected one of ${allowed.join(", ")}.` });
	return allowed[0];
}

function readOptionalStringUnion<T extends string>(
	record: Record<string, unknown>,
	key: string,
	allowed: readonly T[],
	issues: PawJournalValidationIssue[],
): T | undefined {
	const value = record[key];
	if (value === undefined) {
		return undefined;
	}
	if (typeof value === "string" && isAllowedString(value, allowed)) {
		return value;
	}

	issues.push({ path: `/${key}`, message: `Expected one of ${allowed.join(", ")}.` });
	return undefined;
}

function isAllowedString<T extends string>(value: string, allowed: readonly T[]): value is T {
	return allowed.includes(value as T);
}

function formatValidationIssues(
	prefix: string,
	issues: readonly PawJournalValidationIssue[],
	lineNumber?: number,
): string {
	const location = lineNumber === undefined ? "" : ` on line ${lineNumber}`;
	return `${prefix}${location}: ${issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`;
}

function assertValidEntrySessionId(sessionId: string, lineNumber?: number): void {
	try {
		resolvePawSessionPaths(".", sessionId);
	} catch (error) {
		throw new Error(
			formatValidationIssues(
				"Invalid Paw slice journal entry",
				[{ path: "/session_id", message: formatErrorMessage(error) }],
				lineNumber,
			),
		);
	}
}

function formatErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFileSystemError(error: unknown): error is FileSystemError {
	return error instanceof Error;
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
