#!/usr/bin/env node
/**
 * Revert broken S7755 changes (LHS .at() = assignment).
 * The S7755 fix in fix-sonar-safe.mjs converted some LHS expressions,
 * which is invalid because .at() returns a value, not a reference.
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
	// Revert: X.at(-N) = ...  -> X[X.length - N] = ...
	// Capture X (the expression) and N
	content = content.replace(/(\b[\w$.]+)\.at\(-(\d+)\)\s*([+\-*/%&|^]?=)/g, (match, expr, n, op) => {
		return `${expr}[${expr}.length - ${n}] ${op}`;
	});
	if (content !== original) {
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
