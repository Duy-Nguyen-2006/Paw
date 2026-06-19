import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { PawValidationIssue } from "./contracts.ts";
import { readPawSliceJournal } from "./slice-journal.ts";

export type PawReviewerDiffScope = "working" | "staged" | "all" | "journal";

export interface PawReviewerDiffInput {
	repoRoot: string;
	sessionId: string | null;
	scope: PawReviewerDiffScope;
	commandRunner?: PawReviewerDiffCommandRunner;
}

export type PawReviewerDiffCommandRunner = (input: { command: string; args: string[]; cwd: string }) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

export interface PawReviewerDiffEntry {
	path: string;
	change_type: "create" | "modify" | "delete" | "rename" | "unknown";
	content_hash: string | null;
}

export interface PawReviewerDiffResult {
	scope: PawReviewerDiffScope;
	entries: PawReviewerDiffEntry[];
	rawDiff: string | null;
	rationales: readonly string[];
}

export async function readPawReviewerDiff(input: PawReviewerDiffInput): Promise<PawReviewerDiffResult> {
	const rationales: string[] = [];
	if (input.scope === "journal") {
		return await readJournalDiff(input, rationales);
	}
	const runner = input.commandRunner ?? runLocalReviewerDiffCommand;
	const cwd = resolve(input.repoRoot);
	let command = "git";
	let args: string[];
	switch (input.scope) {
		case "staged":
			args = ["diff", "--cached", "--name-status", "--diff-filter=ACMRD"];
			rationales.push("reviewer diff scope: staged changes only");
			break;
		case "all":
			args = ["diff", "HEAD", "--name-status", "--diff-filter=ACMRD"];
			rationales.push("reviewer diff scope: full diff against HEAD");
			break;
		case "working":
		default:
			args = ["diff", "--name-status", "--diff-filter=ACMRD"];
			rationales.push("reviewer diff scope: working tree");
			break;
	}
	const result = await runner({ command, args, cwd });
	const entries: PawReviewerDiffEntry[] = [];
	if (result.exitCode !== 0) {
		rationales.push(`git diff returned exit ${result.exitCode}: ${result.stderr.trim() || "no stderr"}`);
		return { scope: input.scope, entries, rawDiff: result.stdout, rationales };
	}
	for (const line of result.stdout.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;
		const [status, ...pathParts] = trimmed.split("\t");
		if (status === undefined || pathParts.length === 0) continue;
		const path = pathParts.join("\t");
		entries.push({ path, change_type: mapDiffStatus(status), content_hash: null });
	}
	// Hash each file for content comparison
	for (const entry of entries) {
		try {
			const content = await readFile(resolve(cwd, entry.path), "utf-8");
			entry.content_hash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
		} catch {
			entry.content_hash = null;
		}
	}
	const rawDiff = await runner({ command, args: [...args.slice(0, -1), "--no-color"], cwd });
	return { scope: input.scope, entries, rawDiff: rawDiff.exitCode === 0 ? rawDiff.stdout : null, rationales };
}

async function readJournalDiff(input: PawReviewerDiffInput, rationales: string[]): Promise<PawReviewerDiffResult> {
	if (input.sessionId === null) {
		rationales.push("journal scope requires sessionId; returning empty diff");
		return { scope: input.scope, entries: [], rawDiff: null, rationales };
	}
	const journal = await readPawSliceJournal(input.repoRoot, input.sessionId);
	const entries: PawReviewerDiffEntry[] = journal.map((entry) => ({
		path: entry.path,
		change_type: entry.change_type,
		content_hash: entry.content_hash,
	}));
	rationales.push(`reviewer diff scope: slice journal for session ${input.sessionId} (${entries.length} entries)`);
	return { scope: input.scope, entries, rawDiff: null, rationales };
}

function mapDiffStatus(status: string): PawReviewerDiffEntry["change_type"] {
	if (status.startsWith("A")) return "create";
	if (status.startsWith("M")) return "modify";
	if (status.startsWith("D")) return "delete";
	if (status.startsWith("R")) return "rename";
	return "unknown";
}

export interface PawReviewerStructuredFinding {
	severity: "info" | "warn" | "block";
	rule: string;
	detail: string;
	path: string | null;
}

export interface PawReviewerStructuredReview {
	ok: boolean;
	findings: PawReviewerStructuredFinding[];
	issues: PawValidationIssue[];
}

const SECRET_LIKE = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{12,}\b|\bghp_[A-Za-z0-9_-]{16,}\b|(?:api[_-]?key|apikey|secret[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9._-]{12,}/i;

export function reviewPawDiffForRules(diff: PawReviewerDiffResult): PawReviewerStructuredReview {
	const findings: PawReviewerStructuredFinding[] = [];
	const issues: PawValidationIssue[] = [];
	if (diff.entries.length === 0) {
		findings.push({ severity: "info", rule: "no_diff", detail: "Reviewer observed no diff entries", path: null });
	}
	for (const entry of diff.entries) {
		if (entry.path.includes("node_modules/")) {
			findings.push({ severity: "block", rule: "scope_creep", detail: "Diff touches node_modules", path: entry.path });
			issues.push({ path: `/entries/${entry.path}`, message: "node_modules edit blocked" });
		}
		if (entry.path.endsWith(".env") || entry.path.includes("/.env")) {
			findings.push({ severity: "block", rule: "secret_path", detail: "Diff touches .env", path: entry.path });
			issues.push({ path: `/entries/${entry.path}`, message: "Secret path blocked" });
		}
		if (diff.rawDiff !== null && SECRET_LIKE.test(diff.rawDiff) && entry.path !== null) {
			findings.push({ severity: "block", rule: "secret_leak", detail: "Diff appears to contain a secret", path: entry.path });
		}
		if (entry.path.includes("dist/") || entry.path.includes("build/")) {
			findings.push({ severity: "warn", rule: "generated_path", detail: "Diff touches generated build output", path: entry.path });
		}
	}
	const ok = !findings.some((finding) => finding.severity === "block");
	return { ok, findings, issues };
}

function runLocalReviewerDiffCommand(input: { command: string; args: string[]; cwd: string }): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(input.command, input.args, { cwd: input.cwd, shell: process.platform === "win32" });
		let stdout = "";
		let stderr = "";
		child.stdout?.setEncoding("utf-8");
		child.stderr?.setEncoding("utf-8");
		child.stdout?.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr?.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", reject);
		child.on("close", (code) => resolvePromise({ exitCode: code ?? 1, stdout, stderr }));
	});
}
