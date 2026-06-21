import type { Token, Tokens } from "marked";
import { visibleWidth, wrapTextWithAnsi } from "../utils.ts";
import type { InlineStyleContext } from "./markdown-render-helpers.ts";

export function getLongestWordWidth(text: string, maxWidth?: number): number {
	const words = text.split(/\s+/).filter((word) => word.length > 0);
	let longest = 0;
	for (const word of words) {
		longest = Math.max(longest, visibleWidth(word));
	}
	if (maxWidth === undefined) {
		return longest;
	}
	return Math.min(longest, maxWidth);
}

export function wrapCellText(text: string, maxWidth: number): string[] {
	return wrapTextWithAnsi(text, Math.max(1, maxWidth));
}

export function computeTableNaturalAndMinWidths(
	token: Tokens.Table,
	renderInlineTokens: (tokens: Token[], styleContext?: InlineStyleContext) => string,
	styleContext: InlineStyleContext | undefined,
	maxUnbrokenWordWidth: number,
): { naturalWidths: number[]; minWordWidths: number[] } {
	const numCols = token.header.length;
	const naturalWidths: number[] = [];
	const minWordWidths: number[] = [];
	for (let i = 0; i < numCols; i++) {
		const headerText = renderInlineTokens(token.header[i].tokens || [], styleContext);
		naturalWidths[i] = visibleWidth(headerText);
		minWordWidths[i] = Math.max(1, getLongestWordWidth(headerText, maxUnbrokenWordWidth));
	}
	for (const row of token.rows) {
		for (let i = 0; i < row.length; i++) {
			const cellText = renderInlineTokens(row[i].tokens || [], styleContext);
			naturalWidths[i] = Math.max(naturalWidths[i] || 0, visibleWidth(cellText));
			minWordWidths[i] = Math.max(minWordWidths[i] || 1, getLongestWordWidth(cellText, maxUnbrokenWordWidth));
		}
	}
	return { naturalWidths, minWordWidths };
}

export function renderTableHeaderRows(
	headerCellLines: string[][],
	columnWidths: number[],
	bold: (text: string) => string,
): string[] {
	const lines: string[] = [];
	const headerLineCount = Math.max(...headerCellLines.map((c) => c.length));
	for (let lineIdx = 0; lineIdx < headerLineCount; lineIdx++) {
		const rowParts = headerCellLines.map((cellLines, colIdx) => {
			const text = cellLines[lineIdx] || "";
			const padded = text + " ".repeat(Math.max(0, columnWidths[colIdx] - visibleWidth(text)));
			return bold(padded);
		});
		lines.push(`│ ${rowParts.join(" │ ")} │`);
	}
	return lines;
}

export function renderTableDataRows(
	rows: Tokens.TableCell[][],
	columnWidths: number[],
	renderInlineTokens: (tokens: Token[], styleContext?: InlineStyleContext) => string,
	styleContext: InlineStyleContext | undefined,
	wrapCell: (text: string, maxWidth: number) => string[],
	separatorLine: string,
): string[] {
	const lines: string[] = [];
	for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
		const row = rows[rowIndex];
		const rowCellLines: string[][] = row.map((cell, i) => {
			const text = renderInlineTokens(cell.tokens || [], styleContext);
			return wrapCell(text, columnWidths[i]);
		});
		const rowLineCount = Math.max(...rowCellLines.map((c) => c.length));

		for (let lineIdx = 0; lineIdx < rowLineCount; lineIdx++) {
			const rowParts = rowCellLines.map((cellLines, colIdx) => {
				const text = cellLines[lineIdx] || "";
				return text + " ".repeat(Math.max(0, columnWidths[colIdx] - visibleWidth(text)));
			});
			lines.push(`│ ${rowParts.join(" │ ")} │`);
		}

		if (rowIndex < rows.length - 1) {
			lines.push(separatorLine);
		}
	}
	return lines;
}
