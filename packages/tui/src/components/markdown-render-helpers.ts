import type { Token, Tokens } from "marked";
import { getCapabilities, hyperlink } from "../terminal-image.ts";
import { wrapTextWithAnsi } from "../utils.ts";
import type { MarkdownTheme } from "./markdown.ts";

export interface InlineStyleContext {
	applyText: (text: string) => string;
	stylePrefix: string;
}

export function shouldAddBlockSpacing(nextTokenType: string | undefined, skipTypes: string[]): boolean {
	return Boolean(nextTokenType && !skipTypes.includes(nextTokenType));
}

export function appendSpacingAfterBlock(lines: string[], nextTokenType: string | undefined): void {
	if (shouldAddBlockSpacing(nextTokenType, ["space"])) {
		lines.push("");
	}
}

export function buildHeadingStyleFn(headingLevel: number, theme: MarkdownTheme): (text: string) => string {
	if (headingLevel === 1) {
		return (text: string) => theme.heading(theme.bold(theme.underline(text)));
	}
	return (text: string) => theme.heading(theme.bold(text));
}

export function renderCodeBlockLines(token: Tokens.Code, theme: MarkdownTheme): string[] {
	const indent = theme.codeBlockIndent ?? "  ";
	const lines: string[] = [];
	lines.push(theme.codeBlockBorder(`\`\`\`${token.lang || ""}`));
	if (theme.highlightCode) {
		for (const hlLine of theme.highlightCode(token.text, token.lang)) {
			lines.push(`${indent}${hlLine}`);
		}
	} else {
		for (const codeLine of token.text.split("\n")) {
			lines.push(`${indent}${theme.codeBlock(codeLine)}`);
		}
	}
	lines.push(theme.codeBlockBorder("```"));
	return lines;
}

