/**
 * Path and ignore-rule helpers for package-manager (extracted for S3776).
 *
 * Provides small utilities used by both the main package-manager module
 * and its collection helpers, so the parent module can stay focused on
 * orchestration.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type ignore from "ignore";

type IgnoreMatcher = ReturnType<typeof ignore>;

const IGNORE_FILE_NAMES = [".gitignore", ".ignore", ".fdignore"];

/** Convert a platform path to a posix-style slash-separated path. */
export function toPosixPath(p: string): string {
	return p.split(sep).join("/");
}

/** Add ignore rules found in IGNORE_FILE_NAMES files in `dir` to the matcher. */
export function addIgnoreRules(ig: IgnoreMatcher, dir: string, rootDir: string): void {
	const relativeDir = relative(rootDir, dir);
	const prefix = relativeDir ? `${toPosixPath(relativeDir)}/` : "";

	for (const filename of IGNORE_FILE_NAMES) {
		const ignorePath = join(dir, filename);
		if (!existsSync(ignorePath)) continue;
		try {
			const content = readFileSync(ignorePath, "utf-8");
			const patterns = content
				.split(/\r?\n/)
				.map((line) => prefixIgnorePattern(line, prefix))
				.filter((line): line is string => Boolean(line));
			if (patterns.length > 0) {
				ig.add(patterns);
			}
		} catch {}
	}
}

function prefixIgnorePattern(line: string, prefix: string): string | null {
	const trimmed = line.trim();
	if (!trimmed) return null;
	if (trimmed.startsWith("#") && !trimmed.startsWith("\\#")) return null;

	let pattern = line;
	let negated = false;

	if (pattern.startsWith("!")) {
		negated = true;
		pattern = pattern.slice(1);
	} else if (pattern.startsWith("\\!")) {
		pattern = pattern.slice(1);
	}

	if (pattern.startsWith("/")) {
		pattern = pattern.slice(1);
	}

	const prefixed = prefix ? `${prefix}${pattern}` : pattern;
	return negated ? `!${prefixed}` : prefixed;
}
