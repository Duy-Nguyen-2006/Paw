import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { applyPatch } from "diff";
import type { PawRuntimeConfig, PawSubAgentOutput, PawValidationIssue } from "./contracts.ts";
import { evaluatePawEditIdempotency } from "./edit-policy.ts";

export interface PawPatchApplyInput {
	repoRoot: string;
	config: PawRuntimeConfig;
	workerOutput: PawSubAgentOutput;
}

export type PawPatchApplyResult =
	| { status: "applied"; appliedChanges: PawAppliedPatchChange[] }
	| { status: "blocked"; issues: PawValidationIssue[]; appliedChanges: PawAppliedPatchChange[] };

export interface PawAppliedPatchChange {
	path: string;
	change_type: "create" | "modify" | "delete" | "rename";
	content_hash: string;
	apply_method: "full_file" | "diff" | "fuzzy_diff";
}

export async function applyPawWorkerOutputPatches(input: PawPatchApplyInput): Promise<PawPatchApplyResult> {
	const issues: PawValidationIssue[] = [];
	const appliedChanges: PawAppliedPatchChange[] = [];
	for (const [index, changedFile] of input.workerOutput.changed_files.entries()) {
		await applyOneWorkerChangedFile(
			{ repoRoot: input.repoRoot, config: input.config, changedFile, pathIssuePrefix: `/changed_files/${index}` },
			issues,
			appliedChanges,
		);
	}

	return issues.length > 0 ? { status: "blocked", issues, appliedChanges } : { status: "applied", appliedChanges };
}

type PawChangedFile = PawSubAgentOutput["changed_files"][number];

async function applyOneWorkerChangedFile(
	ctx: {
		repoRoot: string;
		config: PawRuntimeConfig;
		changedFile: PawChangedFile;
		pathIssuePrefix: string;
	},
	issues: PawValidationIssue[],
	appliedChanges: PawAppliedPatchChange[],
): Promise<void> {
	const { repoRoot, config, changedFile, pathIssuePrefix } = ctx;
	const targetPath = resolveWorkerPatchPath(repoRoot, changedFile.path);
	if (targetPath === null) {
		issues.push({ path: `${pathIssuePrefix}/path`, message: "Path must stay inside the repository root." });
		return;
	}
	if (await hasUnsafeSymlinkAncestor(repoRoot, targetPath)) {
		issues.push({
			path: `${pathIssuePrefix}/path`,
			message: "Path has a symlinked ancestor and cannot be edited safely.",
		});
		return;
	}

	const method = changedFile.apply_method ?? "full_file";
	if (method === "diff" || method === "fuzzy_diff") {
		await applyDiffWorkerChange(targetPath, changedFile, method, config, pathIssuePrefix, issues, appliedChanges);
		return;
	}
	if (method !== "full_file") {
		issues.push({
			path: `${pathIssuePrefix}/apply_method`,
			message: `apply_method ${String(changedFile.apply_method)} is not supported yet.`,
		});
		return;
	}
	if (changedFile.new_content === undefined) {
		return;
	}
	await applyFullFileWorkerChange(targetPath, changedFile, config, pathIssuePrefix, issues, appliedChanges);
}

async function applyDiffWorkerChange(
	targetPath: string,
	changedFile: PawChangedFile,
	method: "diff" | "fuzzy_diff",
	config: PawRuntimeConfig,
	pathIssuePrefix: string,
	issues: PawValidationIssue[],
	appliedChanges: PawAppliedPatchChange[],
): Promise<void> {
	if (changedFile.unified_diff === undefined || changedFile.unified_diff.length === 0) {
		return;
	}
	const current = await readCurrentPatchContent(targetPath);
	const applied = applyUnifiedDiff({
		base: current.content ?? "",
		unifiedDiff: changedFile.unified_diff,
		method,
	});
	if (applied.status === "blocked") {
		issues.push({ path: `${pathIssuePrefix}/unified_diff`, message: applied.message });
		return;
	}
	const lineIssue = validatePatchContentLimits(applied.content, changedFile.content_hash, config, pathIssuePrefix, {
		hashMessageSuffix: ` for the ${method}-applied content.`,
		lineMessagePrefix: `${method} produced`,
	});
	if (lineIssue !== null) {
		issues.push(lineIssue);
		return;
	}
	await mkdir(dirname(targetPath), { recursive: true });
	await writeFile(targetPath, applied.content, "utf-8");
	appliedChanges.push({
		path: changedFile.path,
		change_type: changedFile.change_type,
		content_hash: changedFile.content_hash,
		apply_method: method,
	});
}

