import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { classifyPawRedaction, type PawRedactionPattern, type PawSecretsConfig } from "./security-policy.ts";

export type PawSecretScanSeverity = "info" | "warn" | "block";

export interface PawSecretScanFinding {
	pattern: PawRedactionPattern;
	severity: PawSecretScanSeverity;
	preview: string;
	path: string;
	occurrences: number;
}

export interface PawSecretScanResult {
	ok: boolean;
	blocked: boolean;
	scannedFiles: number;
	findings: PawSecretScanFinding[];
}

const BINARY_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2", ".ttf", ".otf", ".zip", ".tar", ".gz", ".pdf", ".mp4", ".mov"]);

const ALLOWED_DUMMY_KEYS = new Set([
	"PAW_PLACEHOLDER_OPENAI_KEY_xxxxxxxxxxxx",
	"PAW_PLACEHOLDER_GITHUB_TOKEN_xxxxxxxx",
	"PAW_PLACEHOLDER_SLACK_TOKEN_xxxxxx",
]);

const SKIP_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	".next",
	".venv",
	"__pycache__",
	".paw",
]);

export async function scanPawRepoForSecrets(
	repoRoot: string,
	config: PawSecretsConfig,
	options: { maxFiles?: number; maxBytesPerFile?: number } = {},
): Promise<PawSecretScanResult> {
	const root = resolve(repoRoot);
	const findings: PawSecretScanFinding[] = [];
	let scannedFiles = 0;
	const maxFiles = options.maxFiles ?? 5000;
	const maxBytes = options.maxBytesPerFile ?? 256 * 1024;

	if (!existsSync(root)) {
		return { ok: true, blocked: false, scannedFiles: 0, findings: [] };
	}

	const queue: string[] = [root];
	while (queue.length > 0 && scannedFiles < maxFiles) {
		const current = queue.shift();
		if (current === undefined) break;
		const rel = relative(root, current);
		if (rel.split(/[/\\]/).some((segment) => SKIP_DIRS.has(segment))) continue;

		let entries: string[];
		try {
			entries = await readdirSafe(current);
		} catch {
			continue;
		}
		for (const entry of entries) {
			const entryPath = join(current, entry);
			const entryRel = relative(root, entryPath);
			try {
				const stat = await statSafe(entryPath);
				if (!stat) continue;
				if (stat.isDirectory()) {
					if (entryRel.split(/[/\\]/).some((segment) => SKIP_DIRS.has(segment))) continue;
					queue.push(entryPath);
					continue;
				}
				if (!stat.isFile()) continue;
				if (extname(entry).toLowerCase() === ".lock") continue;
				if (BINARY_EXTENSIONS.has(extname(entry).toLowerCase())) continue;
				if (stat.size > maxBytes) continue;
				const content = await readFile(entryPath, "utf-8").catch(() => "");
				if (content.length === 0) continue;
				scannedFiles += 1;
				const detected = detectPawSecretPatterns(content, config);
				for (const pattern of detected) {
					findings.push({
						pattern,
						severity: pattern === "private_keys" ? "block" : "warn",
						preview: previewSecretMatch(content, pattern),
						path: entryRel,
						occurrences: countPawSecretOccurrences(content, pattern),
					});
				}
			} catch {
				continue;
			}
		}
	}
	const blocked = findings.some((finding) => finding.severity === "block");
	return { ok: findings.length === 0, blocked, scannedFiles, findings };
}

async function readdirSafe(path: string): Promise<string[]> {
	const { readdir } = await import("node:fs/promises");
	try {
		return await readdir(path);
	} catch {
		return [];
	}
}

async function statSafe(path: string): Promise<{ isDirectory: () => boolean; isFile: () => boolean; size: number } | null> {
	const { stat } = await import("node:fs/promises");
	try {
		return await stat(path);
	} catch {
		return null;
	}
}

function detectPawSecretPatterns(content: string, config: PawSecretsConfig): PawRedactionPattern[] {
	const decision = classifyPawRedaction(content, config);
	return decision.decision === "redact" ? [...decision.patterns] : [];
}

function countPawSecretOccurrences(content: string, pattern: PawRedactionPattern): number {
	const regex = secretPatternToRegex(pattern);
	if (!regex) return 1;
	const matches = content.match(new RegExp(regex.source, "g" + regex.flags.replace("g", "")));
	return matches ? matches.length : 0;
}

function previewSecretMatch(content: string, pattern: PawRedactionPattern): string {
	const regex = secretPatternToRegex(pattern);
	if (!regex) return `${pattern}: <redacted>`;
	const match = content.match(regex);
	if (!match) return `${pattern}: <redacted>`;
	const value = match[0];
	if (ALLOWED_DUMMY_KEYS.has(value)) return `${pattern}: <allowed dummy>`;
	return `${pattern}: ${value.slice(0, 6)}…${value.slice(-4)} (${value.length} chars)`;
}

function secretPatternToRegex(pattern: PawRedactionPattern): RegExp | null {
	switch (pattern) {
		case "api_keys":
			return /\bsk-[A-Za-z0-9_-]{12,}\b|(?:api[_-]?key|apikey|secret[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9._-]{12,}/i;
		case "tokens":
			return /\b(?:ghp|github_pat|glpat|xox[baprs])_[A-Za-z0-9_-]{16,}\b|(?:access[_-]?token|refresh[_-]?token|id[_-]?token|token)\s*[:=]\s*["']?[A-Za-z0-9._-]{12,}/i;
		case "private_keys":
			return /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
		case "auth_headers":
			return /(?:^|\n)\s*(?:authorization|proxy-authorization)\s*:/i;
		case "cookies":
			return /(?:^|\n)\s*(?:cookie|set-cookie)\s*:/i;
		case "env_values":
			return /(?:^|\n)\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*["']?[^\s"'][^\n]*/;
		case "high_entropy":
			return /[A-Za-z0-9+/=_-]{32,}/;
	}
}

export function isAllowedDummyKey(value: string): boolean {
	return ALLOWED_DUMMY_KEYS.has(value);
}
