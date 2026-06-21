import { eastAsianWidth } from "get-east-asian-width";
import { extractAnsiCode } from "./utils-ansi.ts";
import {
	accumulateTruncateSegment,
	finalizeTruncatedResult,
	isPrintableAscii,
	type TruncateAccumState,
	truncateFragmentAnsiAndTabs,
	truncateFragmentGraphemeOnly,
	truncateGraphemeSimple,
	truncateWhenEllipsisTooWide,
} from "./utils-helpers.ts";
import {
	appendLongTokenToWrap,
	applyWrapTokenOverflow,
	collectWordBreakSegments,
	type WrapLineState,
} from "./utils-wrap-helpers.ts";

export { extractAnsiCode } from "./utils-ansi.ts";

// segmenters (shared instance)
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const wordSegmenter = new Intl.Segmenter(undefined, { granularity: "word" });

/**
 * Get the shared grapheme segmenter instance.
 */
export function getGraphemeSegmenter(): Intl.Segmenter {
	return graphemeSegmenter;
}

/**
 * Get the shared word segmenter instance.
 */
export function getWordSegmenter(): Intl.Segmenter {
	return wordSegmenter;
}

/**
 * Check if a grapheme cluster (after segmentation) could possibly be an RGI emoji.
 * This is a fast heuristic to avoid the expensive rgiEmojiRegex test.
 * The tested Unicode blocks are deliberately broad to account for future
 * Unicode additions.
 */
function couldBeEmoji(segment: string): boolean {
	const cp = segment.codePointAt(0)!;
	return (
		(cp >= 0x1f000 && cp <= 0x1fbff) || // Emoji and Pictograph
		(cp >= 0x2300 && cp <= 0x23ff) || // Misc technical
		(cp >= 0x2600 && cp <= 0x27bf) || // Misc symbols, dingbats
		(cp >= 0x2b50 && cp <= 0x2b55) || // Specific stars/circles
		segment.includes("\uFE0F") || // Contains VS16 (emoji presentation selector)
		segment.length > 2 // Multi-codepoint sequences (ZWJ, skin tones, etc.)
	);
}

// Regexes for character classification (same as string-width library)
const zeroWidthRegex = /^(?:\p{Default_Ignorable_Code_Point}|\p{Control}|\p{Mark}|\p{Surrogate})+$/v;
const leadingNonPrintingRegex = /^[\p{Default_Ignorable_Code_Point}\p{Control}\p{Format}\p{Mark}\p{Surrogate}]+/v;
const rgiEmojiRegex = /^\p{RGI_Emoji}$/v;

// Cache for non-ASCII strings
const WIDTH_CACHE_SIZE = 512;
const widthCache = new Map<string, number>();

export const cjkBreakRegex =
	/[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Hangul}\p{Script_Extensions=Bopomofo}]/u;

function truncateFragmentToWidth(text: string, maxWidth: number): { text: string; width: number } {
	if (maxWidth <= 0 || text.length === 0) {
		return { text: "", width: 0 };
	}

	if (isPrintableAscii(text)) {
		const clipped = text.slice(0, maxWidth);
		return { text: clipped, width: clipped.length };
	}

	const hasAnsi = text.includes("\x1b");
	const hasTabs = text.includes("\t");
	if (!hasAnsi && !hasTabs) {
		return truncateFragmentGraphemeOnly(text, maxWidth, graphemeWidth);
	}

	return truncateFragmentAnsiAndTabs(text, maxWidth, graphemeWidth);
}

/**
 * Calculate the terminal width of a single grapheme cluster.
 * Based on code from the string-width library, but includes a possible-emoji
 * check to avoid running the RGI_Emoji regex unnecessarily.
 */
