
import { spawn } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Text } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";
import { keyHint } from "../../modes/interactive/components/keybinding-hints.ts";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import { ensureTool } from "../../utils/tools-manager.ts";
import type { ToolDefinition, ToolRenderResultOptions } from "../extensions/types.ts";
import { pathExists, resolveToCwd } from "./path-utils.ts";
import { getTextOutput, invalidArgText, shortenPath, str } from "./render-utils.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";
import { DEFAULT_MAX_BYTES, formatSize, type TruncationResult, truncateHead } from "./truncate.ts";

function toPosixPath(value: string): string {
	return value.split(path.sep).join("/");
}

const findSchema = Type.Object({
	pattern: Type.String({
		description: "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'",
	}),
	path: Type.Optional(Type.String({ description: "Directory to search in (default: current directory)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of results (default: 1000)" })),
});

export type FindToolInput = Static<typeof findSchema>;

const DEFAULT_LIMIT = 1000;

export interface FindToolDetails {
	truncation?: TruncationResult;
	resultLimitReached?: number;
}

/**
 * Pluggable operations for the find tool.
 * Override these to delegate file search to remote systems (for example SSH).
 */
export interface FindOperations {
	/** Check if path exists */
	exists: (absolutePath: string) => Promise<boolean> | boolean;
	/** Find files matching glob pattern. Returns relative or absolute paths. */
	glob: (pattern: string, cwd: string, options: { ignore: string[]; limit: number }) => Promise<string[]> | string[];
}

const defaultFindOperations: FindOperations = {
	exists: pathExists,
	// This is a placeholder. Actual fd execution happens in execute() when no custom glob is provided.
	glob: () => [],
};

export interface FindToolOptions {
	/** Custom operations for find. Default: local filesystem plus fd */
	operations?: FindOperations;
}

function formatFindCall(args: { pattern: string; path?: string; limit?: number } | undefined, theme: Theme): string {
	const pattern = str(args?.pattern);
	const rawPath = str(args?.path);
	const path = rawPath !== null ? shortenPath(rawPath || ".") : null;
	const limit = args?.limit;
	const invalidArg = invalidArgText(theme);
	let text =
		theme.fg("toolTitle", theme.bold("find")) +
		" " +
		(pattern === null ? invalidArg : theme.fg("accent", pattern || "")) +
		theme.fg("toolOutput", ` in ${path === null ? invalidArg : path}`);
	if (limit !== undefined) {
		text += theme.fg("toolOutput", ` (limit ${limit})`);
	}
	return text;
}

function formatFindResult(
	result: {
		content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		details?: FindToolDetails;
	},
	options: ToolRenderResultOptions,
	theme: Theme,
	showImages: boolean,
): string {
	const output = getTextOutput(result, showImages).trim();
	let text = "";
	if (output) {
		const lines = output.split("\n");
		const maxLines = options.expanded ? lines.length : 20;
		const displayLines = lines.slice(0, maxLines);
		const remaining = lines.length - maxLines;
		text += `\n${displayLines.map((line) => theme.fg("toolOutput", line)).join("\n")}`;
		if (remaining > 0) {
			text += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;
		}
	}

	const resultLimit = result.details?.resultLimitReached;
	const truncation = result.details?.truncation;
	if (resultLimit || truncation?.truncated) {
		const warnings: string[] = [];
		if (resultLimit) warnings.push(`${resultLimit} results limit`);
		if (truncation?.truncated) warnings.push(`${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit`);
		text += `\n${theme.fg("warning", `[Truncated: ${warnings.join(", ")}]`)}`;
	}
	return text;
}

/**
 * Build the final result payload from a list of raw paths (custom ops path).
 */
function buildRelativizedResult(
	results: string[],
	searchPath: string,
	effectiveLimit: number,
): { resultOutput: string; details: FindToolDetails } {
	const relativized = results.map((p) => {
		if (p.startsWith(searchPath)) return toPosixPath(p.slice(searchPath.length + 1));
		return toPosixPath(path.relative(searchPath, p));
	});
	const resultLimitReached = relativized.length >= effectiveLimit;
	const rawOutput = relativized.join("\n");
	const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });
	let resultOutput = truncation.content;
	const details: FindToolDetails = {};
	const notices: string[] = [];
	if (resultLimitReached) {
		notices.push(`${effectiveLimit} results limit reached`);
		details.resultLimitReached = effectiveLimit;
	}
	if (truncation.truncated) {
		notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
		details.truncation = truncation;
	}
	if (notices.length > 0) {
		resultOutput += `\n\n[${notices.join(". ")}]`;
	}
	return { resultOutput, details };
}

/**
 * Relativize raw fd output lines against the search root and build the result payload.
 */
