import { Marked, type Token, Tokenizer, type Tokens } from "marked";
import type { Component } from "../tui.ts";
import { wrapTextWithAnsi } from "../utils.ts";
import { renderSingleInlineToken, stripTrailingStylePrefixes } from "./markdown-inline-helpers.ts";
import {
	renderListItemLines,
	resolveListBullet,
	type RenderListFn,
} from "./markdown-list-helpers.ts";
import {
	applyHorizontalPaddingAndBackground,
	buildVerticalPaddingLines,
	wrapRenderedContentLines,
} from "./markdown-render-output-helpers.ts";
import { appendRenderedLink, type InlineStyleContext, resolveTableColumnWidths } from "./markdown-render-helpers.ts";
import {
	applyDefaultTextStyle,
	computeDefaultStylePrefix,
	getStylePrefixFromFn,
} from "./markdown-style-helpers.ts";
import {
	computeTableNaturalAndMinWidths,
	renderTableDataRows,
	renderTableHeaderRows,
	wrapCellText,
} from "./markdown-table-helpers.ts";
import { renderBlockToken } from "./markdown-token-helpers.ts";

const STRICT_STRIKETHROUGH_REGEX = /^(~~)(?=[^\s~])((?:\\.|[^\\])*?(?:\\.|[^\s~\\]))\1(?=[^~]|$)/;

class StrictStrikethroughTokenizer extends Tokenizer {
	override del(src: string): Tokens.Del | undefined {
		const match = STRICT_STRIKETHROUGH_REGEX.exec(src);
		if (!match) {
			return undefined;
		}

		const text = match[2];
		return {
			type: "del",
			raw: match[0],
			text,
			tokens: this.lexer.inlineTokens(text),
		};
	}
}

const markdownParser = new Marked();
markdownParser.setOptions({
	tokenizer: new StrictStrikethroughTokenizer(),
});

/**
 * Default text styling for markdown content.
 * Applied to all text unless overridden by markdown formatting.
 */
export interface DefaultTextStyle {
	/** Foreground color function */
	color?: (text: string) => string;
	/** Background color function */
	bgColor?: (text: string) => string;
	/** Bold text */
	bold?: boolean;
	/** Italic text */
	italic?: boolean;
	/** Strikethrough text */
	strikethrough?: boolean;
	/** Underline text */
	underline?: boolean;
}

/**
 * Theme functions for markdown elements.
 * Each function takes text and returns styled text with ANSI codes.
 */
export interface MarkdownTheme {
	heading: (text: string) => string;
	link: (text: string) => string;
	linkUrl: (text: string) => string;
	code: (text: string) => string;
	codeBlock: (text: string) => string;
	codeBlockBorder: (text: string) => string;
	quote: (text: string) => string;
	quoteBorder: (text: string) => string;
	hr: (text: string) => string;
	listBullet: (text: string) => string;
	bold: (text: string) => string;
	italic: (text: string) => string;
	strikethrough: (text: string) => string;
	underline: (text: string) => string;
	highlightCode?: (code: string, lang?: string) => string[];
	/** Prefix applied to each rendered code block line (default: "  ") */
	codeBlockIndent?: string;
}

export interface MarkdownOptions {
	/** Preserve source list markers instead of normalizing them. */
	preserveOrderedListMarkers?: boolean;
}

export class Markdown implements Component {
	private text: string;
	private paddingX: number; // Left/right padding
	private paddingY: number; // Top/bottom padding
	private defaultTextStyle?: DefaultTextStyle;
	private theme: MarkdownTheme;
	private options: MarkdownOptions;
	private defaultStylePrefix?: string;

	// Cache for rendered output
	private cachedText?: string;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(
		text: string,
		paddingX: number,
		paddingY: number,
		theme: MarkdownTheme,
		defaultTextStyle?: DefaultTextStyle,
		options?: MarkdownOptions,
	) {
		this.text = text;
		this.paddingX = paddingX;
		this.paddingY = paddingY;
		this.theme = theme;
		this.defaultTextStyle = defaultTextStyle;
		this.options = options ? { ...options } : {};
	}

