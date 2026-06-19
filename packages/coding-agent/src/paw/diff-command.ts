import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { APP_NAME } from "../config.ts";
import { resolvePawSessionPaths } from "./session-store.ts";
import { readPawSliceJournal } from "./slice-journal.ts";

export type PawDiffScope = "staged" | "working" | "all" | "session";

export interface PawDiffParsedArgs {
	scope: PawDiffScope;
	sessionId: string | null;
	stat: boolean;
	commandRunner?: (input: {
		command: string;
		args: string[];
		cwd: string;
	}) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

export type PawDiffParseResult =
	| { kind: "help" }
	| { kind: "error"; message: string }
	| { kind: "ok"; args: PawDiffParsedArgs };

export interface PawDiffResult {
	scope: PawDiffScope;
	summary: string;
	entries: readonly PawDiffEntry[];
}

export interface PawDiffEntry {
	slice_id: string | null;
	path: string;
	change_type: string;
	apply_method: string;
	content_hash: string;
}

export function parsePawDiffArgs(args: string[]): PawDiffParseResult {
	if (args.length === 0) {
		return { kind: "help" };
	}
	if (args[0] === "--help" || args[0] === "-h") {
		return { kind: "help" };
	}
	let scope: PawDiffScope = "working";
	let sessionId: string | null = null;
	let stat = false;
	let runner: PawDiffParsedArgs["commandRunner"] | undefined;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--staged") scope = "staged";
		else if (arg === "--all") scope = "all";
		else if (arg === "--session") {
			const value = args[index + 1];
			if (value === undefined) return { kind: "error", message: "Missing value for --session" };
			sessionId = value;
			index += 1;
		} else if (arg === "--stat") stat = true;
		else if (arg === "--working") scope = "working";
		else if (arg.startsWith("--")) {
			return { kind: "error", message: `Unknown option for "paw diff": ${arg}` };
		} else if (sessionId === null) {
			sessionId = arg;
			scope = "session";
		} else {
			return { kind: "error", message: `Unexpected positional argument: ${arg}` };
		}
	}
	return { kind: "ok", args: { scope, sessionId, stat, commandRunner: runner } };
}

export async function runPawDiffCommand(args: string[]): Promise<void> {
	const parsed = parsePawDiffArgs(args);
	if (parsed.kind === "help") {
		printPawDiffHelp();
		return;
	}
	if (parsed.kind === "error") {
		console.error(`Error: ${parsed.message}`);
		process.exitCode = 1;
		return;
	}
	try {
		const result = await createPawDiffResult(parsed.args);
		console.log(formatPawDiffResult(result));
	} catch (error) {
		console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
}

export async function createPawDiffResult(args: PawDiffParsedArgs): Promise<PawDiffResult> {
	if (args.scope === "session") {
		if (args.sessionId === null) {
			throw new Error("Session scope requires --session <id> or a positional session id.");
		}
		const repoRoot = resolve(process.cwd());
		const journal = await readPawSliceJournal(repoRoot, args.sessionId);
		const entries: PawDiffEntry[] = journal.map((entry) => ({
			slice_id: entry.slice_id,
			path: entry.path,
			change_type: entry.change_type,
			apply_method: entry.apply_method ?? "unknown",
			content_hash: entry.content_hash,
		}));
		const summary = `${entries.length} journal entries for session ${args.sessionId}`;
		return { scope: args.scope, summary, entries };
	}
	const runner = args.commandRunner ?? runLocalDiffCommand;
	const cwd = process.cwd();
	let command: string;
	let gitArgs: string[];
	switch (args.scope) {
		case "staged":
			command = "git";
			gitArgs = args.stat ? ["diff", "--stat", "--cached"] : ["diff", "--cached"];
			break;
		case "working":
			command = "git";
			gitArgs = args.stat ? ["diff", "--stat"] : ["diff"];
			break;
		case "all":
			command = "git";
			gitArgs = args.stat ? ["diff", "--stat", "HEAD"] : ["diff", "HEAD"];
			break;
		default:
			command = "git";
			gitArgs = ["status", "--short"];
	}
	const result = await runner({ command, args: gitArgs, cwd });
	if (result.exitCode !== 0) {
		throw new Error(`${command} ${gitArgs.join(" ")} failed: ${result.stderr || result.stdout}`);
	}
	return {
		scope: args.scope,
		summary: `${gitArgs.join(" ")} on ${cwd}`,
		entries: result.stdout
			.split("\n")
			.filter((line) => line.length > 0)
			.map((line) => ({
				slice_id: null,
				path: line,
				change_type: "git",
				apply_method: "git",
				content_hash: "",
			})),
	};
}

export function formatPawDiffResult(result: PawDiffResult): string {
	const lines = [`Paw diff`, `scope: ${result.scope}`, `summary: ${result.summary}`];
	if (result.entries.length === 0) {
		lines.push("entries: (none)");
	} else {
		for (const entry of result.entries) {
			lines.push(
				`  ${entry.change_type.padEnd(7)} ${entry.apply_method.padEnd(10)} ${entry.path}${entry.content_hash ? `  ${entry.content_hash}` : ""}`,
			);
		}
	}
	return lines.join("\n");
}

function runLocalDiffCommand(input: { command: string; args: string[]; cwd: string }): Promise<{
	exitCode: number;
	stdout: string;
	stderr: string;
}> {
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

function printPawDiffHelp(): void {
	console.log(`Usage:
  ${APP_NAME} paw diff [--staged|--working|--all] [--stat]
  ${APP_NAME} paw diff <session-id>
  ${APP_NAME} paw diff --session <session-id> [--stat]

Show the Paw session diff or git working tree diff.

Scopes:
  --staged     Show staged git diff
  --working    Show working tree git diff (default)
  --all        Show diff against HEAD
  <session-id> Show slice journal diff for a session
`);
}

export async function _readPawSessionStateFile(repoRoot: string, sessionId: string): Promise<string> {
	const paths = resolvePawSessionPaths(repoRoot, sessionId);
	return readFile(paths.stateFile, "utf-8");
}
