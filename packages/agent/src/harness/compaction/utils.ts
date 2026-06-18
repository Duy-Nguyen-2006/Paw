
import type { Message } from "@earendil-works/pi-ai";
import type { AgentMessage } from "../../types.ts";

/** File paths touched by a session branch or compaction range. */
export interface FileOperations {
	/** Files read but not necessarily modified. */
	read: Set<string>;
	/** Files written by full-file write operations. */
	written: Set<string>;
	/** Files modified by edit operations. */
	edited: Set<string>;
}

/** Create an empty file-operation accumulator. */
export function createFileOps(): FileOperations {
	return {
		read: new Set(),
		written: new Set(),
		edited: new Set(),
	};
}

const TOOL_FILE_OP_MAP: Record<string, keyof FileOperations> = {
	read: "read",
	write: "written",
	edit: "edited",
};

function isToolCallBlock(
	block: unknown,
): block is { type: "toolCall"; name: string; arguments: Record<string, unknown> | undefined } {
	return (
		typeof block === "object" &&
		block !== null &&
		"type" in block &&
		(block as any).type === "toolCall" &&
		"arguments" in block &&
		"name" in block
	);
}

/** Add file operations from assistant tool calls to an accumulator. */
export function extractFileOpsFromMessage(message: AgentMessage, fileOps: FileOperations): void {
	if (message.role !== "assistant") return;
	if (!("content" in message) || !Array.isArray(message.content)) return;

	for (const block of message.content) {
		if (!isToolCallBlock(block)) continue;
		const path = typeof block.arguments?.path === "string" ? block.arguments.path : undefined;
		if (!path) continue;
		const opKey = TOOL_FILE_OP_MAP[block.name];
		if (opKey) fileOps[opKey].add(path);
	}
}

/** Compute sorted read-only and modified file lists from accumulated operations. */
export function computeFileLists(fileOps: FileOperations): { readFiles: string[]; modifiedFiles: string[] } {
	const modified = new Set([...fileOps.edited, ...fileOps.written]);
	const readOnly = [...fileOps.read].filter((f) => !modified.has(f)).sort((a, b) => a.localeCompare(b));
	const modifiedFiles = [...modified].sort((a, b) => a.localeCompare(b));
	return { readFiles: readOnly, modifiedFiles };
}

/** Format file lists as summary metadata tags. */
export function formatFileOperations(readFiles: string[], modifiedFiles: string[]): string {
	const sections: string[] = [];
	if (readFiles.length > 0) {
		sections.push(`<read-files>\n${readFiles.join("\n")}\n</read-files>`);
	}
	if (modifiedFiles.length > 0) {
		sections.push(`<modified-files>\n${modifiedFiles.join("\n")}\n</modified-files>`);
	}
	if (sections.length === 0) return "";
	return `\n\n${sections.join("\n\n")}`;
}

const TOOL_RESULT_MAX_CHARS = 2000;

function safeJsonStringify(value: unknown): string {
	try {
		return JSON.stringify(value) ?? "undefined";
	} catch {
		return "[unserializable]";
	}
}

function truncateForSummary(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	const truncatedChars = text.length - maxChars;
	return `${text.slice(0, maxChars)}\n\n[... ${truncatedChars} more characters truncated]`;
}

function extractTextContent(content: string | Array<{ type: string; text?: string }>): string {
	if (typeof content === "string") return content;
	return content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("");
}

function serializeAssistantMessage(msg: Message & { role: "assistant" }): string[] {
	const textParts: string[] = [];
	const thinkingParts: string[] = [];
	const toolCalls: string[] = [];

	collectAssistantBlocks(msg, textParts, thinkingParts, toolCalls);
	return buildAssistantOutput(thinkingParts, textParts, toolCalls);
}

/** Bucket assistant content blocks into text, thinking, and tool-call arrays. */
function collectAssistantBlocks(
	msg: Message & { role: "assistant" },
	textParts: string[],
	thinkingParts: string[],
	toolCalls: string[],
): void {
	for (const block of msg.content) {
		if (block.type === "text") {
			textParts.push(block.text);
		} else if (block.type === "thinking") {
			thinkingParts.push(block.thinking);
		} else if (block.type === "toolCall") {
			toolCalls.push(formatToolCall(block));
		}
	}
}

/** Format a single tool-call block as a `name(k=v, ...)` string. */
function formatToolCall(block: { name: string; arguments: unknown }): string {
	const args = (block.arguments ?? {}) as Record<string, unknown>;
	const argsStr = Object.entries(args)
		.map(([k, v]) => `${k}=${safeJsonStringify(v)}`)
		.join(", ");
	return `${block.name}(${argsStr})`;
}

/** Combine assistant text, thinking, and tool-call buckets into a labelled output list. */
function buildAssistantOutput(thinkingParts: string[], textParts: string[], toolCalls: string[]): string[] {
	const result: string[] = [];
	if (thinkingParts.length > 0) result.push(`[Assistant thinking]: ${thinkingParts.join("\n")}`);
	if (textParts.length > 0) result.push(`[Assistant]: ${textParts.join("\n")}`);
	if (toolCalls.length > 0) result.push(`[Assistant tool calls]: ${toolCalls.join("; ")}`);
	return result;
}

function serializeUserMessage(msg: Message & { role: "user" }, parts: string[]): void {
	const content = extractTextContent(msg.content);
	if (content) parts.push(`[User]: ${content}`);
}

function serializeToolResultMessage(msg: Message & { role: "toolResult" }, parts: string[]): void {
	const content = extractTextContent(msg.content);
	if (content) parts.push(`[Tool result]: ${truncateForSummary(content, TOOL_RESULT_MAX_CHARS)}`);
}

/** Serialize LLM messages to plain text for summarization prompts. */
export function serializeConversation(messages: Message[]): string {
	const parts: string[] = [];

	for (const msg of messages) {
		if (msg.role === "user") {
			serializeUserMessage(msg, parts);
		} else if (msg.role === "assistant") {
			parts.push(...serializeAssistantMessage(msg));
		} else if (msg.role === "toolResult") {
			serializeToolResultMessage(msg, parts);
		}
	}

	return parts.join("\n\n");
}