	setText(text: string): void {
		this.text = text;
		this.invalidate();
	}

	invalidate(): void {
		this.cachedText = undefined;
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	render(width: number): string[] {
		// Check cache
		if (this.cachedLines && this.cachedText === this.text && this.cachedWidth === width) {
			return this.cachedLines;
		}

		// Calculate available width for content (subtract horizontal padding)
		const contentWidth = Math.max(1, width - this.paddingX * 2);

		// Don't render anything if there's no actual text
		if (!this.text || this.text.trim() === "") {
			const result: string[] = [];
			// Update cache
			this.cachedText = this.text;
			this.cachedWidth = width;
			this.cachedLines = result;
			return result;
		}

		// Replace tabs with 3 spaces for consistent rendering
		const normalizedText = this.text.replace(/\t/g, "   ");

		// Parse markdown to HTML-like tokens
		const tokens = markdownParser.lexer(normalizedText);

		// Convert tokens to styled terminal output
		const renderedLines: string[] = [];

		for (let i = 0; i < tokens.length; i++) {
			const token = tokens[i];
			const nextToken = tokens[i + 1];
			const tokenLines = this.renderToken(token, contentWidth, nextToken?.type);
			for (const tokenLine of tokenLines) {
				renderedLines.push(tokenLine);
			}
		}

		const wrappedLines = wrapRenderedContentLines(renderedLines, contentWidth);
		const contentLines = applyHorizontalPaddingAndBackground(
			wrappedLines,
			width,
			this.paddingX,
			this.defaultTextStyle,
		);
		const emptyLines = buildVerticalPaddingLines(width, this.paddingY, this.defaultTextStyle);
		const result = emptyLines.concat(contentLines, emptyLines);

		// Update cache
		this.cachedText = this.text;
		this.cachedWidth = width;
		this.cachedLines = result;

		return result.length > 0 ? result : [""];
	}

	/**
	 * Apply default text style to a string.
	 * This is the base styling applied to all text content.
	 * NOTE: Background color is NOT applied here - it's applied at the padding stage
	 * to ensure it extends to the full line width.
	 */
	private applyDefaultStyle(text: string): string {
		return applyDefaultTextStyle(text, this.defaultTextStyle, this.theme);
	}

	private getDefaultStylePrefix(): string {
		const { prefix, cache } = computeDefaultStylePrefix(this.defaultTextStyle, this.theme, this.defaultStylePrefix);
		this.defaultStylePrefix = cache;
		return prefix;
	}

	private getStylePrefix(styleFn: (text: string) => string): string {
		return getStylePrefixFromFn(styleFn);
	}

	private getDefaultInlineStyleContext(): InlineStyleContext {
		return {
			applyText: (text: string) => this.applyDefaultStyle(text),
			stylePrefix: this.getDefaultStylePrefix(),
		};
	}

	private renderToken(
		token: Token,
		width: number,
		nextTokenType?: string,
		styleContext?: InlineStyleContext,
	): string[] {
		if (token.type === "list") {
			return this.renderList(token as Tokens.List, 0, width, styleContext);
		}
		if (token.type === "table") {
			return this.renderTable(token as Tokens.Table, width, nextTokenType, styleContext);
		}
		return renderBlockToken(
			token,
			width,
			nextTokenType,
			styleContext,
			this.theme,
			(styleFn) => this.getStylePrefix(styleFn),
			(t, w, next, ctx) => this.renderToken(t, w, next, ctx),
			(tokens, ctx) => this.renderInlineTokens(tokens, ctx),
			(text) => this.applyDefaultStyle(text),
		);
	}

	private renderInlineTokens(tokens: Token[], styleContext?: InlineStyleContext): string {
		const resolvedStyleContext = styleContext ?? this.getDefaultInlineStyleContext();
		const { stylePrefix } = resolvedStyleContext;
		let result = "";
		for (const token of tokens) {
			if (token.type === "link") {
				const linkText = this.renderInlineTokens(token.tokens || [], resolvedStyleContext);
				const styledLink = this.theme.link(this.theme.underline(linkText));
				result = appendRenderedLink(result, token as Tokens.Link, styledLink, this.theme, stylePrefix);
				continue;
			}
			result += renderSingleInlineToken(token, resolvedStyleContext, this.theme, (t, ctx) =>
				this.renderInlineTokens(t, ctx),
			);
		}
		return stripTrailingStylePrefixes(result, stylePrefix);
	}

	/**
	 * Render a list with proper nesting support
	 */
	private renderList: RenderListFn = (token, depth, width, styleContext) => {
		const lines: string[] = [];
		const startNumber = typeof token.start === "number" ? token.start : 1;

		for (let i = 0; i < token.items.length; i++) {
			const item = token.items[i];
			const isLastItem = i === token.items.length - 1;
			const marker = resolveListBullet(token, item, i, startNumber, this.options);
			lines.push(
				...renderListItemLines(
					item,
					depth,
					width,
					styleContext,
					marker,
					this.theme,
					this.renderList,
					(t, itemWidth, _next, ctx) => this.renderToken(t, itemWidth, undefined, ctx),
				),
			);
			if (token.loose && !isLastItem) {
				lines.push("");
			}
		}

		return lines;
	};

	/**
	 * Render a table with width-aware cell wrapping.
	 * Cells that don't fit are wrapped to multiple lines.
	 */
	private renderTable(
		token: Tokens.Table,
		availableWidth: number,
		nextTokenType?: string,
		styleContext?: InlineStyleContext,
	): string[] {
		const numCols = token.header.length;
		if (numCols === 0) {
			return [];
		}

		const borderOverhead = 3 * numCols + 1;
		const availableForCells = availableWidth - borderOverhead;
		if (availableForCells < numCols) {
			const fallbackLines = token.raw ? wrapTextWithAnsi(token.raw, availableWidth) : [];
			if (nextTokenType && nextTokenType !== "space") {
				fallbackLines.push("");
			}
			return fallbackLines;
		}

		const maxUnbrokenWordWidth = 30;
		const { naturalWidths, minWordWidths } = computeTableNaturalAndMinWidths(
			token,
			(tokens, ctx) => this.renderInlineTokens(tokens, ctx),
			styleContext,
			maxUnbrokenWordWidth,
		);

		const columnWidths = resolveTableColumnWidths(
			naturalWidths,
			minWordWidths,
			availableForCells,
			availableWidth,
			borderOverhead,
			numCols,
		);

		const lines: string[] = [];
		const topBorderCells = columnWidths.map((w) => "─".repeat(w));
		lines.push(`┌─${topBorderCells.join("─┬─")}─┐`);

		const headerCellLines: string[][] = token.header.map((cell, i) => {
			const text = this.renderInlineTokens(cell.tokens || [], styleContext);
			return wrapCellText(text, columnWidths[i]);
		});
		lines.push(...renderTableHeaderRows(headerCellLines, columnWidths, this.theme.bold));

		const separatorCells = columnWidths.map((w) => "─".repeat(w));
		const separatorLine = `├─${separatorCells.join("─┼─")}─┤`;
		lines.push(separatorLine);

		lines.push(
			...renderTableDataRows(
				token.rows,
				columnWidths,
				(tokens, ctx) => this.renderInlineTokens(tokens, ctx),
				styleContext,
				wrapCellText,
				separatorLine,
			),
		);

		const bottomBorderCells = columnWidths.map((w) => "─".repeat(w));
		lines.push(`└─${bottomBorderCells.join("─┴─")}─┘`);

		if (nextTokenType && nextTokenType !== "space") {
			lines.push("");
		}
		return lines;
	}
}
