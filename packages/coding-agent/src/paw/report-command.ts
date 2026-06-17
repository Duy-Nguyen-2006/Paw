import { readFile, stat } from "node:fs/promises";
import { relative } from "node:path";
import { APP_NAME } from "../config.ts";
import { resolvePawProjectPaths } from "./persistence.ts";
import { resolvePawSessionPaths } from "./session-store.ts";

export type PawReportCommandResult =
	| PawReportCommandFoundResult
	| PawReportCommandMissingProjectResult
	| PawReportCommandMissingReportResult;

export interface PawReportCommandFoundResult {
	status: "found";
	sessionId: string;
	markdown: string;
}

export interface PawReportCommandMissingProjectResult {
	status: "missing_project";
	pawDir: string;
}

export interface PawReportCommandMissingReportResult {
	status: "missing_report";
	sessionId: string;
	summaryFile: string;
}

interface FileSystemError extends Error {
	code?: string;
}

export async function createPawReportCommandResult(
	repoRoot: string,
	sessionId: string,
): Promise<PawReportCommandResult> {
	const projectPaths = resolvePawProjectPaths(repoRoot);
	const pawDir = relative(projectPaths.repoRoot, projectPaths.pawDir) || ".paw";
	if (!(await isDirectory(projectPaths.pawDir))) {
		return {
			status: "missing_project",
			pawDir,
		};
	}

	const sessionPaths = resolvePawSessionPaths(repoRoot, sessionId);
	try {
		return {
			status: "found",
			sessionId,
			markdown: await readFile(sessionPaths.summaryFile, "utf-8"),
		};
	} catch (error) {
		if (isFileSystemError(error) && error.code === "ENOENT") {
			return {
				status: "missing_report",
				sessionId,
				summaryFile: relative(projectPaths.repoRoot, sessionPaths.summaryFile),
			};
		}
		throw error;
	}
}

export function formatPawReportCommandResult(result: PawReportCommandResult): string {
	switch (result.status) {
		case "found":
			return result.markdown;
		case "missing_project":
			return `Paw is not initialized at ${result.pawDir}. Run \`${APP_NAME} paw init\`.`;
		case "missing_report":
			return `No final report found for session ${result.sessionId} at ${result.summaryFile}.`;
	}
}

export async function runPawReportCommand(args: string[]): Promise<void> {
	if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
		printPawReportHelp();
		return;
	}

	if (args.length === 0) {
		printPawReportCommandError('Missing required session id for "paw report".');
		return;
	}

	if (args.length > 1) {
		printPawReportCommandError(`Unknown option for "paw report": ${args[1]}`);
		return;
	}

	try {
		console.log(formatPawReportCommandResult(await createPawReportCommandResult(process.cwd(), args[0])));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		printPawReportCommandError(message);
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

function printPawReportHelp(): void {
	console.log(`Usage:
  ${APP_NAME} paw report <session-id>

Print the persisted final report for a Paw session.

Commands:
  ${APP_NAME} paw report <session-id> Show final report markdown
  ${APP_NAME} paw report --help       Show this help
`);
}

function printPawReportCommandError(message: string): void {
	console.error(`Error: ${message}`);
	process.exitCode = 1;
}

function isFileSystemError(error: unknown): error is FileSystemError {
	return error instanceof Error;
}
