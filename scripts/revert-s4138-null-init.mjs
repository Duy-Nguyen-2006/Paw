#!/usr/bin/env node
/**
 * Revert S4138 changes (useless null literal).
 * Removing `= null` from let X: T | null = null; breaks TypeScript
 * strict mode, which tracks definite assignment.
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
	// Revert: let X: T | null; (without = null) -> let X: T | null = null;
	// This is the pattern I changed - find declarations like "let X: T | null;" on their own line
	// (no initializer) and add " = null"
	const re = /^(\s*)(let|const|var)\s+(\w+)\s*:\s*([^=;]+?\|\s*null)\s*;\s*$/gm;
	content = content.replace(re, "$1$2 $3: $4 = null;");
	if (content !== original) {
		writeFileSync(path, content, "utf8");
		console.log("reverted S4138:", relative(ROOT, path));
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
