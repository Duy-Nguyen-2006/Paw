
import { isPawRiskAtLeast } from "./approval-policy.ts";
import type { PawRiskLevel, PawRuntimeConfig } from "./contracts.ts";

export type PawSandboxConfig = PawRuntimeConfig["sandbox"];
export type PawSecretsConfig = PawRuntimeConfig["secrets"];
export type PawInjectionConfig = PawRuntimeConfig["injection"];

export type PawSandboxBlockCode = "SANDBOX_UNAVAILABLE";
export type PawSandboxDecisionStatus = "allow" | "force_read_only" | "blocked";

export type PawSandboxEvaluationInput = {
	config: PawSandboxConfig;
	availablePrimitives: readonly string[];
	riskLevel: PawRiskLevel;
	unsafeOverride?: boolean;
};

export type PawSandboxDecision =
	| {
			status: "allow";
			selectedPrimitive: string;
			degraded: boolean;
			message: string;
	  }
	| {
			status: "allow";
			code: PawSandboxBlockCode;
			degraded: true;
			unsafeOverride: true;
			message: string;
	  }
	| {
			status: "force_read_only";
			code: PawSandboxBlockCode;
			degraded: true;
			message: string;
			suggestedAction: string;
	  }
	| {
			status: "blocked";
			code: PawSandboxBlockCode;
			degraded: true;
			riskLevel: PawRiskLevel;
			message: string;
			suggestedAction: string;
	  };

export type PawRedactionPattern =
	| "env_values"
	| "api_keys"
	| "tokens"
	| "cookies"
	| "auth_headers"
	| "private_keys"
	| "high_entropy";

export type PawRedactionDecision =
	| {
			decision: "none";
			patterns: readonly PawRedactionPattern[];
	  }
	| {
			decision: "redact";
			patterns: readonly PawRedactionPattern[];
			message: string;
	  };

export type PawUntrustedSourceDecision =
	| {
			status: "read_only_summary";
			canElevateRisk: false;
			handling: string;
	  }
	| {
			status: "trusted";
			canElevateRisk: true;
	  };

const HIGH_ENTROPY_MIN_LENGTH = 32;
const HIGH_ENTROPY_MIN_BITS_PER_CHAR = 3.5;

export function evaluatePawSandbox(input: PawSandboxEvaluationInput): PawSandboxDecision {
	const selectedPrimitive = input.config.preferred.find((primitive) => input.availablePrimitives.includes(primitive));

	if (selectedPrimitive !== undefined) {
		return {
			status: "allow",
			selectedPrimitive,
			degraded: selectedPrimitive !== input.config.preferred[0],
			message:
				selectedPrimitive === input.config.preferred[0]
					? `Selected preferred sandbox primitive ${selectedPrimitive}.`
					: `Selected fallback sandbox primitive ${selectedPrimitive}.`,
		};
	}

	if (input.unsafeOverride === true) {
		return {
			status: "allow",
			code: "SANDBOX_UNAVAILABLE",
			degraded: true,
			unsafeOverride: true,
			message:
				"No configured sandbox primitive is available; unsafe override permits writes with reduced guarantees.",
		};
	}

	if (isPawRiskAtLeast(input.riskLevel, "R1")) {
		return {
			status: "blocked",
			code: "SANDBOX_UNAVAILABLE",
			degraded: true,
			riskLevel: input.riskLevel,
			message: `No configured sandbox primitive is available; ${input.riskLevel} writes are blocked.`,
			suggestedAction:
				"Enable bubblewrap/Landlock or user namespaces, rerun read-only, or pass --no-sandbox-i-understand.",
		};
	}

	return {
		status: "force_read_only",
		code: "SANDBOX_UNAVAILABLE",
		degraded: true,
		message: "No configured sandbox primitive is available; R0 may continue only in read-only mode.",
		suggestedAction: "Enable a sandbox primitive before attempting writes.",
	};
}

export function isPawSecretPath(path: string, config: PawSecretsConfig): boolean {
	const normalizedPath = normalizePath(path);

	return config.read_plane_exclude.some((pattern) => matchesSecretPattern(normalizedPath, pattern));
}

function collectConfiguredRedactionPatterns(value: string, config: PawSecretsConfig): PawRedactionPattern[] {
	const patterns: PawRedactionPattern[] = [];

	if (isConfiguredRedactionPattern("private_keys", config) && /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)) {
		patterns.push("private_keys");
	}
	if (
		isConfiguredRedactionPattern("auth_headers", config) &&
		/(?:^|\n)\s*(?:authorization|proxy-authorization)\s*:/i.test(value)
	) {
		patterns.push("auth_headers");
	}
	if (isConfiguredRedactionPattern("cookies", config) && /(?:^|\n)\s*(?:cookie|set-cookie)\s*:/i.test(value)) {
		patterns.push("cookies");
	}
	if (
		isConfiguredRedactionPattern("env_values", config) &&
		/(?:^|\n)\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*["']?[^\s"'][^\n]*/.test(value)
	) {
		patterns.push("env_values");
	}
	if (isConfiguredRedactionPattern("api_keys", config) && hasApiKeyLikeValue(value)) {
		patterns.push("api_keys");
	}

	return patterns;
}