function graphemeWidth(segment: string): number {
	if (segment === "\t") {
		return 3;
	}

	// Zero-width clusters
	if (zeroWidthRegex.test(segment)) {
		return 0;
	}

	// Emoji check with pre-filter
	if (couldBeEmoji(segment) && rgiEmojiRegex.test(segment)) {
		return 2;
	}

	// Get base visible codepoint
	const base = segment.replace(leadingNonPrintingRegex, "");
	const cp = base.codePointAt(0)!;
	if (cp === undefined) {
		return 0;
	}

	// Regional indicator symbols (U+1F1E6..U+1F1FF) are often rendered as
	// full-width emoji in terminals, even when isolated during streaming.
	// Keep width conservative (2) to avoid terminal auto-wrap drift artifacts.
	if (cp >= 0x1f1e6 && cp <= 0x1f1ff) {
		return 2;
	}

	let width = eastAsianWidth(cp);

	// Trailing halfwidth/fullwidth forms and AM vowels that segment with a base.
	if (segment.length > 1) {
		for (const char of segment.slice(1)) {
			const c = char.codePointAt(0)!;
			if (c >= 0xff00 && c <= 0xffef) {
				width += eastAsianWidth(c);
			} else if (c === 0x0e33 || c === 0x0eb3) {
				width += 1;
			}
		}
	}

	return width;
}

/**
 * Calculate the visible width of a string in terminal columns.
 */
export function visibleWidth(str: string): number {
	if (str.length === 0) {
		return 0;
	}

	// Fast path: pure ASCII printable
	if (isPrintableAscii(str)) {
		return str.length;
	}

	// Check cache
	const cached = widthCache.get(str);
	if (cached !== undefined) {
		return cached;
	}

	// Normalize: tabs to 3 spaces, strip ANSI escape codes
	let clean = str;
	if (str.includes("\t")) {
		clean = clean.replace(/\t/g, "   ");
	}
	if (clean.includes("\x1b")) {
		// Strip supported ANSI/OSC/APC escape sequences in one pass.
		// This covers CSI styling/cursor codes, OSC hyperlinks and prompt markers,
		// and APC sequences like CURSOR_MARKER.
		let stripped = "";
		let i = 0;
		while (i < clean.length) {
			const ansi = extractAnsiCode(clean, i);
			if (ansi) {
				i += ansi.length;
				continue;
			}
			stripped += clean[i];
			i++;
		}
		clean = stripped;
	}

	// Calculate width
	let width = 0;
	for (const { segment } of graphemeSegmenter.segment(clean)) {
		width += graphemeWidth(segment);
	}

	// Cache result
	if (widthCache.size >= WIDTH_CACHE_SIZE) {
		const firstKey = widthCache.keys().next().value;
		if (firstKey !== undefined) {
			widthCache.delete(firstKey);
		}
	}
	widthCache.set(str, width);

	return width;
}

/**
 * Normalize text for terminal output without changing logical editor content.
 * Some terminals render precomposed Thai/Lao AM vowels inconsistently during
 * differential repaint. Their compatibility decompositions have the same cell
 * width but avoid stale-cell artifacts in terminal renderers.
 */
const THAI_LAO_AM_REGEX = /[\u0e33\u0eb3]/;
const THAI_LAO_AM_GLOBAL_REGEX = /[\u0e33\u0eb3]/g;

export function normalizeTerminalOutput(str: string): string {
	if (!THAI_LAO_AM_REGEX.test(str)) return str;
	return str.replace(THAI_LAO_AM_GLOBAL_REGEX, (char) => (char === "\u0e33" ? "\u0e4d\u0e32" : "\u0ecd\u0eb2"));
}

type Osc8Terminator = "\x07" | "\x1b\\";

interface ActiveHyperlink {
	params: string;
	url: string;
	terminator: Osc8Terminator;
}

