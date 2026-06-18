import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { APP_NAME } from "../config.ts";
import { loadDefaultPawRuntimeConfig } from "./config.ts";
import { resolvePawProjectPaths } from "./persistence.ts";
import {
	createPawRetentionPlan,
	type PawRetentionArtifactRecord,
	type PawRetentionConfig,
	type PawRetentionPlan,
	type PawRetentionSessionRecord,
} from "./retention-policy.ts";
import { formatIssuesForError } from "./validation.ts";

export type PawCleanDryRunReport = {
	initialized: boolean;
	pawDir: string;
	retention: PawRetentionConfig;
	sessionCandidateCount: number;
	artifactCandidateCount: number;
	plan: PawRetentionPlan;
};

interface FileSystemError extends Error {
	code?: string;
}

export async function createPawCleanDryRunReport(
	repoRoot = process.cwd(),
	now: Date = new Date(),
): Promise<PawCleanDryRunReport> {
	const paths = resolvePawProjectPaths(repoRoot);
	const pawDir = relative(paths.repoRoot, paths.pawDir) || ".paw";
	const retention = loadDefaultPawRuntimeConfig(paths.repoRoot).persistence.retention;
	const initialized = await isDirectory(paths.pawDir);
	const sessions = initialized ? await scanSessionRecords(paths.repoRoot) : [];
	const artifacts = initialized ? await scanArtifactRecords(paths.repoRoot) : [];
	const result = createPawRetentionPlan({
		config: retention,
		sessions,
		artifacts,
		now,
	});

	if (!result.ok) {
		throw formatIssuesForError("Invalid Paw retention plan", result.issues);
	}

	return {
		initialized,
		pawDir,
		retention,
		sessionCandidateCount: sessions.length,
		artifactCandidateCount: artifacts.length,
		plan: result.value,
	};
}

export function formatPawCleanDryRunReport(report: PawCleanDryRunReport): string {
	const lines = [
		"Paw clean dry-run",
		`.paw path: ${report.pawDir}`,
		`retention: keep_last_sessions=${report.retention.keep_last_sessions}, artifact_days=${report.retention.artifact_days}`,
		`candidates: ${report.sessionCandidateCount} sessions, ${report.artifactCandidateCount} artifacts`,
	];

	if (!report.initialized) {
		lines.push(".paw is missing; no sessions or artifacts were scanned.");
	}

	lines.push(
		`sessions: keep ${report.plan.keep_sessions.length}, remove ${report.plan.remove_sessions.length}`,
		...formatKeptSessions(report.plan.keep_sessions),
		...formatRemovals(report.plan.remove_sessions),
		`artifacts: keep ${report.plan.keep_artifacts.length}, remove ${report.plan.remove_artifacts.length}`,
		...formatKeptArtifacts(report.plan.keep_artifacts),
		...formatRemovals(report.plan.remove_artifacts),
		"No files were deleted.",
	);

	return lines.join("\n");
}

export async function runPawCleanCommand(args: string[]): Promise<void> {
	if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
		printPawCleanHelp();
		return;
	}

	if (args.length === 1 && args[0] === "--dry-run") {
		console.log(formatPawCleanDryRunReport(await createPawCleanDryRunReport(process.cwd())));
		return;
	}

	if (args.length === 0) {
		printPawCleanCommandError('Only "paw clean --dry-run" is implemented; no files were deleted.');
		return;
	}

	printPawCleanCommandError(`Unknown option for "paw clean": ${args[0]}`);
}

async function scanSessionRecords(repoRoot: string): Promise<PawRetentionSessionRecord[]> {
	const sessionsDir = join(resolvePawProjectPaths(repoRoot).pawDir, "sessions");
	const entries = await readRetentionDirectoryEntries(sessionsDir, repoRoot);
	return entries.map((entry) => ({
		session_id: entry.name,
		path: entry.relativePath,
		last_activity_at: entry.mtime.toISOString(),
	}));
}

async function scanArtifactRecords(repoRoot: string): Promise<PawRetentionArtifactRecord[]> {
	const artifactsDir = join(resolvePawProjectPaths(repoRoot).pawDir, "artifacts");
	const entries = await readRetentionDirectoryEntries(artifactsDir, repoRoot);
	return entries.map((entry) => ({
		artifact_name: entry.name,
		path: entry.relativePath,
		created_at: entry.mtime.toISOString(),
	}));
}

async function readRetentionDirectoryEntries(
	parentDir: string,
	repoRoot: string,
): Promise<Array<{ name: string; relativePath: string; mtime: Date }>> {
	let dirEntries: Dirent<string>[];
	try {
		dirEntries = await readdir(parentDir, { withFileTypes: true });
	} catch (error) {
		if (isFileSystemError(error) && error.code === "ENOENT") {
			return [];
		}
		throw error;
	}

	const records: Array<{ name: string; relativePath: string; mtime: Date }> = [];
	for (const entry of dirEntries) {
		if (!entry.isDirectory()) {
			continue;
		}

		const absolutePath = join(parentDir, entry.name);
		const metadata = await stat(absolutePath);
		records.push({
			name: entry.name,
			relativePath: relative(repoRoot, absolutePath),
			mtime: metadata.mtime,
		});
	}
	return records;
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

function formatKeptSessions(sessions: readonly PawRetentionSessionRecord[]): string[] {
	return sessions.map((session) => `  keep ${session.session_id} (${session.path})`);
}

function formatKeptArtifacts(artifacts: readonly PawRetentionArtifactRecord[]): string[] {
	return artifacts.map((artifact) => `  keep ${artifact.artifact_name} (${artifact.path})`);
}

function formatRemovals(removals: readonly { id: string; path: string; reason: string }[]): string[] {
	return removals.map((removal) => `  remove ${removal.id} (${removal.path}): ${removal.reason}`);
}

function printPawCleanHelp(): void {
	console.log(`Usage:
  ${APP_NAME} paw clean --dry-run

Print a read-only Paw retention plan. No files are deleted.

Commands:
  ${APP_NAME} paw clean --dry-run Show read-only Paw retention plan
  ${APP_NAME} paw clean --help    Show this help
`);
}

function printPawCleanCommandError(message: string): void {
	console.error(`Error: ${message}`);
	process.exitCode = 1;
}

function isFileSystemError(error: unknown): error is FileSystemError {
	return error instanceof Error;
}
