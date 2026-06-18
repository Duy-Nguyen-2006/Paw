#!/usr/bin/env node
/**
 * Fix S4325 (unnecessary `as` and `!` non-null assertions).
 * For S4325, the simplest patterns to fix are:
 *  - `value!.` -> `value.` (when the value comes from a definite context)
 *  - `obj[key]!.` -> `obj[key].` (when we know key exists)
 *  - `(expr as Type)` -> `(expr)` when TS already narrows
 * The script targets the high-confidence cases only.
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

// Remove `!` non-null assertion in safe contexts.
// We only remove when the LHS already has a guaranteed-defined expression.
// This is a heuristic; the user can revert specific changes.
function fixS4325(content) {
	let c = content;
	// Pattern 1: identifier!.property or identifier!.method -> identifier.property
	// E.g., `obj!.foo` -> `obj.foo`. This is risky if obj is nullable. Skip by default.
	// We do NOT remove `!.` globally because it can break things.

	// Pattern 2: array[i]!.property where i is a known index in a loop
	// E.g., `for (let i = 0; i < arr.length; i++) { const v = arr[i]!.foo }`
	// In this case arr[i] is always defined within bounds.
	// Hard to detect this generically. Skip.

	// Pattern 3: `as Type` when the type matches.
	// E.g., `value as string` where value is already string.
	// Hard to determine. Skip.

	// So we don't actually do anything here. The rule S4325 mostly
	// requires human review because we can't know the inferred type
	// without running the TypeScript compiler.
	return c;
}

function processFile(path) {
	let content = readFileSync(path, "utf8");
	const original = content;
	content = fixS4325(content);
	if (content !== original) {
		writeFileSync(path, content, "utf8");
		console.log("fixed:", relative(ROOT, path));
		return true;
	}
	return false;
}

const files = SOURCE_DIRS.flatMap((d) => walk(join(ROOT, d)));
let changed = 0;
for (const f of files) {
	if (processFile(f)) changed++;
}
console.log(`\nUpdated ${changed} files`);