export function applyQuoteStyleToLine(
	line: string,
	quoteStyle: (text: string) => string,
	quoteStylePrefix: string,
): string {
	if (!quoteStylePrefix) {
		return quoteStyle(line);
	}
	const lineWithReappliedStyle = line.replace(/\x1b\[0m/g, `\x1b[0m${quoteStylePrefix}`);
	return quoteStyle(lineWithReappliedStyle);
}

export type RenderTokenFn = (
	token: Token,
	width: number,
	nextTokenType?: string,
	styleContext?: InlineStyleContext,
) => string[];

export function renderBlockquoteLines(
	token: Tokens.Blockquote,
	width: number,
	nextTokenType: string | undefined,
	theme: MarkdownTheme,
	getStylePrefix: (styleFn: (text: string) => string) => string,
	renderToken: RenderTokenFn,
): string[] {
	const quoteStyle = (text: string) => theme.quote(theme.italic(text));
	const quoteStylePrefix = getStylePrefix(quoteStyle);
	const quoteContentWidth = Math.max(1, width - 2);
	const quoteInlineStyleContext: InlineStyleContext = {
		applyText: (text: string) => text,
		stylePrefix: quoteStylePrefix,
	};
	const quoteTokens = token.tokens || [];
	const renderedQuoteLines: string[] = [];
	for (let i = 0; i < quoteTokens.length; i++) {
		const quoteToken = quoteTokens[i];
		const nextQuoteToken = quoteTokens[i + 1];
		renderedQuoteLines.push(
			...renderToken(quoteToken, quoteContentWidth, nextQuoteToken?.type, quoteInlineStyleContext),
		);
	}
	while (renderedQuoteLines.length > 0 && renderedQuoteLines.at(-1) === "") {
		renderedQuoteLines.pop();
	}
	const lines: string[] = [];
	for (const quoteLine of renderedQuoteLines) {
		const styledLine = applyQuoteStyleToLine(quoteLine, quoteStyle, quoteStylePrefix);
		for (const wrappedLine of wrapTextWithAnsi(styledLine, quoteContentWidth)) {
			lines.push(theme.quoteBorder("│ ") + wrappedLine);
		}
	}
	appendSpacingAfterBlock(lines, nextTokenType);
	return lines;
}

export function computeMinColumnWidthsWhenTight(
	minWordWidths: number[],
	availableForCells: number,
	numCols: number,
): number[] {
	const minColumnWidths = new Array<number>(numCols).fill(1);
	const remaining = availableForCells - numCols;
	if (remaining <= 0) {
		return minColumnWidths;
	}
	const totalWeight = minWordWidths.reduce((total, width) => total + Math.max(0, width - 1), 0);
	const growth = minWordWidths.map((width) => {
		const weight = Math.max(0, width - 1);
		return totalWeight > 0 ? Math.floor((weight / totalWeight) * remaining) : 0;
	});
	for (let i = 0; i < numCols; i++) {
		minColumnWidths[i] += growth[i] ?? 0;
	}
	const allocated = growth.reduce((total, width) => total + width, 0);
	let leftover = remaining - allocated;
	for (let i = 0; leftover > 0 && i < numCols; i++) {
		minColumnWidths[i]++;
		leftover--;
	}
	return minColumnWidths;
}

export function computeShrunkColumnWidths(
	naturalWidths: number[],
	minColumnWidths: number[],
	availableForCells: number,
): number[] {
	const minCellsWidth = minColumnWidths.reduce((a, b) => a + b, 0);
	const numCols = naturalWidths.length;
	const totalGrowPotential = naturalWidths.reduce((total, width, index) => {
		return total + Math.max(0, width - minColumnWidths[index]);
	}, 0);
	const extraWidth = Math.max(0, availableForCells - minCellsWidth);
	const columnWidths = minColumnWidths.map((minWidth, index) => {
		const naturalWidth = naturalWidths[index];
		const minWidthDelta = Math.max(0, naturalWidth - minWidth);
		let grow = 0;
		if (totalGrowPotential > 0) {
			grow = Math.floor((minWidthDelta / totalGrowPotential) * extraWidth);
		}
		return minWidth + grow;
	});
	let remaining = availableForCells - columnWidths.reduce((a, b) => a + b, 0);
	while (remaining > 0) {
		let grew = false;
		for (let i = 0; i < numCols && remaining > 0; i++) {
			if (columnWidths[i] < naturalWidths[i]) {
				columnWidths[i]++;
				remaining--;
				grew = true;
			}
		}
		if (!grew) {
			break;
		}
	}
	return columnWidths;
}

export function resolveTableColumnWidths(
	naturalWidths: number[],
	minWordWidths: number[],
	availableForCells: number,
	availableWidth: number,
	borderOverhead: number,
	numCols: number,
): number[] {
	let minColumnWidths = minWordWidths;
	let minCellsWidth = minColumnWidths.reduce((a, b) => a + b, 0);
	if (minCellsWidth > availableForCells) {
		minColumnWidths = computeMinColumnWidthsWhenTight(minWordWidths, availableForCells, numCols);
		minCellsWidth = minColumnWidths.reduce((a, b) => a + b, 0);
	}
	const totalNaturalWidth = naturalWidths.reduce((a, b) => a + b, 0) + borderOverhead;
	if (totalNaturalWidth <= availableWidth) {
		return naturalWidths.map((width, index) => Math.max(width, minColumnWidths[index]));
	}
	return computeShrunkColumnWidths(naturalWidths, minColumnWidths, availableForCells);
}

export function appendRenderedLink(
	result: string,
	token: Tokens.Link,
	styledLink: string,
	theme: MarkdownTheme,
	stylePrefix: string,
): string {
	if (getCapabilities().hyperlinks) {
		return result + hyperlink(styledLink, token.href) + stylePrefix;
	}
	const hrefForComparison = token.href.startsWith("mailto:") ? token.href.slice(7) : token.href;
	if (token.text === token.href || token.text === hrefForComparison) {
		return result + styledLink + stylePrefix;
	}
	return result + styledLink + theme.linkUrl(` (${token.href})`) + stylePrefix;
}
