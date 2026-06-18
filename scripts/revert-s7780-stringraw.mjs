#!/usr/bin/env node
/**
 * Revert S7780 changes (String.raw -> "\\\\X").
 * The S7780 fix introduced NEW S7781 issues saying "this pattern can be
 * replaced with a literal char", which doubled the S7781 count.
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

function processFile(path) {
	let content = readFileSync(path, "utf8");
	const original = content;
	// Revert the conservative String.raw conversions back to double-escaped string literals
	const map = {
		[String.raw`String.raw` + "`" + `\\s+` + "`"]: '"\\\\s+"',
		[String.raw`String.raw` + "`" + `\\s` + "`"]: '"\\\\s"',
		[String.raw`String.raw` + "`" + `\\d+` + "`"]: '"\\\\d+"',
		[String.raw`String.raw` + "`" + `\\d` + "`"]: '"\\\\d"',
		[String.raw`String.raw` + "`" + `\\w` + "`"]: '"\\\\w"',
		[String.raw`String.raw` + "`" + `\\b` + "`"]: '"\\\\b"',
		[String.raw`String.raw` + "`" + `\\n` + "`"]: '"\\\\n"',
		[String.raw`String.raw` + "`" + `\\r` + "`"]: '"\\\\r"',
		[String.raw`String.raw` + "`" + `\\t` + "`"]: '"\\\\t"',
	};
	for (const [from, to] of Object.entries(map)) {
		content = content.replaceAll(from, to);
	}
	if (content !== original) {
		writeFileSync(path, content, "utf8");
		console.log("reverted S7780:", relative(ROOT, path));
		return true;
	}
	return false;
}

const files = SOURCE_DIRS.flatMap((d) => walk(join(ROOT, d)));
let changed = 0;
for (const f of files) {
	if (processFile(f)) changed++;
}
console.log(`\nReverted ${changed} files`);