function parseOsc8Hyperlink(ansiCode: string): ActiveHyperlink | null | undefined {
	if (!ansiCode.startsWith("\x1b]8;")) {
		return undefined;
	}

	const terminator: Osc8Terminator = ansiCode.endsWith("\x07") ? "\x07" : "\x1b\\";
	const body = ansiCode.slice(4, terminator === "\x07" ? -1 : -2);
	const separatorIndex = body.indexOf(";");
	if (separatorIndex === -1) {
		return undefined;
	}

	const params = body.slice(0, separatorIndex);
	const url = body.slice(separatorIndex + 1);
	if (!url) {
		return null;
	}
	return { params, url, terminator };
}

function formatOsc8Hyperlink(hyperlink: ActiveHyperlink): string {
	return `\x1b]8;${hyperlink.params};${hyperlink.url}${hyperlink.terminator}`;
}

function formatOsc8Close(terminator: Osc8Terminator): string {
	return `\x1b]8;;${terminator}`;
}

/**
 * Track active ANSI SGR codes to preserve styling across line breaks.
 */
class AnsiCodeTracker {
	// Track individual attributes separately so we can reset them specifically
	private bold = false;
	private dim = false;
	private italic = false;
	private underline = false;
	private blink = false;
	private inverse = false;
	private hidden = false;
	private strikethrough = false;
	private fgColor: string | null = null; // Stores the full code like "31" or "38;5;240"
	private bgColor: string | null = null; // Stores the full code like "41" or "48;5;240"
	private activeHyperlink: ActiveHyperlink | null = null;

	/**
	 * SGR codes that toggle a single boolean attribute on the tracker.
	 * The table dispatches to small setter methods so the main handler stays
	 * focused on the dispatch and color branches.
	 */
	private static readonly SGR_TOGGLE: ReadonlyMap<number, (t: AnsiCodeTracker) => void> = new Map<
		number,
		(t: AnsiCodeTracker) => void
	>([
		[0, (t) => t.reset()],
		[1, (t) => t.setBold(true)],
		[2, (t) => t.setDim(true)],
		[3, (t) => t.setItalic(true)],
		[4, (t) => t.setUnderline(true)],
		[5, (t) => t.setBlink(true)],
		[7, (t) => t.setInverse(true)],
		[8, (t) => t.setHidden(true)],
		[9, (t) => t.setStrikethrough(true)],
		[21, (t) => t.setBold(false)],
		[22, (t) => t.setBoldAndDimOff()],
		[23, (t) => t.setItalic(false)],
		[24, (t) => t.setUnderline(false)],
		[25, (t) => t.setBlink(false)],
		[27, (t) => t.setInverse(false)],
		[28, (t) => t.setHidden(false)],
		[29, (t) => t.setStrikethrough(false)],
	]);