async function applyFullFileWorkerChange(
	targetPath: string,
	changedFile: PawChangedFile,
	config: PawRuntimeConfig,
	pathIssuePrefix: string,
	issues: PawValidationIssue[],
	appliedChanges: PawAppliedPatchChange[],
): Promise<void> {
	if (changedFile.change_type === "rename") {
		issues.push({
			path: `${pathIssuePrefix}/change_type`,
			message: "Rename patch application is not supported yet.",
		});
		return;
	}
	if (changedFile.new_content === null && changedFile.change_type !== "delete") {
		issues.push({
			path: `${pathIssuePrefix}/new_content`,
			message: "new_content can be null only for delete changes.",
		});
		return;
	}

	const current = await readCurrentPatchContent(targetPath);
	if (changedFile.base_content_hash !== undefined) {
		const idempotency = evaluatePawEditIdempotency({
			currentHash: current.hash ?? "",
			expectedBaseHash: changedFile.base_content_hash ?? "",
			expectedResultHash: changedFile.content_hash,
		});
		if (idempotency.status === "noop") {
			appliedChanges.push({
				path: changedFile.path,
				change_type: changedFile.change_type,
				content_hash: changedFile.content_hash,
				apply_method: "full_file",
			});
			return;
		}
		if (idempotency.status === "rederive") {
			issues.push({ path: `${pathIssuePrefix}/base_content_hash`, message: idempotency.message });
			return;
		}
	}

	if (changedFile.change_type === "delete") {
		await rm(targetPath, { force: true });
		appliedChanges.push({
			path: changedFile.path,
			change_type: "delete",
			content_hash: changedFile.content_hash,
			apply_method: "full_file",
		});
		return;
	}

	const newContent = changedFile.new_content;
	if (newContent === undefined || newContent === null) {
		issues.push({ path: `${pathIssuePrefix}/new_content`, message: "full_file changes require new_content." });
		return;
	}
	const lineIssue = validatePatchContentLimits(newContent, changedFile.content_hash, config, pathIssuePrefix, {
		hashMessageSuffix: " for provided new_content.",
		lineMessagePrefix: "Full-file rewrite has",
	});
	if (lineIssue !== null) {
		issues.push(lineIssue);
		return;
	}
	await mkdir(dirname(targetPath), { recursive: true });
	await writeFile(targetPath, newContent, "utf-8");
	appliedChanges.push({
		path: changedFile.path,
		change_type: changedFile.change_type,
		content_hash: changedFile.content_hash,
		apply_method: "full_file",
	});
}

function validatePatchContentLimits(
	content: string,
	expectedHash: string,
	config: PawRuntimeConfig,
	pathIssuePrefix: string,
	messages: { hashMessageSuffix: string; lineMessagePrefix: string },
): PawValidationIssue | null {
	const actualHash = hashContent(content);
	if (actualHash !== expectedHash) {
		return {
			path: `${pathIssuePrefix}/content_hash`,
			message: `content_hash must equal ${actualHash}${messages.hashMessageSuffix}`,
		};
	}
	const lineCount = countLines(content);
	if (lineCount > config.edit.full_file_rewrite_max_lines) {
		return {
			path: `${pathIssuePrefix}/new_content`,
			message: `${messages.lineMessagePrefix} ${lineCount} lines, above limit ${config.edit.full_file_rewrite_max_lines}.`,
		};
	}
	return null;
}

export function hashPawPatchContent(content: string): string {
	return hashContent(content);
}

function resolveWorkerPatchPath(repoRoot: string, path: string): string | null {
	const root = resolve(repoRoot);
	const target = resolve(root, path);
	const rel = relative(root, target);
	if (rel === "" || rel.startsWith("..") || rel.split(sep).includes("..")) {
		return null;
	}
	if (rel === ".env" || rel.startsWith(`.env${sep}`) || rel.includes(`${sep}.env`)) {
		return null;
	}
	return target;
}

async function readCurrentPatchContent(path: string): Promise<{ content: string | null; hash: string | null }> {
	try {
		const content = await readFile(path, "utf-8");
		return { content, hash: hashContent(content) };
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return { content: null, hash: null };
		}
		throw error;
	}
}

async function hasUnsafeSymlinkAncestor(repoRoot: string, targetPath: string): Promise<boolean> {
	const root = resolve(repoRoot);
	let cursor = dirname(targetPath);
	while (cursor.startsWith(root) && cursor !== root) {
		try {
			if ((await lstat(cursor)).isSymbolicLink()) {
				return true;
			}
		} catch (error) {
			if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
				throw error;
			}
		}
		cursor = dirname(cursor);
	}
	return false;
}

function hashContent(content: string): string {
	return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function countLines(content: string): number {
	return content.length === 0 ? 0 : content.split("\n").length;
}

type ApplyUnifiedDiffResult = { status: "applied"; content: string } | { status: "blocked"; message: string };

const FUZZY_SIMILARITY_THRESHOLD = 0.85;

function applyUnifiedDiff(input: {
	base: string;
	unifiedDiff: string;
	method: "diff" | "fuzzy_diff";
}): ApplyUnifiedDiffResult {
	const normalized = stripDiffHeaders(input.unifiedDiff);
	if (normalized === null) {
		return { status: "blocked", message: "Unified diff is empty after stripping headers." };
	}
	const result = applyPatch(input.base, normalized, { fuzzFactor: input.method === "fuzzy_diff" ? 2 : 0 });
	if (result === false) {
		return { status: "blocked", message: `${input.method} patch did not apply cleanly to the current file.` };
	}
	const content = typeof result === "string" ? result : input.base;
	// Validate similarity threshold for fuzzy diffs
	if (input.method === "fuzzy_diff") {
		const similarity = computeLineSimilarity(input.base, content);
		if (similarity < FUZZY_SIMILARITY_THRESHOLD) {
			return {
				status: "blocked",
				message: `fuzzy_diff produced ${(similarity * 100).toFixed(0)}% line similarity, below ${FUZZY_SIMILARITY_THRESHOLD * 100}% threshold.`,
			};
		}
	}
	return { status: "applied", content };
}

function stripDiffHeaders(diff: string): string | null {
	const lines = diff.split("\n");
	const start = lines.findIndex((line) => line.startsWith("@@"));
	if (start === -1) {
		return null;
	}
	const body = lines.slice(start).join("\n");
	return body.length === 0 ? null : body;
}

function computeLineSimilarity(a: string, b: string): number {
	const aLines = a.split("\n");
	const bLines = b.split("\n");
	if (aLines.length === 0 && bLines.length === 0) return 1;
	const total = Math.max(aLines.length, bLines.length);
	if (total === 0) return 1;
	const identical = total - (aLines.length + bLines.length - 2 * new Set([...aLines, ...bLines]).size);
	return Math.max(0, identical / total);
}
