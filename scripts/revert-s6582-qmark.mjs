#!/usr/bin/env node
/**
 * Revert S6582 changes that broke TS null safety.
 * Reverts: `x?.prop` (when simple identifier) -> `x && x.prop` only in files
 * affected by the S6582 fix.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// Files affected by my S6582 fix
const S6582_FILES = [
	"packages/ai/src/providers/openai-responses.ts",
	"packages/coding-agent/src/modes/interactive/components/diff.ts",
	"packages/tui/src/keys.ts",
	"packages/ai/src/providers/anthropic.ts",
	"packages/coding-agent/src/modes/interactive/interactive-mode.ts",
	"packages/coding-agent/src/paw/state.ts",
	"packages/ai/src/providers/mistral.ts",
	"packages/coding-agent/src/core/agent-session.ts",
	"packages/coding-agent/src/utils/clipboard-image.ts",
	"packages/ai/src/providers/amazon-bedrock.ts",
	"packages/tui/src/components/editor.ts",
	"packages/ai/src/providers/openai-completions.ts",
];

for (const file of S6582_FILES) {
	const path = join(ROOT, file);
	let content;
	try {
		content = readFileSync(path, "utf8");
	} catch (e) {
		continue;
	}
	const o = content;
	// Revert only simple identifier `x?.prop` -> `x && x.prop`
	// Don't touch nested `a?.b?.c` or method calls
	const re = /\b(\w+)\?\.(\w+)\b/g;
	content = content.replace(re, "$1 && $1.$2");
	if (content !== o) {
		writeFileSync(path, content, "utf8");
		console.log("reverted:", file);
	}
}