	process(ansiCode: string): void {
		// OSC 8 hyperlink: \x1b]8;;<url>\x1b\\ (open) or \x1b]8;;\x1b\\ (close).
		// Preserve the original terminator because some terminals only make BEL-terminated
		// links clickable. OAuth login URLs use BEL, so reopening wrapped lines with ST
		// made only the first physical line clickable in those terminals.
		const hyperlink = parseOsc8Hyperlink(ansiCode);
		if (hyperlink !== undefined) {
			this.activeHyperlink = hyperlink;
			return;
		}

		if (!ansiCode.endsWith("m")) {
			return;
		}

		// Extract the parameters between \x1b[ and m
		const match = ansiCode.match(/\x1b\[([\d;]*)m/);
		if (!match) return;

		const params = match[1];
		if (params === "" || params === "0") {
			// Full reset
			this.reset();
			return;
		}

		const parts = params.split(";");
		let i = 0;
		while (i < parts.length) {
			const code = Number.parseInt(parts[i], 10);
			const extendedAdvance = this.applyExtendedColorCode(parts, i, code);
			if (extendedAdvance > 0) {
				i += extendedAdvance;
				continue;
			}
			this.applyStandardSgrCode(code);
			i++;
		}
	}

	private applyExtendedColorCode(parts: string[], i: number, code: number): number {
		if (code !== 38 && code !== 48) {
			return 0;
		}
		if (parts[i + 1] === "5" && parts[i + 2] !== undefined) {
			return this.setExtendedColor(parts, i, code);
		}
		if (parts[i + 1] === "2" && parts[i + 4] !== undefined) {
			return this.setTrueColor(parts, i, code);
		}
		return 0;
	}

	/** Store a 256-color extended palette code and return the parameter width. */
	private setExtendedColor(parts: string[], i: number, code: number): number {
		const colorCode = `${parts[i]};${parts[i + 1]};${parts[i + 2]}`;
		if (code === 38) {
			this.fgColor = colorCode;
		} else {
			this.bgColor = colorCode;
		}
		return 3;
	}

	/** Store a 24-bit true-color code and return the parameter width. */
	private setTrueColor(parts: string[], i: number, code: number): number {
		const colorCode = `${parts[i]};${parts[i + 1]};${parts[i + 2]};${parts[i + 3]};${parts[i + 4]}`;
		if (code === 38) {
			this.fgColor = colorCode;
		} else {
			this.bgColor = colorCode;
		}
		return 5;
	}

	private applyStandardSgrCode(code: number): void {
		const handler = AnsiCodeTracker.SGR_TOGGLE.get(code);
		if (handler) {
			handler(this);
			return;
		}
		if (code === 39) {
			this.fgColor = null;
			return;
		}
		if (code === 49) {
			this.bgColor = null;
			return;
		}
		if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
			this.fgColor = String(code);
		} else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) {
			this.bgColor = String(code);
		}
	}

	private reset(): void {
		this.bold = false;
		this.dim = false;
		this.italic = false;
		this.underline = false;
		this.blink = false;
		this.inverse = false;
		this.hidden = false;
		this.strikethrough = false;
		this.fgColor = null;
		this.bgColor = null;
		// SGR reset does not affect OSC 8 hyperlink state
	}

	private setBold(v: boolean): void {
		this.bold = v;
	}
	private setDim(v: boolean): void {
		this.dim = v;
	}
	private setItalic(v: boolean): void {
		this.italic = v;
	}
	private setUnderline(v: boolean): void {
		this.underline = v;
	}
	private setBlink(v: boolean): void {
		this.blink = v;
	}
	private setInverse(v: boolean): void {
		this.inverse = v;
	}
	private setHidden(v: boolean): void {
		this.hidden = v;
	}
	private setStrikethrough(v: boolean): void {
		this.strikethrough = v;
	}
	private setBoldAndDimOff(): void {
		this.bold = false;
		this.dim = false;
	}

	/** Clear all state for reuse. */
	clear(): void {
		this.reset();
		this.activeHyperlink = null;
	}

	getActiveCodes(): string {
		const codes: string[] = [];
		if (this.bold) codes.push("1");
		if (this.dim) codes.push("2");
		if (this.italic) codes.push("3");
		if (this.underline) codes.push("4");
		if (this.blink) codes.push("5");
		if (this.inverse) codes.push("7");
		if (this.hidden) codes.push("8");
		if (this.strikethrough) codes.push("9");
		if (this.fgColor) codes.push(this.fgColor);
		if (this.bgColor) codes.push(this.bgColor);

		let result = codes.length > 0 ? `\x1b[${codes.join(";")}m` : "";
		if (this.activeHyperlink) {
			result += formatOsc8Hyperlink(this.activeHyperlink);
		}
		return result;
	}

	hasActiveCodes(): boolean {
		return (
			this.bold ||
			this.dim ||
			this.italic ||
			this.underline ||
			this.blink ||
			this.inverse ||
			this.hidden ||
			this.strikethrough ||
			this.fgColor !== null ||
			this.bgColor !== null ||
			this.activeHyperlink !== null
		);
	}

	/**
	 * Get reset codes for attributes that need to be turned off at line end.
	 * Underline must be closed to prevent bleeding into padding.
	 * Active OSC 8 hyperlinks must be closed and re-opened on the next line.
	 * Returns empty string if no attributes need closing.
	 */
	getLineEndReset(): string {
		let result = "";
		if (this.underline) {
			result += "\x1b[24m"; // Underline off only
		}
		if (this.activeHyperlink) {
			result += formatOsc8Close(this.activeHyperlink.terminator); // Re-opened at line start via getActiveCodes()
		}
		return result;
	}
}

