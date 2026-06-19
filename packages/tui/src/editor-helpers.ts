/**
 * Editor helpers extracted from editor.ts to reduce cognitive complexity (S3776).
 */

import { cjkBreakRegex, isWhitespaceChar, visibleWidth } from "./utils.ts";

/** Regex matching paste markers like `[paste #1 +123 lines]` or `[paste #2 1234 chars]`. */
export const PASTE_MARKER_REGEX = /\[paste #(\d+)( (\+\d+ lines|\d+ chars))?\]/g;

export function isPasteMarker(segment: string): boolean {
	const PASTE_MARKER_SINGLE = /^\[paste #(\d+)( (\+\d+ lines|\d+ chars))?\]$/;
	return segment.length >= 10 && PASTE_MARKER_SINGLE.test(segment);
}

export function collectValidPasteMarkers(text: string, validIds: Set<number>): Array<{ start: number; end: number }> {
	const markers: Array<{ start: number; end: number }> = [];
	for (const m of text.matchAll(PASTE_MARKER_REGEX)) {
		const id = Number.parseInt(m[1]!, 10);
		if (!validIds.has(id)) continue;
		markers.push({ start: m.index, end: m.index + m[0].length });
	}
	return markers;
}

export function mergeSegmentWithMarker(
	seg: Intl.SegmentData,
	marker: { start: number; end: number } | null,
	text: string,
): Intl.SegmentData | null {
	if (!marker || seg.index < marker.start || seg.index >= marker.end) {
		return seg;
	}
	if (seg.index === marker.start) {
		const markerText = text.slice(marker.start, marker.end);
		return {
			segment: markerText,
			index: marker.start,
			input: text,
		};
	}
	return null;
}

export interface WordWrapOverflowContext {
	line: string;
	chunkStart: number;
	charIndex: number;
	currentWidth: number;
	wrapOppIndex: number;
	wrapOppWidth: number;
	maxWidth: number;
}

export interface WordWrapOverflowResult {
	chunkStart: number;
	currentWidth: number;
	wrapOppIndex: number;
	newChunk?: { text: string; startIndex: number; endIndex: number };
}

export function resolveWordWrapOverflow(
	ctx: WordWrapOverflowContext,
	graphemeWidth: number,
): WordWrapOverflowResult {
	const { line, chunkStart, charIndex, currentWidth, wrapOppIndex, wrapOppWidth, maxWidth } = ctx;
	if (wrapOppIndex >= 0 && currentWidth - wrapOppWidth + graphemeWidth <= maxWidth) {
		return {
			chunkStart: wrapOppIndex,
			currentWidth: currentWidth - wrapOppWidth,
			wrapOppIndex: -1,
			newChunk: { text: line.slice(chunkStart, wrapOppIndex), startIndex: chunkStart, endIndex: wrapOppIndex },
		};
	}
	if (chunkStart < charIndex) {
		return {
			chunkStart: charIndex,
			currentWidth: 0,
			wrapOppIndex: -1,
			newChunk: { text: line.slice(chunkStart, charIndex), startIndex: chunkStart, endIndex: charIndex },
		};
	}
	return { chunkStart, currentWidth, wrapOppIndex: -1 };
}

export function recordWordWrapOpportunity(
	grapheme: string,
	isWs: boolean,
	next: Intl.SegmentData | undefined,
	currentWidth: number,
): { wrapOppIndex: number; wrapOppWidth: number } | null {
	if (!next) return null;
	if (isWs && (isPasteMarker(next.segment) || !isWhitespaceChar(next.segment))) {
		return { wrapOppIndex: next.index, wrapOppWidth: currentWidth };
	}
	if (!isWs && !isWhitespaceChar(next.segment)) {
		const isCjk = !isPasteMarker(grapheme) && cjkBreakRegex.test(grapheme);
		const nextIsCjk = !isPasteMarker(next.segment) && cjkBreakRegex.test(next.segment);
		if (isCjk || nextIsCjk) {
			return { wrapOppIndex: next.index, wrapOppWidth: currentWidth };
		}
	}
	return null;
}

export function isNewLineInput(data: string, kb: { matches: (d: string, keybinding: string) => boolean }): boolean {
	return (
		kb.matches(data, "tui.input.newLine") ||
		(data.codePointAt(0)! === 10 && data.length > 1) ||
		data === "\x1b\r" ||
		data === "\x1b[13;2~" ||
		(data.length > 1 && data.includes("\x1b") && data.includes("\r")) ||
		(data === "\n" && data.length === 1)
	);
}

export interface EditorCursorChunkParams {
	cursorPos: number;
	chunk: { startIndex: number; endIndex: number; text: string };
	isLastChunk: boolean;
}

export function resolveCursorInChunk(params: EditorCursorChunkParams): { hasCursor: boolean; adjustedPos: number } {
	const { cursorPos, chunk, isLastChunk } = params;
	if (isLastChunk) {
		if (cursorPos >= chunk.startIndex) {
			return { hasCursor: true, adjustedPos: cursorPos - chunk.startIndex };
		}
		return { hasCursor: false, adjustedPos: 0 };
	}
	if (cursorPos >= chunk.startIndex && cursorPos < chunk.endIndex) {
		let adjustedPos = cursorPos - chunk.startIndex;
		if (adjustedPos > chunk.text.length) {
			adjustedPos = chunk.text.length;
		}
		return { hasCursor: true, adjustedPos };
	}
	return { hasCursor: false, adjustedPos: 0 };
}

export interface RenderCursorLineParams {
	text: string;
	cursorPos: number | undefined;
	emitCursorMarker: boolean;
	cursorMarker: string;
	contentWidth: number;
	paddingX: number;
	segment: (text: string, mode: "grapheme") => Iterable<Intl.SegmentData>;
}

export function buildDisplayLineWithCursor(params: RenderCursorLineParams): {
	displayText: string;
	lineVisibleWidth: number;
	cursorInPadding: boolean;
} {
	const { text, cursorPos, emitCursorMarker, contentWidth, paddingX, segment } = params;
	let displayText = text;
	let lineVisibleWidth = visibleWidth(text);
	let cursorInPadding = false;

	if (cursorPos === undefined) {
		return { displayText, lineVisibleWidth, cursorInPadding };
	}

	const before = displayText.slice(0, cursorPos);
	const after = displayText.slice(cursorPos);
	const marker = emitCursorMarker ? params.cursorMarker : "";

	if (after.length > 0) {
		const afterGraphemes = [...segment(after, "grapheme")];
		const firstGrapheme = afterGraphemes[0]?.segment || "";
		const restAfter = after.slice(firstGrapheme.length);
		const cursor = `\x1b[7m${firstGrapheme}\x1b[0m`;
		displayText = before + marker + cursor + restAfter;
	} else {
		const cursor = "\x1b[7m \x1b[0m";
		displayText = before + marker + cursor;
		lineVisibleWidth = lineVisibleWidth + 1;
		if (lineVisibleWidth > contentWidth && paddingX > 0) {
			cursorInPadding = true;
		}
	}

	return { displayText, lineVisibleWidth, cursorInPadding };
}
