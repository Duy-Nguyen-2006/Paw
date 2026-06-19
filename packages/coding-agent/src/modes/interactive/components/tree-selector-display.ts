/**
 * Tree entry display formatting (reduces TreeList.getEntryDisplayText complexity).
 */

import type { SessionTreeNode } from "../../../core/session-manager.ts";
import { theme } from "../theme/theme.ts";

export interface ToolCallInfo {
	name: string;
	arguments: Record<string, unknown>;
}

export function normalizeTreeDisplayText(s: string): string {
	return s.replace(/[\n\t]/g, " ").trim();
}

export function extractTreeContent(content: unknown, maxLen = 200): string {
	if (typeof content === "string") return content.slice(0, maxLen);
	if (Array.isArray(content)) {
		let result = "";
		for (const c of content) {
			if (typeof c === "object" && c !== null && "type" in c && c.type === "text") {
				result += (c as { text: string }).text;
				if (result.length >= maxLen) return result.slice(0, maxLen);
			}
		}
		return result;
	}
	return "";
}

export function formatTreeToolCall(name: string, args: Record<string, unknown>): string {
	const shortenPath = (p: string): string => {
		const home = process.env.HOME || process.env.USERPROFILE || "";
		if (home && p.startsWith(home)) return `~${p.slice(home.length)}`;
		return p;
	};

	switch (name) {
		case "read": {
			const path = shortenPath(String(args.path || args.file_path || ""));
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			let display = path;
			if (offset !== undefined || limit !== undefined) {
				const start = offset ?? 1;
				const end = limit !== undefined ? start + limit - 1 : "";
				display += `:${start}${end ? `-${end}` : ""}`;
			}
			return `[read: ${display}]`;
		}
		case "write": {
			const path = shortenPath(String(args.path || args.file_path || ""));
			return `[write: ${path}]`;
		}
		case "edit": {
			const path = shortenPath(String(args.path || args.file_path || ""));
			return `[edit: ${path}]`;
		}
		case "bash": {
			const rawCmd = String(args.command || "");
			const cmd = rawCmd
				.replace(/[\n\t]/g, " ")
				.trim()
				.slice(0, 50);
			return `[bash: ${cmd}${rawCmd.length > 50 ? "..." : ""}]`;
		}
		case "grep": {
			const pattern = String(args.pattern || "");
			const path = shortenPath(String(args.path || "."));
			return `[grep: /${pattern}/ in ${path}]`;
		}
		case "find": {
			const pattern = String(args.pattern || "");
			const path = shortenPath(String(args.path || "."));
			return `[find: ${pattern} in ${path}]`;
		}
		case "ls": {
			const path = shortenPath(String(args.path || "."));
			return `[ls: ${path}]`;
		}
		default: {
			const argsStr = JSON.stringify(args).slice(0, 40);
			return `[${name}: ${argsStr}${JSON.stringify(args).length > 40 ? "..." : ""}]`;
		}
	}
}

export function getTreeEntryDisplayText(
	node: SessionTreeNode,
	isSelected: boolean,
	toolCallMap: Map<string, ToolCallInfo>,
): string {
	const entry = node.entry;
	let result: string;
	const normalize = normalizeTreeDisplayText;

	switch (entry.type) {
		case "message": {
			const msg = entry.message;
			const role = msg.role;
			if (role === "user") {
				const msgWithContent = msg as { content?: unknown };
				const content = normalize(extractTreeContent(msgWithContent.content));
				result = theme.fg("accent", "user: ") + content;
			} else if (role === "assistant") {
				const msgWithContent = msg as { content?: unknown; stopReason?: string; errorMessage?: string };
				const textContent = normalize(extractTreeContent(msgWithContent.content));
				if (textContent) {
					result = theme.fg("success", "assistant: ") + textContent;
				} else if (msgWithContent.stopReason === "aborted") {
					result = theme.fg("success", "assistant: ") + theme.fg("muted", "(aborted)");
				} else if (msgWithContent.errorMessage) {
					const errMsg = normalize(msgWithContent.errorMessage).slice(0, 80);
					result = theme.fg("success", "assistant: ") + theme.fg("error", errMsg);
				} else {
					result = theme.fg("success", "assistant: ") + theme.fg("muted", "(no content)");
				}
			} else if (role === "toolResult") {
				const toolMsg = msg as { toolCallId?: string; toolName?: string };
				const toolCall = toolMsg.toolCallId ? toolCallMap.get(toolMsg.toolCallId) : undefined;
				if (toolCall) {
					result = theme.fg("muted", formatTreeToolCall(toolCall.name, toolCall.arguments));
				} else {
					result = theme.fg("muted", `[${toolMsg.toolName ?? "tool"}]`);
				}
			} else if (role === "bashExecution") {
				const bashMsg = msg as { command?: string };
				result = theme.fg("dim", `[bash]: ${normalize(bashMsg.command ?? "")}`);
			} else {
				result = theme.fg("dim", `[${role}]`);
			}
			break;
		}
		case "custom_message": {
			const content =
				typeof entry.content === "string"
					? entry.content
					: entry.content
							.filter((c): c is { type: "text"; text: string } => c.type === "text")
							.map((c) => c.text)
							.join("");
			result = theme.fg("customMessageLabel", `[${entry.customType}]: `) + normalize(content);
			break;
		}
		case "compaction": {
			const tokens = Math.round(entry.tokensBefore / 1000);
			result = theme.fg("borderAccent", `[compaction: ${tokens}k tokens]`);
			break;
		}
		case "branch_summary":
			result = theme.fg("warning", `[branch summary]: `) + normalize(entry.summary);
			break;
		case "model_change":
			result = theme.fg("dim", `[model: ${entry.modelId}]`);
			break;
		case "thinking_level_change":
			result = theme.fg("dim", `[thinking: ${entry.thinkingLevel}]`);
			break;
		case "custom":
			result = theme.fg("dim", `[custom: ${entry.customType}]`);
			break;
		case "label":
			result = theme.fg("dim", `[label: ${entry.label ?? "(cleared)"}]`);
			break;
		case "session_info":
			result = entry.name
				? [theme.fg("dim", "[title: "), theme.fg("dim", entry.name), theme.fg("dim", "]")].join("")
				: [theme.fg("dim", "[title: "), theme.italic(theme.fg("dim", "empty")), theme.fg("dim", "]")].join("");
			break;
		default:
			result = "";
	}

	return isSelected ? theme.bold(result) : result;
}
