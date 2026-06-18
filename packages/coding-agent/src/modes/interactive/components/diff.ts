
import * as Diff from "diff";
import { theme } from "../theme/theme.ts";

/**
 * Parse diff line to extract prefix, line number, and content.
 * Format: "+123 content" or "-123 content" or " 123 content" or "     ..."
 */
function parseDiffLine(line: string): { prefix: string; lineNum: string; content: string } | null {
	const match = line.match(/^([+-\s])(\s*\d*)\s(.*)$/);
	if (!match) return null;
	return { prefix: match[1], lineNum: match[2], content: match[3] };
}

/**
 * Replace tabs with spaces for consistent rendering.
 */
function replaceTabs(text: string): string {
	return text.replace(/\t/g, "   ");
}

/**
 * Compute word-level diff and render with inverse on changed parts.
 * Uses diffWords which groups whitespace with adjacent words for cleaner highlighting.
 * Strips leading whitespace from inverse to avoid highlighting indentation.
 */
function renderIntraLineDiff(oldContent: string, newContent: string): { removedLine: string; addedLine: string } {
	const wordDiff = Diff.diffWords(oldContent, newContent);

	let removedLine = "";
	let addedLine = "";
	let isFirstRemoved = true;
	let isFirstAdded = true;

	for (const part of wordDiff) {
		if (part.removed) {
			let value = part.value;
			// Strip leading whitespace from the first removed part
			if (isFirstRemoved) {
				const leadingWs = value.match(/^(\s*)/)?.[1] || "";
				value = value.slice(leadingWs.length);
				removedLine += leadingWs;
				isFirstRemoved = false;
			}
			if (value) {
				removedLine += theme.inverse(value);
			}
		} else if (part.added) {
			let value = part.value;
			// Strip leading whitespace from the first added part
			if (isFirstAdded) {
				const leadingWs = value.match(/^(\s*)/)?.[1] || "";
				value = value.slice(leadingWs.length);
				addedLine += leadingWs;
				isFirstAdded = false;
			}
			if (value) {
				addedLine += theme.inverse(value);
			}
		} else {
			removedLine += part.value;
			addedLine += part.value;
		}
	}

	return { removedLine, addedLine };
}

export interface RenderDiffOptions {
	/** File path (unused, kept for API compatibility) */
	filePath?: string;
}

interface DiffLine {
	lineNum: string;
	content: string;
}

/** Collect consecutive diff lines with the given prefix, advancing the index. */
function collectConsecutiveLines(
	lines: string[],
	startIndex: number,
	prefix: string,
): { collected: DiffLine[]; nextIndex: number } {
	const collected: DiffLine[] = [];
	let i = startIndex;
	while (i < lines.length) {
		const p = parseDiffLine(lines[i]);
		if (!p || p.prefix !== prefix) break;
		collected.push({ lineNum: p.lineNum, content: p.content });
		i++;
	}
	return { collected, nextIndex: i };
}

/** Render a single-line change pair with intra-line diff highlighting. */
function renderSingleLineChange(removed: DiffLine, added: DiffLine): string[] {
	const { removedLine, addedLine } = renderIntraLineDiff(replaceTabs(removed.content), replaceTabs(added.content));
	return [
		theme.fg("toolDiffRemoved", `-${removed.lineNum} ${removedLine}`),
		theme.fg("toolDiffAdded", `+${added.lineNum} ${addedLine}`),
	];
}

/** Render multi-line changes (removed then added). */
function renderMultiLineChange(removedLines: DiffLine[], addedLines: DiffLine[]): string[] {
	const result: string[] = [];
	for (const removed of removedLines) {
		result.push(theme.fg("toolDiffRemoved", `-${removed.lineNum} ${replaceTabs(removed.content)}`));
	}
	for (const added of addedLines) {
		result.push(theme.fg("toolDiffAdded", `+${added.lineNum} ${replaceTabs(added.content)}`));
	}
	return result;
}

/**
 * Render a diff string with colored lines and intra-line change highlighting.
 * - Context lines: dim/gray
 * - Removed lines: red, with inverse on changed tokens
 * - Added lines: green, with inverse on changed tokens
 */
export function renderDiff(diffText: string, _options: RenderDiffOptions = {}): string {
	const lines = diffText.split("\n");
	const result: string[] = [];

	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		const parsed = parseDiffLine(line);

		if (!parsed) {
			result.push(theme.fg("toolDiffContext", line));
			i++;
			continue;
		}

		if (parsed.prefix === "-") {
			const removed = collectConsecutiveLines(lines, i, "-");
			i = removed.nextIndex;
			const added = collectConsecutiveLines(lines, i, "+");
			i = added.nextIndex;

			if (removed.collected.length === 1 && added.collected.length === 1) {
				result.push(...renderSingleLineChange(removed.collected[0], added.collected[0]));
			} else {
				result.push(...renderMultiLineChange(removed.collected, added.collected));
			}
		} else if (parsed.prefix === "+") {
			result.push(theme.fg("toolDiffAdded", `+${parsed.lineNum} ${replaceTabs(parsed.content)}`));
			i++;
		} else {
			result.push(theme.fg("toolDiffContext", ` ${parsed.lineNum} ${replaceTabs(parsed.content)}`));
			i++;
		}
	}

	return result.join("\n");
}
