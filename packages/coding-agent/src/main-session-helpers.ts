/**
 * Session CLI resolution helpers (extracted from main.ts for S3776).
 */

import { createInterface } from "node:readline";
import chalk from "chalk";
import type { Args } from "./cli/args.ts";
import { selectSession } from "./cli/session-picker.ts";
import type { SettingsManager } from "./core/settings-manager.ts";
import { assertValidSessionId, SessionManager } from "./core/session-manager.ts";
import { initTheme, stopThemeWatcher } from "./modes/interactive/theme/theme.ts";
import { resolvePath } from "./utils/paths.ts";

/** Result from resolving a session argument */
export type ResolvedSession =
	| { type: "path"; path: string }
	| { type: "local"; path: string }
	| { type: "global"; path: string; cwd: string }
	| { type: "not_found"; arg: string };

export async function findLocalSessionByExactId(
	sessionId: string,
	cwd: string,
	sessionDir?: string,
): Promise<{ type: "local"; path: string } | undefined> {
	const localSessions = await SessionManager.list(cwd, sessionDir);
	const localMatch = localSessions.find((s) => s.id === sessionId);
	return localMatch ? { type: "local", path: localMatch.path } : undefined;
}

export async function resolveSessionPath(sessionArg: string, cwd: string, sessionDir?: string): Promise<ResolvedSession> {
	if (sessionArg.includes("/") || sessionArg.includes("\\") || sessionArg.endsWith(".jsonl")) {
		return { type: "path", path: resolvePath(sessionArg, cwd) };
	}

	const localSessions = await SessionManager.list(cwd, sessionDir);
	const localMatch =
		localSessions.find((s) => s.id === sessionArg) ?? localSessions.find((s) => s.id.startsWith(sessionArg));

	if (localMatch) {
		return { type: "local", path: localMatch.path };
	}

	const allSessions = await SessionManager.listAll(sessionDir);
	const globalMatch =
		allSessions.find((s) => s.id === sessionArg) ?? allSessions.find((s) => s.id.startsWith(sessionArg));

	if (globalMatch) {
		return { type: "global", path: globalMatch.path, cwd: globalMatch.cwd };
	}

	return { type: "not_found", arg: sessionArg };
}

export async function promptConfirm(message: string): Promise<boolean> {
	return new Promise((resolve) => {
		const rl = createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		rl.question(`${message} [y/N] `, (answer) => {
			rl.close();
			resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
		});
	});
}

function conflictingSessionFlags(parsed: Args): string[] {
	return [
		parsed.session ? "--session" : undefined,
		parsed.continue ? "--continue" : undefined,
		parsed.resume ? "--resume" : undefined,
		parsed.noSession ? "--no-session" : undefined,
	].filter((flag): flag is string => flag !== undefined);
}

export function validateForkFlags(parsed: Args): void {
	if (!parsed.fork) return;
	const conflictingFlags = conflictingSessionFlags(parsed);
	if (conflictingFlags.length > 0) {
		console.error(chalk.red(`Error: --fork cannot be combined with ${conflictingFlags.join(", ")}`));
		process.exit(1);
	}
}

export function validateSessionIdFlags(parsed: Args): void {
	if (parsed.sessionId === undefined) return;
	const conflictingFlags = conflictingSessionFlags(parsed);
	if (conflictingFlags.length > 0) {
		console.error(chalk.red(`Error: --session-id cannot be combined with ${conflictingFlags.join(", ")}`));
		process.exit(1);
	}
	try {
		assertValidSessionId(parsed.sessionId);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(chalk.red(`Error: ${message}`));
		process.exit(1);
	}
}

export function forkSessionOrExit(sourcePath: string, cwd: string, sessionDir?: string, sessionId?: string): SessionManager {
	try {
		return SessionManager.forkFrom(sourcePath, cwd, sessionDir, { id: sessionId });
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(chalk.red(`Error: ${message}`));
		process.exit(1);
	}
}

async function openSessionFromResolved(
	resolved: ResolvedSession,
	cwd: string,
	sessionDir: string | undefined,
): Promise<SessionManager> {
	switch (resolved.type) {
		case "path":
		case "local":
			return SessionManager.open(resolved.path, sessionDir);
		case "global": {
			console.log(chalk.yellow(`Session found in different project: ${resolved.cwd}`));
			const shouldFork = await promptConfirm("Fork this session into current directory?");
			if (!shouldFork) {
				console.log(chalk.dim("Aborted."));
				process.exit(0);
			}
			return forkSessionOrExit(resolved.path, cwd, sessionDir);
		}
		case "not_found":
			console.error(chalk.red(`No session found matching '${resolved.arg}'`));
			process.exit(1);
	}
}

export async function createSessionManager(
	parsed: Args,
	cwd: string,
	sessionDir: string | undefined,
	settingsManager: SettingsManager,
): Promise<SessionManager> {
	if (parsed.noSession || parsed.help || parsed.listModels !== undefined) {
		return SessionManager.inMemory(cwd);
	}

	if (parsed.fork) {
		if (parsed.sessionId) {
			const existingTarget = await findLocalSessionByExactId(parsed.sessionId, cwd, sessionDir);
			if (existingTarget) {
				console.error(chalk.red(`Session already exists with id '${parsed.sessionId}'`));
				process.exit(1);
			}
		}
		const resolved = await resolveSessionPath(parsed.fork, cwd, sessionDir);
		if (resolved.type === "not_found") {
			console.error(chalk.red(`No session found matching '${resolved.arg}'`));
			process.exit(1);
		}
		return forkSessionOrExit(resolved.path, cwd, sessionDir, parsed.sessionId);
	}

	if (parsed.session) {
		const resolved = await resolveSessionPath(parsed.session, cwd, sessionDir);
		return openSessionFromResolved(resolved, cwd, sessionDir);
	}

	if (parsed.resume) {
		initTheme(settingsManager.getTheme(), true);
		try {
			const selectedPath = await selectSession(
				(onProgress) => SessionManager.list(cwd, sessionDir, onProgress),
				(onProgress) => SessionManager.listAll(sessionDir, onProgress),
			);
			if (!selectedPath) {
				console.log(chalk.dim("No session selected"));
				process.exit(0);
			}
			return SessionManager.open(selectedPath, sessionDir);
		} finally {
			stopThemeWatcher();
		}
	}

	if (parsed.continue) {
		return SessionManager.continueRecent(cwd, sessionDir);
	}

	if (parsed.sessionId) {
		const existingSession = await findLocalSessionByExactId(parsed.sessionId, cwd, sessionDir);
		if (existingSession) {
			return SessionManager.open(existingSession.path, sessionDir);
		}
	}

	return SessionManager.create(cwd, sessionDir, { id: parsed.sessionId });
}
