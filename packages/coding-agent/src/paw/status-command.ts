
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { APP_NAME } from "../config.ts";
import { parsePawRuntimeConfigYaml } from "./config.ts";
import { resolvePawProjectPaths } from "./persistence.ts";
import { readPawSessionState } from "./session-store.ts";
import { PAW_SESSION_STATE_NAMES, type PawSessionStateName } from "./state.ts";

export type PawStatusConfigSummary =
	| { status: "ok" }
	| { status: "missing" }
	| { status: "error"; errorSummary: string };

export type PawStatusVersionSummary =
	| { status: "present"; value: string }
	| { status: "missing" }
	| { status: "error"; errorSummary: string };

export type PawStatusReport = {
	initialized: boolean;
	pawDir: string;
	config: PawStatusConfigSummary;
	version: PawStatusVersionSummary;
	sessionDirectoryCount: number;
	stateCounts: Partial<Record<PawSessionStateName, number>>;
	invalidSessionCount: number;
};

interface FileSystemError extends Error {
	code?: string;
}

export async function createPawStatusReport(repoRoot = process.cwd()): Promise<PawStatusReport> {
	const paths = resolvePawProjectPaths(repoRoot);
	const pawDir = relative(paths.repoRoot, paths.pawDir) || ".paw";

	if (!(await isDirectory(paths.pawDir))) {
		return {
			initialized: false,
			pawDir,
			config: { status: "missing" },
			version: { status: "missing" },
			sessionDirectoryCount: 0,
			stateCounts: {},
			invalidSessionCount: 0,
		};
	}

	const sessionSummary = await summarizePawSessions(paths.repoRoot);
	return {
		initialized: true,
		pawDir,
		config: await summarizePawConfig(paths.configFile),
		version: await summarizePawVersion(paths.versionFile),
		sessionDirectoryCount: sessionSummary.sessionDirectoryCount,
		stateCounts: sessionSummary.stateCounts,
		invalidSessionCount: sessionSummary.invalidSessionCount,
	};
}

export function formatPawStatusReport(report: PawStatusReport): string {
	const lines = ["Paw status", `.paw path: ${report.pawDir}`];

	if (!report.initialized) {
		lines.push("initialized: no", `Paw is not initialized. Run \`${APP_NAME} paw init\`.`);
		return lines.join("\n");
	}

	lines.push(
		"initialized: yes",
		`config: ${formatConfigSummary(report.config)}`,
		`version: ${formatVersionSummary(report.version)}`,
		`sessions: ${report.sessionDirectoryCount}`,
	);

	const stateLines = formatStateCountLines(report.stateCounts);
	if (stateLines.length === 0) {
		lines.push("state counts: none");
	} else {
		lines.push(...stateLines);
	}

	if (report.invalidSessionCount > 0) {
		lines.push(`invalid sessions: ${report.invalidSessionCount}`);
	}

	return lines.join("\n");
}

export async function runPawStatusCommand(args: string[]): Promise<void> {
	if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
		printPawStatusHelp();
		return;
	}

	if (args.length > 0) {
		printPawStatusCommandError(`Unknown option for "paw status": ${args[0]}`);
		return;
	}

	console.log(formatPawStatusReport(await createPawStatusReport(process.cwd())));
}

async function summarizePawConfig(configFile: string): Promise<PawStatusConfigSummary> {
	try {
		const result = parsePawRuntimeConfigYaml(await readFile(configFile, "utf-8"));
		if (result.ok) {
			return { status: "ok" };
		}
		return { status: "error", errorSummary: formatIssueSummary(result.issues) };
	} catch (error) {
		if (isFileSystemError(error) && error.code === "ENOENT") {
			return { status: "missing" };
		}
		return { status: "error", errorSummary: formatErrorSummary(error) };
	}
}

async function summarizePawVersion(versionFile: string): Promise<PawStatusVersionSummary> {
	try {
		const value = (await readFile(versionFile, "utf-8")).trim();
		if (value === "") {
			return { status: "error", errorSummary: "version file is empty" };
		}
		return { status: "present", value };
	} catch (error) {
		if (isFileSystemError(error) && error.code === "ENOENT") {
			return { status: "missing" };
		}
		return { status: "error", errorSummary: formatErrorSummary(error) };
	}
}

async function summarizePawSessions(repoRoot: string): Promise<{
	sessionDirectoryCount: number;
	stateCounts: Partial<Record<PawSessionStateName, number>>;
	invalidSessionCount: number;
}> {
	const sessionsDir = join(resolvePawProjectPaths(repoRoot).pawDir, "sessions");
	let sessionNames: string[];
	try {
		const entries = await readdir(sessionsDir, { withFileTypes: true });
		sessionNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
	} catch (error) {
		if (isFileSystemError(error) && error.code === "ENOENT") {
			return { sessionDirectoryCount: 0, stateCounts: {}, invalidSessionCount: 0 };
		}
		return { sessionDirectoryCount: 0, stateCounts: {}, invalidSessionCount: 1 };
	}

	const stateCounts: Partial<Record<PawSessionStateName, number>> = {};
	let invalidSessionCount = 0;

	for (const sessionName of sessionNames) {
		try {
			const state = await readPawSessionState(repoRoot, sessionName);
			stateCounts[state.name] = (stateCounts[state.name] ?? 0) + 1;
		} catch {
			invalidSessionCount += 1;
		}
	}

	return {
		sessionDirectoryCount: sessionNames.length,
		stateCounts,
		invalidSessionCount,
	};
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

function formatConfigSummary(summary: PawStatusConfigSummary): string {
	if (summary.status === "ok") {
		return "ok";
	}
	if (summary.status === "missing") {
		return "missing";
	}
	return `error: ${summary.errorSummary}`;
}

function formatVersionSummary(summary: PawStatusVersionSummary): string {
	if (summary.status === "present") {
		return summary.value;
	}
	if (summary.status === "missing") {
		return "missing";
	}
	return `error: ${summary.errorSummary}`;
}

function formatStateCountLines(stateCounts: Partial<Record<PawSessionStateName, number>>): string[] {
	const lines: string[] = [];
	for (const stateName of PAW_SESSION_STATE_NAMES) {
		const count = stateCounts[stateName] ?? 0;
		if (count > 0) {
			lines.push(`state ${stateName}: ${count}`);
		}
	}
	return lines;
}

function formatIssueSummary(issues: readonly { path: string; message: string }[]): string {
	return issues.map((issue) => `${issue.path} ${issue.message}`).join("; ");
}

function formatErrorSummary(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function printPawStatusHelp(): void {
	console.log(`Usage:
  ${APP_NAME} paw status

Print a read-only Paw project and session summary.

Commands:
  ${APP_NAME} paw status        Show read-only Paw project and session summary
  ${APP_NAME} paw status --help Show this help
`);
}

function printPawStatusCommandError(message: string): void {
	console.error(`Error: ${message}`);
	process.exitCode = 1;
}

function isFileSystemError(error: unknown): error is FileSystemError {
	return error instanceof Error;
}
