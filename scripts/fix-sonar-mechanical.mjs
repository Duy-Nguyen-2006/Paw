#!/usr/bin/env node
/**
 * Apply mechanical SonarQube fixes across source files.
 * Run: node scripts/fix-sonar-mechanical.mjs
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

function fixS7773(content) {
	// parseInt/parseFloat/isNaN/isFinite at word boundaries (not already Number.)
	let c = content;
	c = c.replaceAll("(?<!Number.)bparseInt(", "Number.parseInt(");
	c = c.replaceAll("(?<!Number.)bparseFloat(", "Number.parseFloat(");
	c = c.replaceAll("(?<!Number.)bisNaN(", "Number.isNaN(");
	c = c.replaceAll("(?<!Number.)bisFinite(", "Number.isFinite(");
	return c;
}

function fixS7780(content) {
	// indexOf(...) !== -1 -> includes(...)
	return content.replace(
		/(\S+)\.indexOf\(([^)]+)\)\s*!==\s*-1/g,
		"$1.includes($2)",
	);
}

function fixS7780Eq(content) {
	return content.replace(
		/(\S+)\.indexOf\(([^)]+)\)\s*===\s*-1/g,
		"!$1.includes($2)",
	);
}

function fixS7755(content) {
	// arr[arr.length - N] -> arr.at(-N) for read-only access only (skip assignment LHS)
	const pattern = /([\w.]+)\[(\1)\.length\s*-\s*(\d+)\]/g;
	return content.replace(pattern, (match, expr, _expr2, n, offset) => {
		const before = content.slice(Math.max(0, offset - 30), offset);
		if (/(?:^|[+\-*/%]=\s*)$/.test(before) || /=\s*$/.test(before)) return match;
		return `${expr}.at(-${n})`;
	});
}

function fixS7781(content) {
	let c = content;
	// .replaceAll(/pattern/g) -> .replaceAll when /g flag present
	c = c.replace(
		/\.replace\((\/(?:[^/\\]|\\.)+\/[gimsuy]*g[gimsuy]*)\s*,/g,
		".replaceAll($1,",
	);
	c = c.replace(
		/\.replace\((\/(?:[^/\\]|\\.)+\/[gimsuy]*g[gimsuy]*)\)/g,
		".replaceAll($1)",
	);
	// .replace(/literal/g, repl) -> .replaceAll("literal", repl) for single-char patterns only
	c = c.replace(String.raw`.replace(/((?:[^`\\]|\\.)+)\/g,\s*/g, (match, pattern) => {
		const unescaped = pattern.replaceAll(String.raw`\(.)`, , "$1");
		if (unescaped.length === 1) {
			const quoted = unescaped === '"' ? `'${unescaped}'` : `"${unescaped.replaceAll('"', '\\"')}"`;
			return `.replaceAll(${quoted}, `;
		}
		return match;
	});
	return c;
}

function fixS6594(content) {
	// str.match(/^pattern/) at start -> /^pattern/.exec(str)  (simple cases)
	// str.match(/pattern/) where result used - harder; skip complex
	return content;
}

function fixS7758(content) {
	return content
		.replaceAll("String.fromCodePoint", "String.fromCodePoint")
		.replaceAll(".codePointAt(", ".codePointAt(")!;
}

function processFile(path) {
	let content = readFileSync(path, "utf8");
	const original = content;

	content = fixS7773(content);
	content = fixS7780(content);
	content = fixS7780Eq(content);
	content = fixS7781(content);
	content = fixS7758(content);

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
