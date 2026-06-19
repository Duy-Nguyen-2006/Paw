import type { Tokens } from "marked";
import { visibleWidth, wrapTextWithAnsi } from "../utils.ts";
import type { InlineStyleContext } from "./markdown-render-helpers.ts";
import type { MarkdownOptions, MarkdownTheme } from "./markdown.ts";

export function getOrderedListMarker(item: Tokens.ListItem): string | undefined {
	const match = /^(?: {0,3})(\d{1,9}[.)])[ \t]+/.exec(item.raw);
	return match ? `${match[1]} ` : undefined;
}

export function getUnorderedListMarker(item: Tokens.ListItem): string | undefined {
	const match = /^(?: {0,3})([-+*])(?:[ \t]+|(?=\r?\n|$))/.exec(item.raw);
	return match ? `${match[1]} ` : undefined;
}

export function resolveListBullet(
	token: Tokens.List,
	item: Tokens.ListItem,
	index: number,
	startNumber: number,
	options: MarkdownOptions,
): string {
	const bullet = token.ordered
		? options.preserveOrderedListMarkers
			? (getOrderedListMarker(item) ?? `${startNumber + index}. `)
			: `${startNumber + index}. `
		: options.preserveOrderedListMarkers
			? (getUnorderedListMarker(item) ?? "- ")
			: "- ";
	const taskMarker = item.task ? `[${item.checked ? "x" : " "}] ` : "";
	return bullet + taskMarker;
}

export type RenderListFn = (
	token: Tokens.List,
	depth: number,
	width: number,
	styleContext?: InlineStyleContext,
) => string[];

export type RenderTokenForListFn = (
	token: import("marked").Token,
	itemWidth: number,
	nextTokenType: undefined,
	styleContext?: InlineStyleContext,
) => string[];

export function renderListItemLines(
	item: Tokens.ListItem,
	depth: number,
	width: number,
	styleContext: InlineStyleContext | undefined,
	marker: string,
	theme: MarkdownTheme,
	renderList: RenderListFn,
	renderToken: RenderTokenForListFn,
): string[] {
	const lines: string[] = [];
	const indent = "    ".repeat(depth);
	const firstPrefix = indent + theme.listBullet(marker);
	const continuationPrefix = indent + " ".repeat(visibleWidth(marker));
	const itemWidth = Math.max(1, width - visibleWidth(firstPrefix));
	let renderedAnyLine = false;

	for (const itemToken of item.tokens) {
		if (itemToken.type === "list") {
			lines.push(...renderList(itemToken as Tokens.List, depth + 1, width, styleContext));
			renderedAnyLine = true;
			continue;
		}

		const itemLines = renderToken(itemToken, itemWidth, undefined, styleContext);
		for (const line of itemLines) {
			for (const wrappedLine of wrapTextWithAnsi(line, itemWidth)) {
				const linePrefix = renderedAnyLine ? continuationPrefix : firstPrefix;
				lines.push(linePrefix + wrappedLine);
				renderedAnyLine = true;
			}
		}
	}

	if (!renderedAnyLine) {
		lines.push(firstPrefix);
	}
	return lines;
}
