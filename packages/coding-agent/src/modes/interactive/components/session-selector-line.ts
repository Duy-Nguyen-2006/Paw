/**
 * Session list line rendering (reduces SessionList.render complexity).
 */

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.ts";
import { formatSessionDate, shortenPath, type FlatSessionNode } from "./session-selector-tree.ts";

export function buildSessionTreePrefix(node: FlatSessionNode): string {
	if (node.depth === 0) {
		return "";
	}
	const parts = node.ancestorContinues.map((continues) => (continues ? "│  " : "   "));
	const branch = node.isLast ? "└─ " : "├─ ";
	return parts.join("") + branch;
}

export function renderSessionListLine(
	node: FlatSessionNode,
	width: number,
	options: {
		isSelected: boolean;
		isConfirmingDelete: boolean;
		isCurrent: boolean;
		showCwd: boolean;
		showPath: boolean;
	},
): string {
	const session = node.session;
	const prefix = buildSessionTreePrefix(node);
	const hasName = !!session.name;
	const displayText = session.name ?? session.firstMessage;
	const normalizedMessage = displayText.replace(/[\x00-\x1f\x7f]/g, " ").trim();

	const age = formatSessionDate(session.modified);
	const msgCount = String(session.messageCount);
	let rightPart = `${msgCount} ${age}`;
	if (options.showCwd && session.cwd) {
		rightPart = `${shortenPath(session.cwd)} ${rightPart}`;
	}
	if (options.showPath) {
		rightPart = `${shortenPath(session.path)} ${rightPart}`;
	}

	const cursor = options.isSelected ? theme.fg("accent", "› ") : "  ";
	const prefixWidth = visibleWidth(prefix);
	const rightWidth = visibleWidth(rightPart) + 2;
	const availableForMsg = width - 2 - prefixWidth - rightWidth;
	const truncatedMsg = truncateToWidth(normalizedMessage, Math.max(10, availableForMsg), "…");

	let messageColor: "error" | "warning" | "accent" | null = null;
	if (options.isConfirmingDelete) {
		messageColor = "error";
	} else if (options.isCurrent) {
		messageColor = "accent";
	} else if (hasName) {
		messageColor = "warning";
	}
	let styledMsg = messageColor ? theme.fg(messageColor, truncatedMsg) : truncatedMsg;
	if (options.isSelected) {
		styledMsg = theme.bold(styledMsg);
	}

	const leftPart = cursor + theme.fg("dim", prefix) + styledMsg;
	const leftWidth = visibleWidth(leftPart);
	const spacing = Math.max(1, width - leftWidth - visibleWidth(rightPart));
	const styledRight = theme.fg(options.isConfirmingDelete ? "error" : "dim", rightPart);

	let line = leftPart + " ".repeat(spacing) + styledRight;
	if (options.isSelected) {
		line = theme.bg("selectedBg", line);
	}
	return truncateToWidth(line, width);
}
