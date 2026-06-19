/**
 * Tree list filter/flatten helpers (reduces TreeList S3776).
 */

import type { SessionEntry, SessionTreeNode } from "../../../core/session-manager.ts";
import { extractTreeContent } from "./tree-selector-display.ts";

/** Filter mode for tree display */
export type FilterMode = "default" | "no-tools" | "user-only" | "labeled-only" | "all";

export interface GutterInfo {
	position: number;
	show: boolean;
}

export interface TreeFlatNode {
	node: SessionTreeNode;
	indent: number;
	showConnector: boolean;
	isLast: boolean;
	gutters: GutterInfo[];
	isVirtualRootChild: boolean;
}

export interface ToolCallInfo {
	name: string;
	arguments: Record<string, unknown>;
}

export function hasTreeTextContent(content: unknown): boolean {
	if (typeof content === "string") return content.trim().length > 0;
	if (Array.isArray(content)) {
		for (const c of content) {
			if (typeof c === "object" && c !== null && "type" in c && c.type === "text") {
				const text = (c as { text?: string }).text;
				if (text && text.trim().length > 0) return true;
			}
		}
	}
	return false;
}

function isSettingsEntryType(entry: SessionEntry): boolean {
	return (
		entry.type === "label" ||
		entry.type === "custom" ||
		entry.type === "model_change" ||
		entry.type === "thinking_level_change" ||
		entry.type === "session_info"
	);
}

export function entryPassesTreeFilterMode(
	entry: SessionEntry,
	filterMode: FilterMode,
	hasLabel: boolean,
): boolean {
	switch (filterMode) {
		case "user-only":
			return entry.type === "message" && entry.message.role === "user";
		case "no-tools":
			return (
				!isSettingsEntryType(entry) && !(entry.type === "message" && entry.message.role === "toolResult")
			);
		case "labeled-only":
			return hasLabel;
		case "all":
			return true;
		default:
			return !isSettingsEntryType(entry);
	}
}

export function shouldHideToolOnlyAssistant(
	entry: SessionEntry,
	currentLeafId: string | null,
): boolean {
	if (entry.type !== "message" || entry.message.role !== "assistant") {
		return false;
	}
	if (entry.id === currentLeafId) {
		return false;
	}
	const msg = entry.message as { stopReason?: string; content?: unknown };
	const hasText = hasTreeTextContent(msg.content);
	const isErrorOrAborted = msg.stopReason && msg.stopReason !== "stop" && msg.stopReason !== "toolUse";
	return !hasText && !isErrorOrAborted;
}

export function collectFoldDescendantSkipIds(
	flatNodes: TreeFlatNode[],
	foldedNodes: Set<string>,
): Set<string> {
	const skipSet = new Set<string>();
	for (const flatNode of flatNodes) {
		const { id, parentId } = flatNode.node.entry;
		if (parentId != null && (foldedNodes.has(parentId) || skipSet.has(parentId))) {
			skipSet.add(id);
		}
	}
	return skipSet;
}

export function buildContainsActiveMap(
	roots: SessionTreeNode[],
	currentLeafId: string | null,
): Map<SessionTreeNode, boolean> {
	const containsActive = new Map<SessionTreeNode, boolean>();
	const leafId = currentLeafId;
	const allNodes: SessionTreeNode[] = [];
	const preOrderStack: SessionTreeNode[] = [...roots];
	while (preOrderStack.length > 0) {
		const node = preOrderStack.pop()!;
		allNodes.push(node);
		for (let i = node.children.length - 1; i >= 0; i--) {
			preOrderStack.push(node.children[i]);
		}
	}
	for (let i = allNodes.length - 1; i >= 0; i--) {
		const node = allNodes[i];
		let has = leafId !== null && node.entry.id === leafId;
		for (const child of node.children) {
			if (containsActive.get(child)) {
				has = true;
			}
		}
		containsActive.set(node, has);
	}
	return containsActive;
}

export function computeChildIndent(
	indent: number,
	multipleChildren: boolean,
	justBranched: boolean,
): number {
	if (multipleChildren) {
		return indent + 1;
	}
	if (justBranched && indent > 0) {
		return indent + 1;
	}
	return indent;
}

