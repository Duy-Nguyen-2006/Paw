import { join } from "node:path";
import type { PawValidationIssue, PawValidationResult } from "./contracts.ts";
import { readPawJson, resolvePawProjectPaths, writePawJsonAtomic } from "./persistence.ts";
import { resolvePawSessionPaths } from "./session-store.ts";

export interface PawCheckpointNameInput {
	timestamp: Date | string;
	sliceId: string | null;
	shortId: string;
}

export type PawCheckpointScope = "task_start" | "slice";

export interface PawCheckpointChangedFile {
	path: string;
	content_hash: string | null;
}

export interface PawCheckpointMetadata {
	session_id: string;
	checkpoint_name: string;
	scope: PawCheckpointScope;
	slice_id: string | null;
	created_at: string;
	base_tree: string;
	changed_files: PawCheckpointChangedFile[];
	notes?: string;
}

export interface PawCheckpointPaths {
	repoRoot: string;
	sessionId: string;
	checkpointName: string;
	checkpointDir: string;
	metadataFile: string;
}

const CHECKPOINT_NAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const CHECKPOINT_SCOPES: readonly PawCheckpointScope[] = ["task_start", "slice"];
const CHECKPOINT_METADATA_KEYS = new Set([
	"session_id",
	"checkpoint_name",
	"scope",
	"slice_id",
	"created_at",
	"base_tree",
	"changed_files",
	"notes",
]);
const CHECKPOINT_CHANGED_FILE_KEYS = new Set(["path", "content_hash"]);
const MAX_CHECKPOINT_SEGMENT_LENGTH = 48;

export function createPawCheckpointName(input: PawCheckpointNameInput): string {
	const timestamp = formatCheckpointTimestamp(input.timestamp);
	const sliceSegment = sanitizeCheckpointSegment(input.sliceId ?? "", "task", MAX_CHECKPOINT_SEGMENT_LENGTH);
	const shortId = sanitizeCheckpointShortId(input.shortId);

	return `${timestamp}-${sliceSegment}-${shortId}`;
}

export function resolvePawCheckpointPaths(
	repoRoot: string,
	sessionId: string,
	checkpointName: string,
): PawCheckpointPaths {
	assertValidCheckpointSessionId(sessionId);
	assertValidCheckpointName(checkpointName);

	const projectPaths = resolvePawProjectPaths(repoRoot);
	const checkpointDir = join(projectPaths.pawDir, "checkpoints", sessionId, checkpointName);

	return {
		repoRoot: projectPaths.repoRoot,
		sessionId,
		checkpointName,
		checkpointDir,
		metadataFile: join(checkpointDir, "checkpoint.json"),
	};
}

export function validatePawCheckpointMetadata(input: unknown): PawValidationResult<PawCheckpointMetadata> {
	const issues: PawValidationIssue[] = [];
	const record = readRecord(input, "", CHECKPOINT_METADATA_KEYS, issues);

	const metadata: PawCheckpointMetadata = {
		session_id: readNonEmptyString(record, "session_id", issues),
		checkpoint_name: readNonEmptyString(record, "checkpoint_name", issues),
		scope: readCheckpointScope(record, issues),
		slice_id: readNullableString(record, "slice_id", issues),
		created_at: readDateString(record, "created_at", issues),
		base_tree: readNonEmptyString(record, "base_tree", issues),
		changed_files: readChangedFiles(record, issues),
	};

	const notes = readOptionalString(record, "notes", issues);
	if (notes !== undefined) {
		metadata.notes = notes;
	}

	validateCheckpointSessionId(metadata.session_id, issues);
	validateCheckpointName(metadata.checkpoint_name, issues);
	validateScopeSliceId(metadata.scope, metadata.slice_id, issues);

	if (issues.length > 0) {
		return { ok: false, issues };
	}

	return { ok: true, value: metadata };
}

export async function writePawCheckpointMetadata(
	repoRoot: string,
	metadata: PawCheckpointMetadata,
): Promise<PawCheckpointPaths> {
	const validation = validatePawCheckpointMetadata(metadata);
	if (!validation.ok) {
		throw new Error(formatCheckpointValidationIssues("Invalid Paw checkpoint metadata", validation.issues));
	}

	const paths = resolvePawCheckpointPaths(repoRoot, validation.value.session_id, validation.value.checkpoint_name);
	await writePawJsonAtomic(paths.metadataFile, validation.value);

	return paths;
}

export async function readPawCheckpointMetadata(
	repoRoot: string,
	sessionId: string,
	checkpointName: string,
): Promise<PawCheckpointMetadata> {
	const paths = resolvePawCheckpointPaths(repoRoot, sessionId, checkpointName);
	const validation = validatePawCheckpointMetadata(await readPawJson<unknown>(paths.metadataFile));
	if (!validation.ok) {
		throw new Error(formatCheckpointValidationIssues("Invalid Paw checkpoint metadata", validation.issues));
	}
	return validation.value;
}

function formatCheckpointTimestamp(timestamp: Date | string): string {
	const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp;

	if (Number.isNaN(date.getTime())) {
		throw new Error("Paw checkpoint timestamp must be a valid date.");
	}

	const iso = date.toISOString();
	return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
}

function sanitizeCheckpointSegment(value: string, fallback: string, maxLength: number): string {
	const sanitized = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, maxLength)
		.replace(/^-+|-+$/g, "");

	return sanitized.length > 0 ? sanitized : fallback;
}