export function classifyPawRedaction(value: string, config: PawSecretsConfig): PawRedactionDecision {
	if (!config.redact_at_io_write) {
		return { decision: "none", patterns: [] };
	}

	const patterns = collectConfiguredRedactionPatterns(value, config);

	if (isConfiguredRedactionPattern("tokens", config) && hasTokenLikeValue(value)) {
		patterns.push("tokens");
	}

	if (patterns.length === 0 && config.flag_high_entropy && hasHighEntropyToken(value)) {
		patterns.push("high_entropy");
	}

	if (patterns.length === 0) {
		return { decision: "none", patterns };
	}

	return {
		decision: "redact",
		patterns,
		message: `Value matched Paw redaction pattern(s): ${patterns.join(", ")}.`,
	};
}

export function evaluatePawUntrustedSource(source: string, config: PawInjectionConfig): PawUntrustedSourceDecision {
	if (config.untrusted_sources.includes(source)) {
		return {
			status: "read_only_summary",
			canElevateRisk: false,
			handling: config.handling,
		};
	}

	return {
		status: "trusted",
		canElevateRisk: true,
	};
}

function normalizePath(path: string): string {
	return path.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function matchesSecretPattern(path: string, pattern: string): boolean {
	const normalizedPattern = normalizePath(pattern);
	const basename = path.split("/").at(-1) ?? path;

	if (normalizedPattern === "**/secrets/**") {
		return path === "secrets" || path.startsWith("secrets/") || path.includes("/secrets/");
	}

	if (normalizedPattern === "**/*.pem") {
		return basename.endsWith(".pem");
	}

	if (normalizedPattern === "**/*.key") {
		return basename.endsWith(".key");
	}

	if (normalizedPattern === ".env*") {
		return basename.startsWith(".env");
	}

	if (normalizedPattern === "id_rsa*") {
		return basename.startsWith("id_rsa");
	}

	return globPatternToRegExp(normalizedPattern).test(path);
}

function globPatternToRegExp(pattern: string): RegExp {
	let source = "^";

	for (let index = 0; index < pattern.length; index += 1) {
		const char = pattern[index];
		const next = pattern[index + 1];

		if (char === "*" && next === "*") {
			source += ".*";
			index += 1;
		} else if (char === "*") {
			source += "[^/]*";
		} else {
			source += escapeRegExp(char);
		}
	}

	return new RegExp(`${source}$`);
}

function escapeRegExp(value: string): string {
	return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function isConfiguredRedactionPattern(
	pattern: Exclude<PawRedactionPattern, "high_entropy">,
	config: PawSecretsConfig,
): boolean {
	return config.redact_patterns.includes(pattern);
}

function hasApiKeyLikeValue(value: string): boolean {
	return (
		/(?:api[_-]?key|apikey|secret[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9._-]{12,}/i.test(value) ||
		/\bsk-[A-Za-z0-9_-]{12,}\b/.test(value)
	);
}

function hasTokenLikeValue(value: string): boolean {
	return (
		/(?:^|[\s{,])(?:access[_-]?token|refresh[_-]?token|id[_-]?token|token)\s*[:=]\s*["']?[A-Za-z0-9._-]{12,}/i.test(
			value,
		) || /\b(?:ghp|github_pat|glpat|xox[baprs])_[A-Za-z0-9_-]{16,}\b/.test(value)
	);
}

function hasHighEntropyToken(value: string): boolean {
	return value
		.split(/\s+/)
		.some((token) => isHighEntropyCandidate(token) && shannonEntropy(token) >= HIGH_ENTROPY_MIN_BITS_PER_CHAR);
}

function isHighEntropyCandidate(token: string): boolean {
	if (token.length < HIGH_ENTROPY_MIN_LENGTH) {
		return false;
	}

	if (!/^[A-Za-z0-9+/=_-]+$/.test(token)) {
		return false;
	}

	return /[A-Z]/.test(token) && /[a-z]/.test(token) && /\d/.test(token);
}

function shannonEntropy(value: string): number {
	const counts = new Map<string, number>();

	for (const char of value) {
		counts.set(char, (counts.get(char) ?? 0) + 1);
	}

	let entropy = 0;
	for (const count of counts.values()) {
		const probability = count / value.length;
		entropy -= probability * Math.log2(probability);
	}

	return entropy;
}