export function buildChildGutters(
	gutters: GutterInfo[],
	showConnector: boolean,
	isVirtualRootChild: boolean,
	isLast: boolean,
	multipleRoots: boolean,
	indent: number,
): GutterInfo[] {
	const connectorDisplayed = showConnector && !isVirtualRootChild;
	if (!connectorDisplayed) {
		return gutters;
	}
	const currentDisplayIndent = multipleRoots ? Math.max(0, indent - 1) : indent;
	const connectorPosition = Math.max(0, currentDisplayIndent - 1);
	return [...gutters, { position: connectorPosition, show: !isLast }];
}

export function extractAssistantToolCalls(
	entry: SessionEntry,
	onToolCall: (id: string, info: ToolCallInfo) => void,
): void {
	if (entry.type !== "message" || entry.message.role !== "assistant") {
		return;
	}
	const content = (entry.message as { content?: unknown }).content;
	if (!Array.isArray(content)) {
		return;
	}
	for (const block of content) {
		if (typeof block === "object" && block !== null && "type" in block && block.type === "toolCall") {
			const tc = block as { id: string; name: string; arguments: Record<string, unknown> };
			onToolCall(tc.id, { name: tc.name, arguments: tc.arguments });
		}
	}
}

export function formatTreeLabelTimestamp(timestamp: string): string {
	const date = new Date(timestamp);
	const now = new Date();
	const hours = date.getHours().toString().padStart(2, "0");
	const minutes = date.getMinutes().toString().padStart(2, "0");
	const time = `${hours}:${minutes}`;

	if (
		date.getFullYear() === now.getFullYear() &&
		date.getMonth() === now.getMonth() &&
		date.getDate() === now.getDate()
	) {
		return time;
	}

	const month = date.getMonth() + 1;
	const day = date.getDate();
	if (date.getFullYear() === now.getFullYear()) {
		return `${month}/${day} ${time}`;
	}

	const year = date.getFullYear().toString().slice(-2);
	return `${year}/${month}/${day} ${time}`;
}

export function buildTreeLinePrefixChars(
	displayIndent: number,
	gutters: GutterInfo[],
	connector: string,
	connectorPosition: number,
	isLast: boolean,
	isFolded: boolean,
	foldable: boolean,
): string {
	const totalChars = displayIndent * 3;
	const prefixChars: string[] = [];
	for (let i = 0; i < totalChars; i++) {
		const level = Math.floor(i / 3);
		const posInLevel = i % 3;
		const gutter = gutters.find((g) => g.position === level);
		if (gutter) {
			if (posInLevel === 0) {
				prefixChars.push(gutter.show ? "│" : " ");
			} else {
				prefixChars.push(" ");
			}
		} else if (connector && level === connectorPosition) {
			if (posInLevel === 0) {
				prefixChars.push(isLast ? "└" : "├");
			} else if (posInLevel === 1) {
				prefixChars.push(isFolded ? "⊞" : foldable ? "⊟" : "─");
			} else {
				prefixChars.push(" ");
			}
		} else {
			prefixChars.push(" ");
		}
	}
	return prefixChars.join("");
}

export function getTreeSearchableText(node: SessionTreeNode): string {
	const entry = node.entry;
	const parts: string[] = [];

	if (node.label) {
		parts.push(node.label);
	}

	switch (entry.type) {
		case "message": {
			const msg = entry.message;
			parts.push(msg.role);
			if ("content" in msg && msg.content) {
				parts.push(extractTreeContent(msg.content));
			}
			if (msg.role === "bashExecution") {
				const bashMsg = msg as { command?: string };
				if (bashMsg.command) parts.push(bashMsg.command);
			}
			break;
		}
		case "custom_message": {
			parts.push(entry.customType);
			if (typeof entry.content === "string") {
				parts.push(entry.content);
			} else {
				parts.push(extractTreeContent(entry.content));
			}
			break;
		}
		case "compaction":
			parts.push("compaction");
			break;
		case "branch_summary":
			parts.push("branch summary", entry.summary);
			break;
		case "session_info":
			parts.push("title");
			if (entry.name) parts.push(entry.name);
			break;
		case "model_change":
			parts.push("model", entry.modelId);
			break;
		case "thinking_level_change":
			parts.push("thinking", entry.thinkingLevel);
			break;
		case "custom":
			parts.push("custom", entry.customType);
			break;
		case "label":
			parts.push("label", entry.label ?? "");
			break;
	}

	return parts.join(" ");
}
