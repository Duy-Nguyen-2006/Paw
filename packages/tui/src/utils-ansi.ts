/**
 * ANSI escape sequence parsing extracted from utils.ts (S3776).
 */

export function extractCsiAnsiCode(str: string, pos: number): { code: string; length: number } | null {
	let j = pos + 2;
	while (j < str.length && !/[mGKHJ]/.test(str[j]!)) j++;
	if (j < str.length) return { code: str.substring(pos, j + 1), length: j + 1 - pos };
	return null;
}

export function extractDelimitedAnsiCode(str: string, pos: number, opener: string): { code: string; length: number } | null {
	if (str[pos + 1] !== opener) return null;
	let j = pos + 2;
	while (j < str.length) {
		if (str[j] === "\x07") return { code: str.substring(pos, j + 1), length: j + 1 - pos };
		if (str[j] === "\x1b" && str[j + 1] === "\\") return { code: str.substring(pos, j + 2), length: j + 2 - pos };
		j++;
	}
	return null;
}

/**
 * Extract ANSI escape sequences from a string at the given position.
 */
export function extractAnsiCode(str: string, pos: number): { code: string; length: number } | null {
	if (pos >= str.length || str[pos] !== "\x1b") return null;

	const next = str[pos + 1];
	if (next === "[") {
		return extractCsiAnsiCode(str, pos);
	}
	if (next === "]") {
		return extractDelimitedAnsiCode(str, pos, "]");
	}
	if (next === "_") {
		return extractDelimitedAnsiCode(str, pos, "_");
	}
	return null;
}
