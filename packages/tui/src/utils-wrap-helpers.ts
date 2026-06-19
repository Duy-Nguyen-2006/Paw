/**
 * Word-wrap helpers extracted from utils.ts (S3776).
 */

import { extractAnsiCode } from "./utils-ansi.ts";
import { visibleWidth } from "./utils.ts";

export type WrapAnsiTracker = {
	getLineEndReset(): string;
	getActiveCodes(): string;
	process(code: string): void;
};

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export type WrapLineState = {
	currentLine: string;
	currentVisibleLength: number;
};

export function flushWrapLineWithReset(
	state: WrapLineState,
	tracker: WrapAnsiTracker,
	wrapped: string[],
): void {
	if (!state.currentLine) {
		return;
	}
	const lineEndReset = tracker.getLineEndReset();
	if (lineEndReset) {
		state.currentLine += lineEndReset;
	}
	wrapped.push(state.currentLine);
	state.currentLine = "";
	state.currentVisibleLength = 0;
}

export function appendLongTokenToWrap(
	token: string,
	width: number,
	tracker: WrapAnsiTracker,
	wrapped: string[],
	state: WrapLineState,
	breakLongWord: (word: string, width: number, tracker: WrapAnsiTracker) => string[],
): void {
	flushWrapLineWithReset(state, tracker, wrapped);
	const broken = breakLongWord(token, width, tracker);
	for (let i = 0; i < broken.length - 1; i++) {
		wrapped.push(broken[i]!);
	}
	state.currentLine = broken[broken.length - 1] ?? "";
	state.currentVisibleLength = visibleWidth(state.currentLine);
}

export function applyWrapTokenOverflow(
	token: string,
	tokenVisibleLength: number,
	isWhitespace: boolean,
	width: number,
	tracker: WrapAnsiTracker,
	wrapped: string[],
	state: WrapLineState,
): void {
	let lineToWrap = state.currentLine.trimEnd();
	const lineEndReset = tracker.getLineEndReset();
	if (lineEndReset) {
		lineToWrap += lineEndReset;
	}
	wrapped.push(lineToWrap);
	if (isWhitespace) {
		state.currentLine = tracker.getActiveCodes();
		state.currentVisibleLength = 0;
	} else {
		state.currentLine = tracker.getActiveCodes() + token;
		state.currentVisibleLength = tokenVisibleLength;
	}
}

export function collectWordBreakSegments(word: string): Array<{ type: "ansi" | "grapheme"; value: string }> {
	const segments: Array<{ type: "ansi" | "grapheme"; value: string }> = [];
	let i = 0;
	while (i < word.length) {
		const ansiResult = extractAnsiCode(word, i);
		if (ansiResult) {
			segments.push({ type: "ansi", value: ansiResult.code });
			i += ansiResult.length;
		} else {
			let end = i;
			while (end < word.length) {
				const nextAnsi = extractAnsiCode(word, end);
				if (nextAnsi) break;
				end++;
			}
			const textPortion = word.slice(i, end);
			for (const seg of graphemeSegmenter.segment(textPortion)) {
				segments.push({ type: "grapheme", value: seg.segment });
			}
			i = end;
		}
	}
	return segments;
}
