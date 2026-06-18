
/**
 * Shared utilities for compaction and branch summarization.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";

// ============================================================================
// File Operation Tracking
// ============================================================================

export interface FileOperations {
	read: Set<string>;
	written: Set<string>;
	edited: Set<string>;
}

export function createFileOps(): FileOperations {
	return {
		read: new Set(),
		written: new Set(),
		edited: new Set(),
	};
}

/**
 * Extract file operations from tool calls in an assistant message.
 */
export function extractFileOpsFromMessage(message: AgentMessage, fileOps: FileOperations): void {
	if (message.role !== "assistant") return;
	if (!("content" in message) || !Array.isArray(message.content)) return;

	for (const block of message.content) {
		extractFileOpFromBlock(block, fileOps);
	}
}

function extractFileOpFromBlock(block: unknown, fileOps: FileOperations): void {
	if (typeof block !== "object" || block === null) return;
	if (!("type" in block) || block.type !== "toolCall") return;
	if (!("arguments" in block) || !("name" in block)) return;

	const args = (block as { arguments: Record<string, unknown> }).arguments;
	const path = typeof args.path === "string" ? args.path : undefined;
	if (!path) return;

	switch (block.name) {
		case "read":
			fileOps.read.add(path);
			break;
		case "write":
			fileOps.written.add(path);
			break;
		case "edit":
			fileOps.edited.add(path);
			break;
	}
}

/**
 * Compute final file lists from file operations.
 * Returns readFiles (files only read, not modified) and modifiedFiles.
 */
export function computeFileLists(fileOps: FileOperations): { readFiles: string[]; modifiedFiles: string[] } {
	const modified = new Set([...fileOps.edited, ...fileOps.written]);
	const readOnly = [...fileOps.read].filter((f) => !modified.has(f)).sort((a, b) => a.localeCompare(b));
	const modifiedFiles = [...modified].sort((a, b) => a.localeCompare(b));
	return { readFiles: readOnly, modifiedFiles };
}

/**
 * Format file operations as XML tags for summary.
 */
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

// ============================================================================
// Message Serialization
// ============================================================================

/** Maximum characters for a tool result in serialized summaries. */
const TOOL_RESULT_MAX_CHARS = 2000;

/**
 * Truncate text to a maximum character length for summarization.
 * Keeps the beginning and appends a truncation marker.
 */
function truncateForSummary(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	const truncatedChars = text.length - maxChars;
	return `${text.slice(0, maxChars)}\n\n[... ${truncatedChars} more characters truncated]`;
}

/**
 * Serialize LLM messages to text for summarization.
 * This prevents the model from treating it as a conversation to continue.
 * Call convertToLlm() first to handle custom message types.
 *
 * Tool results are truncated to keep the summarization request within
 * reasonable token budgets. Full content is not needed for summarization.
 */
function extractUserText(content: string | ReadonlyArray<{ type: string; text?: string }>): string {
	return typeof content === "string"
		? content
		: content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("");
}

function extractToolResultText(content: ReadonlyArray<{ type: string; text?: string }>): string {
	return content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("");
}

function formatAssistantToolCall(block: { name: string; arguments: unknown }): string {
	const args = block.arguments as Record<string, unknown>;
	const argsStr = Object.entries(args)
		.map(([k, v]) => `${k}=${JSON.stringify(v)}`)
		.join(", ");
	return `${block.name}(${argsStr})`;
}

function serializeAssistantMessage(
	content: ReadonlyArray<{ type: string; text?: string; thinking?: string; name?: string; arguments?: unknown }>,
): string[] {
	const textParts: string[] = [];
	const thinkingParts: string[] = [];
	const toolCalls: string[] = [];
	for (const block of content) {
		if (block.type === "text" && block.text) {
			textParts.push(block.text);
		} else if (block.type === "thinking" && block.thinking) {
			thinkingParts.push(block.thinking);
		} else if (block.type === "toolCall" && block.name) {
			toolCalls.push(formatAssistantToolCall(block as never));
		}
	}
	const parts: string[] = [];
	if (thinkingParts.length > 0) {
		parts.push(`[Assistant thinking]: ${thinkingParts.join("\n")}`);
	}
	if (textParts.length > 0) {
		parts.push(`[Assistant]: ${textParts.join("\n")}`);
	}
	if (toolCalls.length > 0) {
		parts.push(`[Assistant tool calls]: ${toolCalls.join("; ")}`);
	}
	return parts;
}

export function serializeConversation(messages: Message[]): string {
	const parts: string[] = [];

	for (const msg of messages) {
		if (msg.role === "user") {
			const content = extractUserText(msg.content as never);
			if (content) parts.push(`[User]: ${content}`);
		} else if (msg.role === "assistant") {
			parts.push(...serializeAssistantMessage(msg.content as never));
		} else if (msg.role === "toolResult") {
			const content = extractToolResultText(msg.content as never);
			if (content) {
				parts.push(`[Tool result]: ${truncateForSummary(content, TOOL_RESULT_MAX_CHARS)}`);
			}
		}
	}

	return parts.join("\n\n");
}

// ============================================================================
// Summarization System Prompt
// ============================================================================

export const SUMMARIZATION_SYSTEM_PROMPT = `You are a context summarization assistant. Your task is to read a conversation between a user and an AI assistant, then produce a structured summary following the exact format specified.

Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.`;
