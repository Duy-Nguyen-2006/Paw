
#!/usr/bin/env node
/**
 * Revert S7781 changes (.replace(/regex/g,...) -> .replace(/regex/g,...)).
 * The conversion moved the SonarQube issue from "use replaceAll" to a different
 * "use literal char" sub-message, doubling the count.
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
	// Revert: .replace(/foo/g, -> .replace(/foo/g,
	const re = /\.replaceAll\((\/(?:[^/\\]|\\.)+\/g),/g;
	content = content.replace(re, ".replace($1,");
	if (content !== original) {
		writeFileSync(path, content, "utf8");
		console.log("reverted S7781:", relative(ROOT, path));
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
