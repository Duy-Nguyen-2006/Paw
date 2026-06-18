
#!/usr/bin/env node
/**
 * Revert S7758 changes (fromCodePoint/codePointAt -> fromCharCode/charCodeAt).
 * The auto-fix breaks TypeScript types because codePointAt returns
 * number | undefined vs charCodeAt which returns number.
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
	// Revert: .codePointAt( -> .codePointAt(
	content = content.replaceAll(".codePointAt(", ".codePointAt(")!;
	// Revert: .fromCodePoint( -> .fromCharCode(
	// This is more dangerous - skip for now, only revert codePointAt
	// content = content.replaceAll(".fromCodePoint(", ".fromCharCode(");
	if (content !== original) {
		writeFileSync(path, content, "utf8");
		console.log("reverted S7758:", relative(ROOT, path));
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
