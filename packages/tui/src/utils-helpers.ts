/**
 * Truncate and wrap helpers extracted from utils.ts to reduce cognitive complexity (S3776).
 */

import { extractAnsiCode } from "./utils-ansi.ts";

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export type TruncateFragmentResult = { text: string; width: number };

export function isPrintableAscii(str: string): boolean {
	for (let i = 0; i < str.length; i++) {
		const code = str.codePointAt(i)!;
		if (code < 0x20 || code > 0x7e) {
			return false;
		}
	}
	return true;
}

export function truncateFragmentGraphemeOnly(text: string, maxWidth: number, graphemeWidth: (s: string) => number): TruncateFragmentResult {
	let result = "";
	let width = 0;
	for (const { segment } of graphemeSegmenter.segment(text)) {
		const w = graphemeWidth(segment);
		if (width + w > maxWidth) {
			break;
		}
		result += segment;
		width += w;
	}
	return { text: result, width };
}

export function truncateFragmentAnsiAndTabs(
	text: string,
	maxWidth: number,
	graphemeWidth: (s: string) => number,
): TruncateFragmentResult {
	let result = "";
	let width = 0;
	let i = 0;
	let pendingAnsi = "";

	while (i < text.length) {
		const ansi = extractAnsiCode(text, i);
		if (ansi) {
			pendingAnsi += ansi.code;
			i += ansi.length;
			continue;
		}

		if (text[i] === "\t") {
			if (width + 3 > maxWidth) {
				break;
			}
			if (pendingAnsi) {
				result += pendingAnsi;
				pendingAnsi = "";
			}
			result += "\t";
			width += 3;
			i++;
			continue;
		}

		let end = i;
		while (end < text.length && text[end] !== "\t") {
			const nextAnsi = extractAnsiCode(text, end);
			if (nextAnsi) {
				break;
			}
			end++;
		}

		for (const { segment } of graphemeSegmenter.segment(text.slice(i, end))) {
			const w = graphemeWidth(segment);
			if (width + w > maxWidth) {
				return { text: result, width };
			}
			if (pendingAnsi) {
				result += pendingAnsi;
				pendingAnsi = "";
			}
			result += segment;
			width += w;
		}
		i = end;
	}

	return { text: result, width };
}

export type TruncateAccumState = {
	result: string;
	pendingAnsi: string;
	visibleSoFar: number;
	keptWidth: number;
	keepContiguousPrefix: boolean;
	overflowed: boolean;
};

export function accumulateTruncateSegment(
	state: TruncateAccumState,
	segment: string,
	width: number,
	targetWidth: number,
	maxWidth: number,
): void {
	if (state.keepContiguousPrefix && state.keptWidth + width <= targetWidth) {
		if (state.pendingAnsi) {
			state.result += state.pendingAnsi;
			state.pendingAnsi = "";
		}
		state.result += segment;
		state.keptWidth += width;
	} else {
		state.keepContiguousPrefix = false;
		state.pendingAnsi = "";
	}
	state.visibleSoFar += width;
	if (state.visibleSoFar > maxWidth) {
		state.overflowed = true;
	}
}

export function truncateGraphemeSimple(
	text: string,
	targetWidth: number,
	maxWidth: number,
	graphemeWidth: (s: string) => number,
): { result: string; keptWidth: number; visibleSoFar: number; overflowed: boolean; exhausted: boolean } {
	let result = "";
	let keptWidth = 0;
	let visibleSoFar = 0;
	let keepContiguousPrefix = true;
	let overflowed = false;
	for (const { segment } of graphemeSegmenter.segment(text)) {
		const width = graphemeWidth(segment);
		if (keepContiguousPrefix && keptWidth + width <= targetWidth) {
			result += segment;
			keptWidth += width;
		} else {
			keepContiguousPrefix = false;
		}
		visibleSoFar += width;
		if (visibleSoFar > maxWidth) {
			overflowed = true;
			break;
		}
	}
	return { result, keptWidth, visibleSoFar, overflowed, exhausted: !overflowed };
}

export function finalizeTruncatedResult(
	prefix: string,
	prefixWidth: number,
	ellipsis: string,
	ellipsisWidth: number,
	maxWidth: number,
	pad: boolean,
): string {
	const reset = "\x1b[0m";
	const visibleWidthResult = prefixWidth + ellipsisWidth;
	let result: string;

	if (ellipsis.length > 0) {
		result = `${prefix}${reset}${ellipsis}${reset}`;
	} else {
		result = `${prefix}${reset}`;
	}

	return pad ? result + " ".repeat(Math.max(0, maxWidth - visibleWidthResult)) : result;
}

export function truncateWhenEllipsisTooWide(
	textWidth: number,
	text: string,
	maxWidth: number,
	ellipsisFragment: TruncateFragmentResult,
	pad: boolean,
): string {
	if (textWidth <= maxWidth) {
		return pad ? text + " ".repeat(maxWidth - textWidth) : text;
	}
	if (ellipsisFragment.width === 0) {
		return pad ? " ".repeat(maxWidth) : "";
	}
	return finalizeTruncatedResult("", 0, ellipsisFragment.text, ellipsisFragment.width, maxWidth, pad);
}
