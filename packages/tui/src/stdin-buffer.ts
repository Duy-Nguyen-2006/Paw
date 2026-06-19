/**
 * StdinBuffer buffers input and emits complete sequences.
 *
 * This is necessary because stdin data events can arrive in partial chunks,
 * especially for escape sequences like mouse events. Without buffering,
 * partial sequences can be misinterpreted as regular keypresses.
 *
 * For example, the mouse SGR sequence `\x1b[<35;20;5m` might arrive as:
 * - Event 1: `\x1b`
 * - Event 2: `[<35`
 * - Event 3: `;20;5m`
 *
 * The buffer accumulates these until a complete sequence is detected.
 * Call the `process()` method to feed input data.
 *
 * Based on code from OpenTUI (https://github.com/anomalyco/opentui)
 * MIT License - Copyright (c) 2025 opentui
 */

import { EventEmitter } from "node:events";
import { ESC, isCompleteEscapeSequence } from "./stdin-buffer-escape-helpers.ts";
const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";

/**
 * Split accumulated buffer into complete sequences
 */
function parseUnmodifiedKittyPrintableCodepoint(sequence: string): number | undefined {
	const match = sequence.match(/^\x1b\[(\d+)(?::\d*)?(?::\d+)?u$/);
	if (!match) return undefined;

	const codepoint = parseInt(match[1]!, 10);
	return codepoint >= 32 ? codepoint : undefined;
}

function tryEmitSplitEscEsc(remaining: string, seqEnd: number): { emit: string; advance: number } | null {
	if (remaining.slice(0, seqEnd) !== "\x1b\x1b") return null;
	const nextChar = remaining[seqEnd];
	if (nextChar !== "[" && nextChar !== "]" && nextChar !== "O" && nextChar !== "P" && nextChar !== "_") {
		return null;
	}
	return { emit: ESC, advance: 1 };
}

function extractCompleteSequences(buffer: string): { sequences: string[]; remainder: string } {
	const sequences: string[] = [];
	let pos = 0;

	while (pos < buffer.length) {
		const remaining = buffer.slice(pos);
		if (!remaining.startsWith(ESC)) {
			// Not an escape sequence - take a single character
			sequences.push(remaining[0]!);
			pos++;
			continue;
		}
		const result = extractOneEscapeSequence(remaining, sequences);
		pos += result.consumed;
		if (result.remainder !== undefined) {
			return { sequences, remainder: result.remainder };
		}
	}

	return { sequences, remainder: "" };
}

/**
 * Consume one ESC-prefixed sequence from the start of `remaining`, appending
 * to `sequences`. Returns the number of characters consumed, plus an optional
 * `remainder` string when the buffer is exhausted mid-sequence.
 */
function extractOneEscapeSequence(
	remaining: string,
	sequences: string[],
): { consumed: number; remainder?: string } {
	let seqEnd = 1;
	while (seqEnd <= remaining.length) {
		const candidate = remaining.slice(0, seqEnd);
		const status = isCompleteEscapeSequence(candidate);

		if (status === "complete") {
			// WezTerm with enable_kitty_keyboard sends the Escape key press as a
			// raw '\x1b' byte (simple text path in encode_kitty, ignoring
			// DISAMBIGUATE_ESCAPE_CODES) and the release as a full Kitty CSI-u
			// sequence. These arrive concatenated as '\x1b\x1b[27;...u'.
			// The buffer would normally treat '\x1b\x1b' as a complete meta-key
			// sequence (ESC + single char), leaving '[27;...u' to be typed as
			// plain text. If the character immediately following '\x1b\x1b'
			// would begin a new escape sequence, emit only the first ESC and
			// restart from the second.
			const splitEsc = tryEmitSplitEscEsc(remaining, seqEnd);
			if (splitEsc) {
				sequences.push(splitEsc.emit);
				return { consumed: splitEsc.advance };
			}
			sequences.push(candidate);
			return { consumed: seqEnd };
		}
		if (status === "incomplete") {
			seqEnd++;
			continue;
		}
		// Should not happen when starting with ESC
		sequences.push(candidate);
		return { consumed: seqEnd };
	}
	// Buffer ended with an incomplete escape sequence - keep the rest for later.
	return { consumed: 0, remainder: remaining };
}

export type StdinBufferOptions = {
	/**
	 * Maximum time to wait for sequence completion (default: 10ms)
	 * After this time, the buffer is flushed even if incomplete
	 */
	timeout?: number;
};

export type StdinBufferEventMap = {
	data: [string];
	paste: [string];
};

/**
 * Buffers stdin input and emits complete sequences via the 'data' event.
 * Handles partial escape sequences that arrive across multiple chunks.
 */
export class StdinBuffer extends EventEmitter<StdinBufferEventMap> {
	private buffer: string = "";
	private timeout: ReturnType<typeof setTimeout> | null = null;
	private readonly timeoutMs: number;
	private pasteMode: boolean = false;
	private pasteBuffer: string = "";
	private pendingKittyPrintableCodepoint: number | undefined;

	constructor(options: StdinBufferOptions = {}) {
		super();
		this.timeoutMs = options.timeout ?? 10;
	}

	private decodeIncomingChunk(data: string | Buffer): string {
		if (Buffer.isBuffer(data)) {
			if (data.length === 1 && data[0]! > 127) {
				const byte = data[0]! - 128;
				return `\x1b${String.fromCodePoint(byte)}`;
			}
			return data.toString();
		}
		return data;
	}

	private finishBracketedPaste(endIndex: number): void {
		const pastedContent = this.pasteBuffer.slice(0, endIndex);
		const remaining = this.pasteBuffer.slice(endIndex + BRACKETED_PASTE_END.length);
		this.pasteMode = false;
		this.pasteBuffer = "";
		this.pendingKittyPrintableCodepoint = undefined;
		this.emit("paste", pastedContent);
		if (remaining.length > 0) {
			this.process(remaining);
		}
	}

	public process(data: string | Buffer): void {
		if (this.timeout) {
			clearTimeout(this.timeout);
			this.timeout = null;
		}

		const str = this.decodeIncomingChunk(data);

		if (str.length === 0 && this.buffer.length === 0) {
			this.emitDataSequence("");
			return;
		}

		this.buffer += str;

		if (this.pasteMode) {
			this.pasteBuffer += this.buffer;
			this.buffer = "";

			const endIndex = this.pasteBuffer.indexOf(BRACKETED_PASTE_END);
			if (endIndex !== -1) {
				this.finishBracketedPaste(endIndex);
			}
			return;
		}

		const startIndex = this.buffer.indexOf(BRACKETED_PASTE_START);
		if (startIndex !== -1) {
			if (startIndex > 0) {
				const beforePaste = this.buffer.slice(0, startIndex);
				const result = extractCompleteSequences(beforePaste);
				for (const sequence of result.sequences) {
					this.emitDataSequence(sequence);
				}
			}

			this.pendingKittyPrintableCodepoint = undefined;
			this.buffer = this.buffer.slice(startIndex + BRACKETED_PASTE_START.length);
			this.pasteMode = true;
			this.pasteBuffer = this.buffer;
			this.buffer = "";

			const endIndex = this.pasteBuffer.indexOf(BRACKETED_PASTE_END);
			if (endIndex !== -1) {
				this.finishBracketedPaste(endIndex);
			}
			return;
		}

		const result = extractCompleteSequences(this.buffer);
		this.buffer = result.remainder;

		for (const sequence of result.sequences) {
			this.emitDataSequence(sequence);
		}

		if (this.buffer.length > 0) {
			this.timeout = setTimeout(() => {
				const flushed = this.flush();

				for (const sequence of flushed) {
					this.emitDataSequence(sequence);
				}
			}, this.timeoutMs);
		}
	}

	private emitDataSequence(sequence: string): void {
		const rawCodepoint = sequence.length === 1 ? sequence.codePointAt(0)! : undefined;
		if (rawCodepoint !== undefined && rawCodepoint === this.pendingKittyPrintableCodepoint) {
			this.pendingKittyPrintableCodepoint = undefined;
			return;
		}

		this.pendingKittyPrintableCodepoint = parseUnmodifiedKittyPrintableCodepoint(sequence);
		this.emit("data", sequence);
	}

	flush(): string[] {
		if (this.timeout) {
			clearTimeout(this.timeout);
			this.timeout = null;
		}

		if (this.buffer.length === 0) {
			return [];
		}

		const sequences = [this.buffer];
		this.buffer = "";
		this.pendingKittyPrintableCodepoint = undefined;
		return sequences;
	}

	clear(): void {
		if (this.timeout) {
			clearTimeout(this.timeout);
			this.timeout = null;
		}
		this.buffer = "";
		this.pasteMode = false;
		this.pasteBuffer = "";
		this.pendingKittyPrintableCodepoint = undefined;
	}

	getBuffer(): string {
		return this.buffer;
	}

	destroy(): void {
		this.clear();
	}
}
