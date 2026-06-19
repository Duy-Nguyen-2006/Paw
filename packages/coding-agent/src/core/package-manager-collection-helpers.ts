/**
 * Collection helpers for package-manager (extracted for S3776).
 *
 * Provides per-entry predicates and processors used by the recursive
 * directory walkers in package-manager.ts. Each helper is a focused
 * pure function so the walkers can delegate branching logic without
 * inflating their own cognitive complexity.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type ignore from "ignore";
import { toPosixPath } from "./package-manager-paths-helpers.ts";

type IgnoreMatcher = ReturnType<typeof ignore>;
type DirEntry = {
	name: string;
	isSymbolicLink(): boolean;
	isDirectory(): boolean;
	isFile(): boolean;
};
type FileEntry = {
	name: string;
	isSymbolicLink(): boolean;
	isFile(): boolean;
};
type Dirent = DirEntry;

export type SkillDiscoveryMode = "pi" | "agents";

export type DirEntryKind = { isDir: boolean; isFile: boolean };

/**
 * Top-level entries that should be skipped: dot files and (optionally) node_modules.
 */
export function shouldSkipTopLevelEntry(name: string, skipNodeModules: boolean): boolean {
	if (name.startsWith(".")) return true;
	if (skipNodeModules && name === "node_modules") return true;
	return false;
}

/**
 * Resolve the effective kind (file/dir) of a directory entry, following
 * symlinks via stat. Returns null when stat fails on a symlink.
 */
export function resolveDirEntryKind(entry: DirEntry, fullPath: string): DirEntryKind | null {
	if (!entry.isSymbolicLink()) {
		return { isDir: entry.isDirectory(), isFile: entry.isFile() };
	}
	try {
		const stats = statSync(fullPath);
		return { isDir: stats.isDirectory(), isFile: stats.isFile() };
	} catch {
		return null;
	}
}

/**
 * Resolve whether a directory entry is a file (following symlinks via stat).
 * Returns false when stat fails on a symlink.
 */
export function resolveIsFile(entry: FileEntry, fullPath: string): boolean {
	if (!entry.isSymbolicLink()) return entry.isFile();
	try {
		return statSync(fullPath).isFile();
	} catch {
		return false;
	}
}

/**
 * Build the ignore-check path for an entry: directories carry a trailing slash.
 */
export function buildIgnorePath(relPath: string, isDir: boolean): string {
	return isDir ? `${relPath}/` : relPath;
}

/**
 * Read a directory's entries (or return null on error/missing).
 * Centralises the try/catch so callers stay simple.
 */
export function readDirEntriesOrNull(dir: string): Dirent[] | null {
	if (!existsSync(dir)) return null;
	try {
		return readdirSync(dir, { withFileTypes: true }) as Dirent[];
	} catch {
		return null;
	}
}

/**
 * Compute the relative posix path of an entry from a root.
 */
export function entryRelPath(root: string, fullPath: string): string {
	return toPosixPath(relative(root, fullPath));
}

/**
 * Find the SKILL.md marker file in a directory, if present and not ignored.
 * Returns the absolute path of the file, or null when not found.
 */
export function findSkillMarkerInDir(
	dir: string,
	dirEntries: FileEntry[],
	root: string,
	ig: IgnoreMatcher,
): string | null {
	for (const entry of dirEntries) {
		if (entry.name !== "SKILL.md") continue;
		const fullPath = join(dir, entry.name);
		if (!resolveIsFile(entry, fullPath)) continue;
		const relPath = entryRelPath(root, fullPath);
		if (ig.ignores(relPath)) continue;
		return fullPath;
	}
	return null;
}

/**
 * Process a single sub-entry of a skill directory. Returns the entries
 * to add (may be empty) for the current entry, which can be a recursive
 * descent into a subdirectory or a flat .md file in pi mode at the root.
 */
export function processSkillSubentry(
	entry: DirEntry,
	dir: string,
	mode: SkillDiscoveryMode,
	root: string,
	ig: IgnoreMatcher,
): string[] {
	if (shouldSkipTopLevelEntry(entry.name, true)) return [];

	const fullPath = join(dir, entry.name);
	const kind = resolveDirEntryKind(entry, fullPath);
	if (!kind) return [];

	const relPath = entryRelPath(root, fullPath);
	if (mode === "pi" && dir === root && kind.isFile && entry.name.endsWith(".md") && !ig.ignores(relPath)) {
		return [fullPath];
	}

	if (!kind.isDir) return [];
	if (ig.ignores(`${relPath}/`)) return [];
	// Subdirs are walked recursively by the caller; nothing to add here.
	return [];
}

/**
 * Process a single sub-entry of a generic recursive files walker. Returns
 * the entries to add (or empty array) — directories are recursed by the
 * caller so this helper only yields matching files.
 */
export function processFilesSubentry(
	entry: DirEntry,
	dir: string,
	root: string,
	ig: IgnoreMatcher,
	filePattern: RegExp,
	skipNodeModules: boolean,
): { fullPath: string } | { recurseDir: string } | null {
	if (shouldSkipTopLevelEntry(entry.name, skipNodeModules)) return null;
	const fullPath = join(dir, entry.name);
	const kind = resolveDirEntryKind(entry, fullPath);
	if (!kind) return null;
	const relPath = entryRelPath(root, fullPath);
	if (ig.ignores(buildIgnorePath(relPath, kind.isDir))) return null;
	if (kind.isDir) return { recurseDir: fullPath };
	if (kind.isFile && filePattern.test(entry.name)) return { fullPath };
	return null;
}

/**
 * Process a single sub-entry of a flat (non-recursive) directory walker
 * used by collectDirEntries for prompts/themes.
 */
export function processFlatDirSubentry(
	entry: FileEntry,
	dir: string,
	ig: IgnoreMatcher,
	accept: (entryName: string, isFile: boolean) => boolean,
): string | null {
	if (shouldSkipTopLevelEntry(entry.name, true)) return null;
	const fullPath = join(dir, entry.name);
	if (!resolveIsFile(entry, fullPath)) return null;
	const relPath = entryRelPath(dir, fullPath);
	if (ig.ignores(relPath)) return null;
	if (accept(entry.name, true)) return fullPath;
	return null;
}