function sanitizeCheckpointShortId(value: string): string {
	const sanitized = value.toLowerCase().replace(/[^a-z0-9]+/g, "");
	if (sanitized.length === 0) {
		throw new Error("Paw checkpoint short id must contain at least one alphanumeric character.");
	}
	return sanitized;
}

function assertValidCheckpointSessionId(sessionId: string): void {
	resolvePawSessionPaths(".", sessionId);
}

function assertValidCheckpointName(checkpointName: string): void {
	if (!CHECKPOINT_NAME_PATTERN.test(checkpointName)) {
		throw new Error(
			"Paw checkpoint name must be non-empty, contain only alphanumeric characters and '-', and start and end with an alphanumeric character.",
		);
	}
}

function validateCheckpointSessionId(sessionId: string, issues: PawValidationIssue[]): void {
	try {
		assertValidCheckpointSessionId(sessionId);
	} catch (error) {
		issues.push({ path: "/session_id", message: formatErrorMessage(error) });
	}
}

function validateCheckpointName(checkpointName: string, issues: PawValidationIssue[]): void {
	try {
		assertValidCheckpointName(checkpointName);
	} catch (error) {
		issues.push({ path: "/checkpoint_name", message: formatErrorMessage(error) });
	}
}

function validateScopeSliceId(scope: PawCheckpointScope, sliceId: string | null, issues: PawValidationIssue[]): void {
	if (scope === "task_start" && sliceId !== null) {
		issues.push({ path: "/slice_id", message: "Expected null for task_start checkpoint scope." });
	}
	if (scope === "slice" && (sliceId === null || sliceId.length === 0)) {
		issues.push({ path: "/slice_id", message: "Expected non-empty string for slice checkpoint scope." });
	}
}

function readRecord(
	value: unknown,
	path: string,
	allowedKeys: ReadonlySet<string>,
	issues: PawValidationIssue[],
): Record<string, unknown> {
	if (isRecord(value)) {
		for (const key of Object.keys(value)) {
			if (!allowedKeys.has(key)) {
				issues.push({ path: path || "/", message: `Unexpected property ${key}.` });
			}
		}
		return value;
	}

	issues.push({ path: path || "/", message: "Expected object." });
	return {};
}

function readNonEmptyString(
	record: Record<string, unknown>,
	key: string,
	issues: PawValidationIssue[],
	prefix = "",
): string {
	const value = record[key];
	if (typeof value === "string" && value.length > 0) {
		return value;
	}

	issues.push({ path: `${prefix}/${key}`, message: "Expected non-empty string." });
	return "";
}

function readNullableString(record: Record<string, unknown>, key: string, issues: PawValidationIssue[]): string | null {
	const value = record[key];
	if (value === null) {
		return null;
	}
	if (typeof value === "string") {
		return value;
	}

	issues.push({ path: `/${key}`, message: "Expected string or null." });
	return null;
}

function readOptionalString(
	record: Record<string, unknown>,
	key: string,
	issues: PawValidationIssue[],
): string | undefined {
	const value = record[key];
	if (value === undefined) {
		return undefined;
	}
	if (typeof value === "string") {
		return value;
	}

	issues.push({ path: `/${key}`, message: "Expected string." });
	return undefined;
}

function readCheckpointScope(record: Record<string, unknown>, issues: PawValidationIssue[]): PawCheckpointScope {
	const value = record.scope;
	if (typeof value === "string" && isCheckpointScope(value)) {
		return value;
	}

	issues.push({ path: "/scope", message: `Expected one of ${CHECKPOINT_SCOPES.join(", ")}.` });
	return "task_start";
}

function readDateString(record: Record<string, unknown>, key: string, issues: PawValidationIssue[]): string {
	const value = record[key];
	if (typeof value === "string" && value.length > 0 && !Number.isNaN(new Date(value).getTime())) {
		return value;
	}

	issues.push({ path: `/${key}`, message: "Expected valid date string." });
	return "";
}

function readChangedFiles(record: Record<string, unknown>, issues: PawValidationIssue[]): PawCheckpointChangedFile[] {
	const value = record.changed_files;
	if (!Array.isArray(value)) {
		issues.push({ path: "/changed_files", message: "Expected array." });
		return [];
	}

	return value.map((entry, index) => readChangedFile(entry, index, issues));
}

function readChangedFile(value: unknown, index: number, issues: PawValidationIssue[]): PawCheckpointChangedFile {
	const prefix = `/changed_files/${index}`;
	const record = readRecord(value, prefix, CHECKPOINT_CHANGED_FILE_KEYS, issues);

	return {
		path: readNonEmptyString(record, "path", issues, prefix),
		content_hash: readContentHash(record, index, issues),
	};
}

function readContentHash(record: Record<string, unknown>, index: number, issues: PawValidationIssue[]): string | null {
	const value = record.content_hash;
	if (value === null) {
		return null;
	}
	if (typeof value === "string") {
		return value;
	}

	issues.push({ path: `/changed_files/${index}/content_hash`, message: "Expected string or null." });
	return null;
}

function isCheckpointScope(value: string): value is PawCheckpointScope {
	return CHECKPOINT_SCOPES.includes(value as PawCheckpointScope);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatCheckpointValidationIssues(prefix: string, issues: readonly PawValidationIssue[]): string {
	return `${prefix}: ${issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`;
}

function formatErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}