function updateTrackerFromText(text: string, tracker: AnsiCodeTracker): void {
	let i = 0;
	while (i < text.length) {
		const ansiResult = extractAnsiCode(text, i);
		if (ansiResult) {
			tracker.process(ansiResult.code);
			i += ansiResult.length;
		} else {
			i++;
		}
	}
}

/**
 * Split text into words while keeping ANSI codes attached.
 */
function splitIntoTokensWithAnsi(text: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let pendingAnsi = ""; // ANSI codes waiting to be attached to next visible content
	let currentKind: "space" | "word" | null = null;
	let i = 0;

	const flushCurrent = (): void => {
		if (!current) {
			return;
		}
		tokens.push(current);
		current = "";
		currentKind = null;
	};

	while (i < text.length) {
		const ansiResult = extractAnsiCode(text, i);
		if (ansiResult) {
			// Hold ANSI codes separately - they'll be attached to the next visible char
			pendingAnsi += ansiResult.code;
			i += ansiResult.length;
			continue;
		}

		let end = i;
		while (end < text.length && !extractAnsiCode(text, end)) {
			end++;
		}

		for (const { segment } of graphemeSegmenter.segment(text.slice(i, end))) {
			const segmentIsSpace = segment === " ";
			if (!segmentIsSpace && cjkBreakRegex.test(segment)) {
				flushCurrent();
				const token = pendingAnsi + segment;
				pendingAnsi = "";
				tokens.push(token);
				continue;
			}

			const segmentKind = segmentIsSpace ? "space" : "word";
			if (current && currentKind !== segmentKind) {
				flushCurrent();
			}

			// Attach any pending ANSI codes to this visible character
			if (pendingAnsi) {
				current += pendingAnsi;
				pendingAnsi = "";
			}

			currentKind = segmentKind;
			current += segment;
		}

		i = end;
	}

	// Handle any remaining pending ANSI codes (attach to last token)
	if (pendingAnsi) {
		if (current) {
			current += pendingAnsi;
		} else if (tokens.length > 0) {
			tokens[tokens.length - 1] += pendingAnsi;
		} else {
			current = pendingAnsi;
		}
	}

	if (current) {
		tokens.push(current);
	}

	return tokens;
}

/**
 * Wrap text with ANSI codes preserved.
 *
 * ONLY does word wrapping - NO padding, NO background colors.
 * Returns lines where each line is <= width visible chars.
 * Active ANSI codes are preserved across line breaks.
 *
 * @param text - Text to wrap (may contain ANSI codes and newlines)
 * @param width - Maximum visible width per line
 * @returns Array of wrapped lines (NOT padded to width)
 */
export function wrapTextWithAnsi(text: string, width: number): string[] {
	if (!text) {
		return [""];
	}

	// Handle newlines by processing each line separately
	// Track ANSI state across lines so styles carry over after literal newlines
	const inputLines = text.split("\n");
	const result: string[] = [];
	const tracker = new AnsiCodeTracker();

	for (const inputLine of inputLines) {
		// Prepend active ANSI codes from previous lines (except for first line)
		const prefix = result.length > 0 ? tracker.getActiveCodes() : "";
		const wrappedLines = wrapSingleLine(prefix + inputLine, width);
		for (const wrappedLine of wrappedLines) {
			result.push(wrappedLine);
		}
		// Update tracker with codes from this line for next iteration
		updateTrackerFromText(inputLine, tracker);
	}

	return result.length > 0 ? result : [""];
}