function relativizeFdLines(
	lines: string[],
	searchPath: string,
	effectiveLimit: number,
): { resultOutput: string; details: FindToolDetails } {
	const relativized: string[] = [];
	for (const rawLine of lines) {
		const line = rawLine.replace(/\r$/, "").trim();
		if (!line) continue;
		const hadTrailingSlash = line.endsWith("/") || line.endsWith("\\");
		let relativePath = line;
		if (line.startsWith(searchPath)) {
			relativePath = line.slice(searchPath.length + 1);
		} else {
			relativePath = path.relative(searchPath, line);
		}
		if (hadTrailingSlash && !relativePath.endsWith("/")) relativePath += "/";
		relativized.push(toPosixPath(relativePath));
	}

	const resultLimitReached = relativized.length >= effectiveLimit;
	const rawOutput = relativized.join("\n");
	const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });
	let resultOutput = truncation.content;
	const details: FindToolDetails = {};
	const notices: string[] = [];
	if (resultLimitReached) {
		notices.push(
			`${effectiveLimit} results limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`,
		);
		details.resultLimitReached = effectiveLimit;
	}
	if (truncation.truncated) {
		notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
		details.truncation = truncation;
	}
	if (notices.length > 0) {
		resultOutput += `\n\n[${notices.join(". ")}]`;
	}
	return { resultOutput, details };
}

/**
 * Build the fd CLI argument list from the search pattern and limit.
 */
function buildFdArgs(
	pattern: string,
	searchPath: string,
	effectiveLimit: number,
): { args: string[]; effectivePattern: string } {
	const args: string[] = [
		"--glob",
		"--color=never",
		"--hidden",
		"--no-require-git",
		"--max-results",
		String(effectiveLimit),
	];

	let effectivePattern = pattern;
	if (pattern.includes("/")) {
		args.push("--full-path");
		if (!pattern.startsWith("/") && !pattern.startsWith("**/") && pattern !== "**") {
			effectivePattern = `**/${pattern}`;
		}
	}
	args.push("--", effectivePattern, searchPath);
	return { args, effectivePattern };
}

async function runCustomOpsFind(options: {
	pattern: string;
	searchPath: string;
	effectiveLimit: number;
	ops: FindOperations;
	signal: AbortSignal | undefined;
	onSettled: () => void;
	noMatch: () => void;
	resolve: (value: AgentToolResult<FindToolDetails | undefined>) => void;
	reject: (err: Error) => void;
}): Promise<void> {
	const { pattern, searchPath, effectiveLimit, ops, signal, onSettled, noMatch, resolve, reject } = options;
	if (!(await ops.exists(searchPath))) {
		reject(new Error(`Path not found: ${searchPath}`));
		onSettled();
		return;
	}
	if (signal?.aborted) {
		reject(new Error("Operation aborted"));
		onSettled();
		return;
	}
	const results = await ops.glob(pattern, searchPath, {
		ignore: ["**/node_modules/**", "**/.git/**"],
		limit: effectiveLimit,
	});
	if (signal?.aborted) {
		reject(new Error("Operation aborted"));
		onSettled();
		return;
	}
	if (results.length === 0) {
		noMatch();
		onSettled();
		return;
	}

	const { resultOutput, details } = buildRelativizedResult(results, searchPath, effectiveLimit);
	resolve({
		content: [{ type: "text", text: resultOutput }],
		details: Object.keys(details).length > 0 ? details : undefined,
	});
	onSettled();
}

function runFdFind(options: {
	pattern: string;
	searchPath: string;
	effectiveLimit: number;
	signal: AbortSignal | undefined;
	onSettled: () => void;
	setStopChild: (fn: () => void) => void;
	noMatch: () => void;
	resolve: (value: AgentToolResult<FindToolDetails | undefined>) => void;
	reject: (err: Error) => void;
}): Promise<void> {
	return new Promise((resolveOuter) => {
		void (async () => {
			try {
				const fdPath = await ensureTool("fd", true);
				if (options.signal?.aborted) {
					options.reject(new Error("Operation aborted"));
					options.onSettled();
					resolveOuter();
					return;
				}
				if (!fdPath) {
					options.reject(new Error("fd is not available and could not be downloaded"));
					options.onSettled();
					resolveOuter();
					return;
				}

				const { args } = buildFdArgs(options.pattern, options.searchPath, options.effectiveLimit);
				const child = spawn(fdPath, args, { stdio: ["ignore", "pipe", "pipe"] });
				const rl = createInterface({ input: child.stdout });
				let stderr = "";
				const lines: string[] = [];

				options.setStopChild(() => {
					if (!child.killed) child.kill();
				});

				const cleanup = () => {
					rl.close();
				};

				child.stderr?.on("data", (chunk) => {
					stderr += chunk.toString();
				});

				rl.on("line", (line) => {
					lines.push(line);
				});

				child.on("error", (error) => {
					cleanup();
					options.reject(new Error(`Failed to run fd: ${error.message}`));
					options.onSettled();
					resolveOuter();
				});

				child.on("close", (code) => {
					cleanup();
					if (options.signal?.aborted) {
						options.reject(new Error("Operation aborted"));
						options.onSettled();
						resolveOuter();
						return;
					}
					const output = lines.join("\n");
					if (code !== 0) {
						const errorMsg = stderr.trim() || `fd exited with code ${code}`;
						if (!output) {
							options.reject(new Error(errorMsg));
							options.onSettled();
							resolveOuter();
							return;
						}
					}
					if (!output) {
						options.noMatch();
						options.onSettled();
						resolveOuter();
						return;
					}

					const { resultOutput, details } = relativizeFdLines(lines, options.searchPath, options.effectiveLimit);
					options.resolve({
						content: [{ type: "text", text: resultOutput }],
						details: Object.keys(details).length > 0 ? details : undefined,
					});
					options.onSettled();
					resolveOuter();
				});
			} catch (e) {
				if (options.signal?.aborted) {
					options.reject(new Error("Operation aborted"));
					options.onSettled();
					resolveOuter();
					return;
				}
				const error = e instanceof Error ? e : new Error(String(e));
				options.reject(error);
				options.onSettled();
				resolveOuter();
			}
		})();
	});
}

