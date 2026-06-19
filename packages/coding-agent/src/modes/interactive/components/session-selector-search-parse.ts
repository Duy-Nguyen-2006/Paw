/**
 * Session search query parsing helpers (reduces parseSearchQuery S3776).
 */

import type { ParsedSearchQuery } from "./session-selector-search.ts";

const REGEX_PREFIX = "re:";

export type SearchToken = { kind: "fuzzy" | "phrase"; value: string };

/** Parse a query that starts with the regex prefix; returns null when not in regex mode. */
export function tryParseRegexQuery(trimmed: string): ParsedSearchQuery | null {
	if (!trimmed.startsWith(REGEX_PREFIX)) return null;
	const pattern = trimmed.slice(REGEX_PREFIX.length).trim();
	if (!pattern) {
		return { mode: "regex", tokens: [], regex: null, error: "Empty regex" };
	}
	try {
		return { mode: "regex", tokens: [], regex: new RegExp(pattern, "i") };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { mode: "regex", tokens: [], regex: null, error: msg };
	}
}

/** Lowercase, collapse whitespace, trim — used for phrase matching. */
export function normalizeWhitespaceLower(text: string): string {
	return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Push a non-empty buffer into the tokens list. */
export function pushTokenIfNonEmpty(tokens: SearchToken[], buf: string, kind: "fuzzy" | "phrase"): string {
	const v = buf.trim();
	if (!v) return "";
	tokens.push({ kind, value: v });
	return "";
}

/** Split a raw string into whitespace tokens (the "unbalanced quote" fallback). */
export function splitWhitespaceTokens(text: string): SearchToken[] {
	return text
		.split(/\s+/)
		.map((t) => t.trim())
		.filter((t) => t.length > 0)
		.map((t) => ({ kind: "fuzzy" as const, value: t }));
}

/** Tokenize a query that supports double-quoted phrases. */
export function tokenizeQuotedQuery(trimmed: string): { tokens: SearchToken[]; hadUnclosedQuote: boolean } {
	const tokens: SearchToken[] = [];
	let buf = "";
	let inQuote = false;
	let hadUnclosedQuote = false;

	const flush = (kind: "fuzzy" | "phrase"): void => {
		buf = pushTokenIfNonEmpty(tokens, buf, kind);
	};

	for (let i = 0; i < trimmed.length; i++) {
		const ch = trimmed[i]!;
		if (ch === '"') {
			if (inQuote) {
				flush("phrase");
				inQuote = false;
			} else {
				flush("fuzzy");
				inQuote = true;
			}
			continue;
		}

		if (!inQuote && /\s/.test(ch)) {
			flush("fuzzy");
			continue;
		}

		buf += ch;
	}

	if (inQuote) hadUnclosedQuote = true;
	flush(inQuote ? "phrase" : "fuzzy");

	return { tokens, hadUnclosedQuote };
}