function wrapSingleLine(line: string, width: number): string[] {
	if (!line) {
		return [""];
	}

	const visibleLength = visibleWidth(line);
	if (visibleLength <= width) {
		return [line];
	}

	const wrapped: string[] = [];
	const tracker = new AnsiCodeTracker();
	const tokens = splitIntoTokensWithAnsi(line);
	const state: WrapLineState = { currentLine: "", currentVisibleLength: 0 };

	for (const token of tokens) {
		const tokenVisibleLength = visibleWidth(token);
		const isWhitespace = token.trim() === "";

		if (tokenVisibleLength > width && !isWhitespace) {
			appendLongTokenToWrap(token, width, tracker, wrapped, state, (w, wd, tr) =>
				breakLongWord(w, wd, tr as AnsiCodeTracker),
			);
			continue;
		}

		const totalNeeded = state.currentVisibleLength + tokenVisibleLength;
		if (totalNeeded > width && state.currentVisibleLength > 0) {
			applyWrapTokenOverflow(token, tokenVisibleLength, isWhitespace, width, tracker, wrapped, state);
		} else {
			state.currentLine += token;
			state.currentVisibleLength += tokenVisibleLength;
		}

		updateTrackerFromText(token, tracker);
	}

	const currentLine = state.currentLine;

	if (currentLine) {
		// No reset at end of final line - let caller handle it
		wrapped.push(currentLine);
	}

	// Trailing whitespace can cause lines to exceed the requested width
	return wrapped.length > 0 ? wrapped.map((line) => line.trimEnd()) : [""];
}

