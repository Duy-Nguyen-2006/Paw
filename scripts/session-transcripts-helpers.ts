/**
 * Session transcript CLI helpers (extracted from session-transcripts.ts for S3776).
 */

import { resolve } from "node:path";
import chalk from "chalk";

export const MAX_DISPLAY_WIDTH = 100;

export interface JsonEvent {
	type: string;
	assistantMessageEvent?: { type: string; delta?: string };
	toolName?: string;
	args?: {
		path?: string;
		offset?: number;
		limit?: number;
		content?: string;
	};
}

export function truncateLine(text: string, maxWidth: number): string {
	const singleLine = text.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
	if (singleLine.length <= maxWidth) return singleLine;
	return `${singleLine.slice(0, maxWidth - 3)}...`;
}

export function formatToolArgsString(toolName: string, args: JsonEvent["args"]): string {
	if (!args) return "";
	if (toolName === "read") {
		let argsStr = args.path || "";
		if (args.offset) argsStr += ` offset=${args.offset}`;
		if (args.limit) argsStr += ` limit=${args.limit}`;
		return argsStr;
	}
	if (toolName === "write") {
		return args.path || "";
	}
	return "";
}

export type JsonLineHandlerState = { textBuffer: string };

export function handleJsonEventLine(event: JsonEvent, state: JsonLineHandlerState): void {
	if (event.type === "message_update" && event.assistantMessageEvent) {
		const msgEvent = event.assistantMessageEvent;
		if (msgEvent.type === "text_delta" && msgEvent.delta) {
			state.textBuffer += msgEvent.delta;
		}
		return;
	}

	if (event.type === "tool_execution_start" && event.toolName) {
		if (state.textBuffer.trim()) {
			console.log(chalk.dim(`  ${truncateLine(state.textBuffer, MAX_DISPLAY_WIDTH)}`));
			state.textBuffer = "";
		}
		const argsStr = formatToolArgsString(event.toolName, event.args);
		console.log(chalk.cyan(`  [${event.toolName}] ${argsStr}`));
		return;
	}

	if (event.type === "turn_end") {
		if (state.textBuffer.trim()) {
			console.log(chalk.dim(`  ${truncateLine(state.textBuffer, MAX_DISPLAY_WIDTH)}`));
		}
		state.textBuffer = "";
	}
}

export interface ParsedTranscriptCli {
	analyzeFlag: boolean;
	outputDir: string;
	cwd: string;
}

export function parseTranscriptCliArgs(argv: string[]): ParsedTranscriptCli {
	const analyzeFlag = argv.includes("--analyze");
	const outputIdx = argv.indexOf("--output");
	let outputDir = resolve("./session-transcripts");
	if (outputIdx !== -1 && argv[outputIdx + 1]) {
		outputDir = resolve(argv[outputIdx + 1]);
	}
	const flagIndices = new Set<number>();
	flagIndices.add(argv.indexOf("--analyze"));
	if (outputIdx !== -1) {
		flagIndices.add(outputIdx);
		flagIndices.add(outputIdx + 1);
	}
	const cwdArg = argv.find((a, i) => !flagIndices.has(i) && !a.startsWith("--"));
	const cwd = resolve(cwdArg || process.cwd());
	return { analyzeFlag, outputDir, cwd };
}
