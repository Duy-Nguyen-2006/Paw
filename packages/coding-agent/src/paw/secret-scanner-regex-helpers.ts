/**
 * Secret pattern regex helpers (extracted from secret-scanner.ts for S3776).
 */

import type { PawRedactionPattern } from "./security-policy.ts";

export function secretPatternToRegex(pattern: PawRedactionPattern): RegExp | null {
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