interface FindExecuteContext {
	pattern: string;
	searchDir?: string;
	limit?: number;
	cwd: string;
	signal: AbortSignal | undefined;
	customOps: FindOperations | undefined;
	controller: { stopChild: (() => void) | undefined };
	resolve: (value: AgentToolResult<FindToolDetails | undefined>) => void;
	reject: (err: Error) => void;
}

async function runFindExecute(ctx: FindExecuteContext): Promise<void> {
	const { pattern, searchDir, limit, cwd, signal, customOps, controller, resolve, reject } = ctx;
	try {
		const searchPath = resolveToCwd(searchDir || ".", cwd);
		const effectiveLimit = limit ?? DEFAULT_LIMIT;
		const ops = customOps ?? defaultFindOperations;

		const setStopChild = (fn: () => void) => {
			controller.stopChild = fn;
		};
		const onSettled = () => {
			// Mark outer settled state through stopChild cleanup; the underlying
			// resolve/reject are already invoked by callers.
			controller.stopChild = undefined;
		};
		const noMatch = () => {
			resolve({
				content: [{ type: "text", text: "No files found matching pattern" }],
				details: undefined,
			});
		};

		if (customOps?.glob) {
			await runCustomOpsFind({
				pattern,
				searchPath,
				effectiveLimit,
				ops,
				signal,
				onSettled,
				noMatch,
				resolve,
				reject,
			});
			return;
		}

		await runFdFind({
			pattern,
			searchPath,
			effectiveLimit,
			signal,
			onSettled,
			setStopChild,
			noMatch,
			resolve,
			reject,
		});
	} catch (e) {
		if (signal?.aborted) {
			reject(new Error("Operation aborted"));
			return;
		}
		const error = e instanceof Error ? e : new Error(String(e));
		reject(error);
	}
}

function findAbortHandler(
	controller: { stopChild: (() => void) | undefined },
	reject: (err: Error) => void,
	settle: (fn: () => void) => void,
): () => void {
	return () => {
		controller.stopChild?.();
		settle(() => reject(new Error("Operation aborted")));
	};
}

export function createFindToolDefinition(
	cwd: string,
	options?: FindToolOptions,
): ToolDefinition<typeof findSchema, FindToolDetails | undefined> {
	const customOps = options?.operations;
	return {
		name: "find",
		label: "find",
		description: `Search for files by glob pattern. Returns matching file paths relative to the search directory. Respects .gitignore. Output is truncated to ${DEFAULT_LIMIT} results or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
		promptSnippet: "Find files by glob pattern (respects .gitignore)",
		parameters: findSchema,

		async execute(
			_toolCallId,
			{ pattern, path: searchDir, limit }: { pattern: string; path?: string; limit?: number },
			signal?: AbortSignal,
			_onUpdate?,
			_ctx?,
		) {
			return new Promise((resolve, reject) => {
				if (signal?.aborted) {
					reject(new Error("Operation aborted"));
					return;
				}

				const controller: { stopChild: (() => void) | undefined } = { stopChild: undefined };
				let settled = false;
				let abortListener: (() => void) | undefined;
				const settle = (fn: () => void) => {
					if (settled) return;
					settled = true;
					if (abortListener) signal?.removeEventListener("abort", abortListener);
					controller.stopChild = undefined;
					fn();
				};
				const resolveSettled = (value: AgentToolResult<FindToolDetails | undefined>) =>
					settle(() => resolve(value));
				const rejectSettled = (err: Error) => settle(() => reject(err));
				abortListener = findAbortHandler(controller, rejectSettled, settle);
				signal?.addEventListener("abort", abortListener, { once: true });

				runFindExecute({
					pattern,
					searchDir,
					limit,
					cwd,
					signal,
					customOps,
					controller,
					resolve: resolveSettled,
					reject: rejectSettled,
				});
			});
		},
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(formatFindCall(args, theme));
			return text;
		},
		renderResult(result, options, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(formatFindResult(result as any, options, theme, context.showImages));
			return text;
		},
	};
}

export function createFindTool(cwd: string, options?: FindToolOptions): AgentTool<typeof findSchema> {
	return wrapToolDefinition(createFindToolDefinition(cwd, options));
}