export const PUNCTUATION_REGEX = /[(){}[\]<>.,;:'"!?+\-=*/\\|&%^$#@~`]/;

/**
 * Check if a character is whitespace.
 */
export function isWhitespaceChar(char: string): boolean {
	return /\s/.test(char);
}

/**
 * Check if a character is punctuation.
 */
export function isPunctuationChar(char: string): boolean {
	return PUNCTUATION_REGEX.test(char);
}

function breakLongWord(word: string, width: number, tracker: AnsiCodeTracker): string[] {
	const lines: string[] = [];
	let currentLine = tracker.getActiveCodes();
	let currentWidth = 0;
	const segments = collectWordBreakSegments(word);

	// Now process segments
	for (const seg of segments) {
		if (seg.type === "ansi") {
			currentLine += seg.value;
			tracker.process(seg.value);
			continue;
		}

		const grapheme = seg.value;
		// Skip empty graphemes to avoid issues with string-width calculation
		if (!grapheme) continue;

		const graphemeWidth = visibleWidth(grapheme);

		if (currentWidth + graphemeWidth > width) {
			// Add specific reset for underline only (preserves background)
			const lineEndReset = tracker.getLineEndReset();
			if (lineEndReset) {
				currentLine += lineEndReset;
			}
			lines.push(currentLine);
			currentLine = tracker.getActiveCodes();
			currentWidth = 0;
		}

		currentLine += grapheme;
		currentWidth += graphemeWidth;
	}

	if (currentLine) {
		// No reset at end of final segment - caller handles continuation
		lines.push(currentLine);
	}

	return lines.length > 0 ? lines : [""];
}

/**
 * Apply background color to a line, padding to full width.
 *
 * @param line - Line of text (may contain ANSI codes)
 * @param width - Total width to pad to
 * @param bgFn - Background color function
 * @returns Line with background applied and padded to width
 */
export function applyBackgroundToLine(line: string, width: number, bgFn: (text: string) => string): string {
	// Calculate padding needed
	const visibleLen = visibleWidth(line);
	const paddingNeeded = Math.max(0, width - visibleLen);
	const padding = " ".repeat(paddingNeeded);

	// Apply background to content + padding
	const withPadding = line + padding;
	return bgFn(withPadding);
}

/**
 * Truncate text to fit within a maximum visible width, adding ellipsis if needed.
 * Optionally pad with spaces to reach exactly maxWidth.
 * Properly handles ANSI escape codes (they don't count toward width).
 *
 * @param text - Text to truncate (may contain ANSI codes)
 * @param maxWidth - Maximum visible width
 * @param ellipsis - Ellipsis string to append when truncating (default: "...")
 * @param pad - If true, pad result with spaces to exactly maxWidth (default: false)
 * @returns Truncated text, optionally padded to exactly maxWidth
 */
export function truncateToWidth(
	text: string,
	maxWidth: number,
	ellipsis: string = "...",
	pad: boolean = false,
): string {
	if (maxWidth <= 0) {
		return "";
	}

	if (text.length === 0) {
		return pad ? " ".repeat(maxWidth) : "";
	}

	const ellipsisWidth = visibleWidth(ellipsis);
	if (ellipsisWidth >= maxWidth) {
		const textWidth = visibleWidth(text);
		const clippedEllipsis = truncateFragmentToWidth(ellipsis, maxWidth);
		return truncateWhenEllipsisTooWide(textWidth, text, maxWidth, clippedEllipsis, pad);
	}

	if (isPrintableAscii(text)) {
		if (text.length <= maxWidth) {
			return pad ? text + " ".repeat(maxWidth - text.length) : text;
		}
		const targetWidth = maxWidth - ellipsisWidth;
		return finalizeTruncatedResult(text.slice(0, targetWidth), targetWidth, ellipsis, ellipsisWidth, maxWidth, pad);
	}

	const targetWidth = maxWidth - ellipsisWidth;
	const hasAnsi = text.includes("\x1b");
	const hasTabs = text.includes("\t");

	if (!hasAnsi && !hasTabs) {
		const simple = truncateGraphemeSimple(text, targetWidth, maxWidth, graphemeWidth);
		if (!simple.overflowed) {
			return pad ? text + " ".repeat(Math.max(0, maxWidth - simple.visibleSoFar)) : text;
		}
		return finalizeTruncatedResult(simple.result, simple.keptWidth, ellipsis, ellipsisWidth, maxWidth, pad);
	}

	const state: TruncateAccumState = {
		result: "",
		pendingAnsi: "",
		visibleSoFar: 0,
		keptWidth: 0,
		keepContiguousPrefix: true,
		overflowed: false,
	};
	let i = 0;
	while (i < text.length) {
		const ansi = extractAnsiCode(text, i);
		if (ansi) {
			state.pendingAnsi += ansi.code;
			i += ansi.length;
			continue;
		}

		if (text[i] === "\t") {
			accumulateTruncateSegment(state, "\t", 3, targetWidth, maxWidth);
			if (state.overflowed) {
				break;
			}
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
			accumulateTruncateSegment(state, segment, graphemeWidth(segment), targetWidth, maxWidth);
			if (state.overflowed) {
				break;
			}
		}
		if (state.overflowed) {
			break;
		}
		i = end;
	}
	const exhaustedInput = i >= text.length;
	const { result, keptWidth, visibleSoFar, overflowed } = state;

	if (!overflowed && exhaustedInput) {
		return pad ? text + " ".repeat(Math.max(0, maxWidth - visibleSoFar)) : text;
	}

	return finalizeTruncatedResult(result, keptWidth, ellipsis, ellipsisWidth, maxWidth, pad);
}

/**
 * Extract a range of visible columns from a line. Handles ANSI codes and wide chars.
 * @param strict - If true, exclude wide chars at boundary that would extend past the range
 */
export function sliceByColumn(line: string, startCol: number, length: number, strict = false): string {
	return sliceWithWidth(line, startCol, length, strict).text;
}

/** Like sliceByColumn but also returns the actual visible width of the result. */
export function sliceWithWidth(
	line: string,
	startCol: number,
	length: number,
	strict = false,
): { text: string; width: number } {
	if (length <= 0) return { text: "", width: 0 };
	const endCol = startCol + length;
	let result = "",
		resultWidth = 0,
		currentCol = 0,
		i = 0,
		pendingAnsi = "";

	while (i < line.length) {
		const ansi = extractAnsiCode(line, i);
		if (ansi) {
			if (currentCol >= startCol && currentCol < endCol) result += ansi.code;
			else if (currentCol < startCol) pendingAnsi += ansi.code;
			i += ansi.length;
			continue;
		}

		let textEnd = i;
		while (textEnd < line.length && !extractAnsiCode(line, textEnd)) textEnd++;

		for (const { segment } of graphemeSegmenter.segment(line.slice(i, textEnd))) {
			const w = graphemeWidth(segment);
			const inRange = currentCol >= startCol && currentCol < endCol;
			const fits = !strict || currentCol + w <= endCol;
			if (inRange && fits) {
				if (pendingAnsi) {
					result += pendingAnsi;
					pendingAnsi = "";
				}
				result += segment;
				resultWidth += w;
			}
			currentCol += w;
			if (currentCol >= endCol) break;
		}
		i = textEnd;
		if (currentCol >= endCol) break;
	}
	return { text: result, width: resultWidth };
}

// Pooled tracker instance for extractSegments (avoids allocation per call)
const pooledStyleTracker = new AnsiCodeTracker();

/**
 * Extract "before" and "after" segments from a line in a single pass.
 * Used for overlay compositing where we need content before and after the overlay region.
 * Preserves styling from before the overlay that should affect content after it.
 */
export function extractSegments(
	line: string,
	beforeEnd: number,
	afterStart: number,
	afterLen: number,
	strictAfter = false,
): { before: string; beforeWidth: number; after: string; afterWidth: number } {
	let before = "",
		beforeWidth = 0,
		after = "",
		afterWidth = 0;
	let currentCol = 0,
		i = 0;
	let pendingAnsiBefore = "";
	let afterStarted = false;
	const afterEnd = afterStart + afterLen;

	// Track styling state so "after" inherits styling from before the overlay
	pooledStyleTracker.clear();

	while (i < line.length) {
		const ansi = extractAnsiCode(line, i);
		if (ansi) {
			// Track all SGR codes to know styling state at afterStart
			pooledStyleTracker.process(ansi.code);
			// Include ANSI codes in their respective segments
			if (currentCol < beforeEnd) {
				pendingAnsiBefore += ansi.code;
			} else if (currentCol >= afterStart && currentCol < afterEnd && afterStarted) {
				// Only include after we've started "after" (styling already prepended)
				after += ansi.code;
			}
			i += ansi.length;
			continue;
		}

		let textEnd = i;
		while (textEnd < line.length && !extractAnsiCode(line, textEnd)) textEnd++;

		for (const { segment } of graphemeSegmenter.segment(line.slice(i, textEnd))) {
			const w = graphemeWidth(segment);

			if (currentCol < beforeEnd && currentCol + w <= beforeEnd) {
				if (pendingAnsiBefore) {
					before += pendingAnsiBefore;
					pendingAnsiBefore = "";
				}
				before += segment;
				beforeWidth += w;
			} else if (currentCol >= afterStart && currentCol < afterEnd) {
				const fits = !strictAfter || currentCol + w <= afterEnd;
				if (fits) {
					// On first "after" grapheme, prepend inherited styling from before overlay
					if (!afterStarted) {
						after += pooledStyleTracker.getActiveCodes();
						afterStarted = true;
					}
					after += segment;
					afterWidth += w;
				}
			}

			currentCol += w;
			// Early exit: done with "before" only, or done with both segments
			if (afterLen <= 0 ? currentCol >= beforeEnd : currentCol >= afterEnd) break;
		}
		i = textEnd;
		if (afterLen <= 0 ? currentCol >= beforeEnd : currentCol >= afterEnd) break;
	}

	return { before, beforeWidth, after, afterWidth };
}
