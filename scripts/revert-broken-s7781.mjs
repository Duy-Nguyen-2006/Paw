
#!/usr/bin/env node
/**
 * Revert broken S7781 changes that have extra closing parens.
 * Pattern: .replace(/regex/g, "literal") -> .replace(/regex/g, "literal")
 * (the second ) is the original that we accidentally duplicated)
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

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
	const o = content;
	// Match: .replace(/regex/g, "literal")  (extra closing paren)
	// Replace with: .replace(/regex/g, "literal")
	const re1 = /\.replaceAll\((\/[^/\\]*(?:\\.[^/\\]*)*\/[gimsuy]+),\s*"([^"\\]*(?:\\.[^"\\]*)*)"\)\)/g;
	content = content.replace(re1, ".replace($1, \"$2\")");
	const re2 = /\.replaceAll\((\/[^/\\]*(?:\\.[^/\\]*)*\/[gimsuy]+),\s*'([^'\\]*(?:\\.[^'\\]*)*)'\)\)/g;
	content = content.replace(re2, ".replace($1, '$2')");
	if (content !== o) {
		writeFileSync(path, content, "utf8");
		console.log("reverted:", relative(ROOT, path));
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
