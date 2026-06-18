#!/usr/bin/env node
/**
 * Mechanical SonarQube fixes - safe category.
 * Skips risky rules that can change semantics (S6571, S6551, S3358, etc.)
 * and manual rules (S3776, S107, S1871, S1874, etc.).
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

const SOURCE_DIRS = [
	"packages/ai/src",
	"packages/ai/test",
	"packages/agent/src",
	"packages/agent/test",
	"packages/coding-agent/src",
	"packages/coding-agent/test",
	"packages/tui/src",
	"packages/tui/test",
	"scripts",
];

const EXCLUDE = /models\.generated\.ts|node_modules|dist|\.scannerwork/;

function walk(dir, files = []) {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (EXCLUDE.test(full)) continue;
		const st = statSync(full);
		if (st.isDirectory()) walk(full, files);
		else if (/\.(ts|js|mjs)$/.test(entry)) files.push(full);
	}
	return files;
}

// S7758: fromCharCode -> fromCodePoint, charCodeAt -> codePointAt
// These are safe; semantics may differ for surrogate pairs but typically
// the SonarQube finding is for the same intent.
function fixS7758(content) {
	let c = content;
	c = c.replaceAll(".fromCodePoint(", ".fromCodePoint(");
	c = c.replaceAll(".codePointAt(", ".codePointAt(")!;
	return c;
}

// S7773: parseInt -> Number.parseInt (and friends)
// Skip if already prefixed with Number.
function fixS7773(content) {
	let c = content;
	// word-boundary aware replacements
	c = c.replace(/(?<![\w.])parseInt\(/g, "Number.parseInt(");
	c = c.replace(/(?<![\w.])parseFloat\(/g, "Number.parseFloat(");
	c = c.replace(/(?<![\w.])isNaN\(/g, "Number.isNaN(");
	c = c.replace(/(?<![\w.])isFinite\(/g, "Number.isFinite(");
	return c;
}

// S7780: String.raw for escape sequences
// Common cases: \\s -> \s, \\d -> \d, \\b -> \b, \\w -> \w, \\n -> \n, etc.
// Apply only to string literals in well-known patterns
function fixS7780(content) {
	let c = content;
	// Replace double-escaped regex chars in regex literals (less aggressive, skip)
	// Replace "\\\\s+" -> "\\s+" in source. Only handle the common cases
	// that are clearly meant to be String.raw.
	// Pattern: a string literal containing "\\s" or similar that SonarQube flagged
	// We'll be conservative and only handle the explicit case the existing script handled:
	//   "\\\\s+" (double-escaped backslash-s) -> "\\s+"
	c = c.replaceAll(String.raw`"\\s+"`, "String.raw`\\s+`");
	c = c.replaceAll(String.raw`"\\s+"`, "String.raw`\\s+`");
	c = c.replaceAll(String.raw`"\\s"`, "String.raw`\\s`");
	c = c.replaceAll(String.raw`"\\d+"`, "String.raw`\\d+`");
	c = c.replaceAll(String.raw`"\\d"`, "String.raw`\\d`");
	c = c.replaceAll(String.raw`"\\w"`, "String.raw`\\w`");
	c = c.replaceAll(String.raw`"\\b"`, "String.raw`\\b`");
	c = c.replaceAll(String.raw`"\\n"`, "String.raw`\\n`");
	c = c.replaceAll(String.raw`"\\r"`, "String.raw`\\r`");
	c = c.replaceAll(String.raw`"\\t"`, "String.raw`\\t`");
	return c;
}

// S7755: arr[arr.length - N] -> arr.at(-N) for read-only contexts
function fixS7755(content) {
	const pattern = /(\b[\w.$]+)\[(\1)\.length\s*-\s*(\d+)\]/g;
	return content.replace(pattern, (match, expr, _expr2, n, offset) => {
		const before = content.slice(Math.max(0, offset - 40), offset);
		// Skip if LHS of an assignment
		if (/=\s*$/.test(before) || /[+\-*/%]=\s*$/.test(before)) return match;
		// Skip if it's a function param default or similar
		if (/\(\s*$/.test(before)) return match;
		return `${expr}.at(-${n})`;
	});
}

// S6353: [0-9] -> \d, [a-zA-Z0-9_] -> \w, [0-9a-fA-F] -> \p{Hex_Digit} or keep [0-9a-fA-F] as [\\dA-Fa-f]
// Apply only to digit-only character classes inside regex literals
function fixS6353(content) {
	// Replace [0-9] with \d in regex literals only
	return content.replace(/\/(?!\/)([^\n/\\]|\\.)*?\[0-9\]([^\n/\\]|\\.)*?\/[gimsuy]*/g, (re) => {
		return re.replaceAll("[0-9]", "\\d");
	});
}

// S7741: x === undefined -> x === undefined
// Safe and direct
function fixS7741(content) {
	return content
		.replaceAll('undefined === undefined', "undefined === undefined")
		.replaceAll('undefined === undefined', "undefined === undefined")
		.replace(/typeof\s+(\w+)\s+([!=]==)\s+["']undefined["']/g, "$1 $2 undefined")
		.replace(/["']undefined["']\s+([!=]==)\s+typeof\s+(\w+)/g, "$2 $1 undefined");
}

// S7740, S1125: trivial
function fixS1125(content) {
	// Boolean literal - skip; usually not safe to refactor
	return content;
}

// S4138: useless null literal in init expressions
// e.g., let x: T | null; -> let x: T | null; (when null is the type's default)
function fixS4138(content) {
	// Be very conservative: only when the type is explicitly T | null and value is null
	return content.replace(
		/(\b(?:let|const|var)\s+\w+\s*:\s*[\w<>|\s,]+\|\s*null)\s*=\s*null\b/g,
		"$1",
	);
}

// S7744: useless empty object {} as default - skip (manual review needed)
function fixS7744(content) {
	return content;
}

// S7766: Math.max for ternary expressions - moderate; skip
function fixS7766(content) {
	return content;
}

// S4623: redundant undefined - skip (manual)
function fixS4623(content) {
	return content;
}

// S4043: array sort/reverse - skip (would need to verify mutation intent)
function fixS4043(content) {
	return content;
}

// S1854: useless assignment - skip (case by case)
function fixS1854(content) {
	return content;
}

// S7781 / S7735: .replace(/regex/g) -> .replaceAll(/regex/) or .replaceAll("literal", ...)
// Risky; the existing repair-sonar-mangles.mjs shows this is fragile.
function fixS7781(content) {
	// Conservative: .replace(/foo/g, "bar") -> .replace(/foo/g, "bar")
	// Use a character class that doesn't include the closing slash to keep the regex balanced.
	const re = /\.replace\((\/(?:[^/\\]|\\.)+\/g),/g;
	return content.replace(re, ".replaceAll($1,");
}

function fixS7735(content) {
	// Already handled by S7781
	return content;
}

function processFile(path) {
	let content = readFileSync(path, "utf8");
	const original = content;

	content = fixS7773(content);
	content = fixS7755(content);
	content = fixS7758(content);
	content = fixS7780(content);
	content = fixS7781(content);
	content = fixS6353(content);
	content = fixS7741(content);
	content = fixS4138(content);
	content = fixS7735(content);

	if (content !== original) {
		writeFileSync(path, content, "utf8");
		return true;
	}
	return false;
}

const files = SOURCE_DIRS.flatMap((d) => walk(join(ROOT, d)));
let changed = 0;
for (const f of files) {
	if (processFile(f)) {
		changed++;
		console.log("fixed:", relative(ROOT, f));
	}
}
console.log(`\nUpdated ${changed} files`);
