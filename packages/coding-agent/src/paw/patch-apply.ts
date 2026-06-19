import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
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
		const pathIssuePrefix = `/changed_files/${index}`;
		const targetPath = resolveWorkerPatchPath(input.repoRoot, changedFile.path);
		if (targetPath === null) {
			issues.push({ path: `${pathIssuePrefix}/path`, message: "Path must stay inside the repository root." });
			continue;
		}
		if (await hasUnsafeSymlinkAncestor(input.repoRoot, targetPath)) {
			issues.push({
				path: `${pathIssuePrefix}/path`,
				message: "Path has a symlinked ancestor and cannot be edited safely.",
			});
			continue;
		}

		if (changedFile.apply_method !== "full_file" || changedFile.new_content === undefined) {
			continue;
		}

		if (changedFile.change_type === "rename") {
			issues.push({
				path: `${pathIssuePrefix}/change_type`,
				message: "Rename patch application is not supported yet.",
			});
			continue;
		}
		if (changedFile.new_content === null && changedFile.change_type !== "delete") {
			issues.push({
				path: `${pathIssuePrefix}/new_content`,
				message: "new_content can be null only for delete changes.",
			});
			continue;
		}

		const current = await readCurrentPatchContent(targetPath);
		const expectedResultHash = changedFile.content_hash;
		if (changedFile.base_content_hash !== undefined) {
			const idempotency = evaluatePawEditIdempotency({
				currentHash: current.hash ?? "",
				expectedBaseHash: changedFile.base_content_hash ?? "",
				expectedResultHash,
			});
			if (idempotency.status === "noop") {
				appliedChanges.push({
					path: changedFile.path,
					change_type: changedFile.change_type,
					content_hash: changedFile.content_hash,
					apply_method: "full_file",
				});
				continue;
			}
			if (idempotency.status === "rederive") {
				issues.push({ path: `${pathIssuePrefix}/base_content_hash`, message: idempotency.message });
				continue;
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
			continue;
		}

		const newContent = changedFile.new_content;
		if (newContent === undefined || newContent === null) {
			issues.push({ path: `${pathIssuePrefix}/new_content`, message: "full_file changes require new_content." });
			continue;
		}
		const lineCount = countLines(newContent);
		if (lineCount > input.config.edit.full_file_rewrite_max_lines) {
			issues.push({
				path: `${pathIssuePrefix}/new_content`,
				message: `Full-file rewrite has ${lineCount} lines, above limit ${input.config.edit.full_file_rewrite_max_lines}.`,
			});
			continue;
		}
		const actualHash = hashContent(newContent);
		if (actualHash !== changedFile.content_hash) {
			issues.push({
				path: `${pathIssuePrefix}/content_hash`,
				message: `content_hash must equal ${actualHash} for provided new_content.`,
			});
			continue;
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

	return issues.length > 0 ? { status: "blocked", issues, appliedChanges } : { status: "applied", appliedChanges };
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
