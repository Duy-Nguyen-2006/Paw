import { describe, expect, test } from "vitest";
import {
	classifyPawRedaction,
	evaluatePawSandbox,
	evaluatePawUntrustedSource,
	isPawSecretPath,
	loadDefaultPawRuntimeConfig,
} from "../src/paw/index.ts";

describe("Paw security policy", () => {
	test("uses loaded default sandbox, secret, and injection security config", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(config.sandbox.preferred).toEqual(["bubblewrap_landlock", "bubblewrap_only", "userns_only"]);
		expect(config.sandbox.on_unavailable).toBe("refuse_write");
		expect(config.sandbox.network).toBe("default_deny");
		expect(config.sandbox.egress_allowlist).toEqual(["provider_hosts", "package_registries", "localhost"]);
		expect(config.secrets.read_plane_exclude).toEqual([".env*", "**/secrets/**", "**/*.pem", "**/*.key", "id_rsa*"]);
		expect(config.secrets.redact_at_io_write).toBe(true);
		expect(config.secrets.redact_patterns).toEqual([
			"env_values",
			"api_keys",
			"tokens",
			"cookies",
			"auth_headers",
			"private_keys",
		]);
		expect(config.secrets.flag_high_entropy).toBe(true);
		expect(config.injection.untrusted_sources).toEqual(["web", "readme", "issues", "comments", "logs", "browser"]);
		expect(config.injection.handling).toBe("read_only_subagent_structured_summary_only");
	});

	test("selects the first available sandbox primitive in configured order", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(
			evaluatePawSandbox({
				config: config.sandbox,
				availablePrimitives: ["userns_only", "bubblewrap_only"],
				riskLevel: "R1",
			}),
		).toMatchObject({
			status: "allow",
			selectedPrimitive: "bubblewrap_only",
			degraded: true,
		});
	});

	test("forces read-only when no sandbox is available for R0", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(
			evaluatePawSandbox({
				config: config.sandbox,
				availablePrimitives: [],
				riskLevel: "R0",
			}),
		).toMatchObject({
			status: "force_read_only",
			code: "SANDBOX_UNAVAILABLE",
			degraded: true,
		});
	});

	test("blocks R1 when no sandbox is available without unsafe override", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(
			evaluatePawSandbox({
				config: config.sandbox,
				availablePrimitives: [],
				riskLevel: "R1",
			}),
		).toMatchObject({
			status: "blocked",
			code: "SANDBOX_UNAVAILABLE",
			degraded: true,
		});
	});

	test("allows R1 without sandbox only with unsafe override and marks the decision", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(
			evaluatePawSandbox({
				config: config.sandbox,
				availablePrimitives: [],
				riskLevel: "R1",
				unsafeOverride: true,
			}),
		).toMatchObject({
			status: "allow",
			code: "SANDBOX_UNAVAILABLE",
			unsafeOverride: true,
			degraded: true,
		});
	});

	test("classifies configured secret paths", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(isPawSecretPath(".env", config.secrets)).toBe(true);
		expect(isPawSecretPath("apps/api/.env.local", config.secrets)).toBe(true);
		expect(isPawSecretPath("apps/api/secrets/prod.json", config.secrets)).toBe(true);
		expect(isPawSecretPath("certs/service.pem", config.secrets)).toBe(true);
		expect(isPawSecretPath("keys/service.key", config.secrets)).toBe(true);
		expect(isPawSecretPath("id_rsa_backup", config.secrets)).toBe(true);
		expect(isPawSecretPath("packages/coding-agent/src/paw/index.ts", config.secrets)).toBe(false);
	});

	test("redacts configured secret-like values", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(
			classifyPawRedaction("-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----", config.secrets),
		).toMatchObject({
			decision: "redact",
			patterns: ["private_keys"],
		});
		expect(classifyPawRedaction("Authorization: Bearer secret-token-value", config.secrets)).toMatchObject({
			decision: "redact",
			patterns: ["auth_headers"],
		});
		expect(classifyPawRedaction("Cookie: session_id=abc123; theme=dark", config.secrets)).toMatchObject({
			decision: "redact",
			patterns: ["cookies"],
		});
		expect(classifyPawRedaction("OPENAI_API_KEY=sk-test1234567890abcdef", config.secrets)).toMatchObject({
			decision: "redact",
			patterns: expect.arrayContaining(["env_values", "api_keys"]),
		});
		expect(classifyPawRedaction("token: ghp_1234567890abcdefghijklmnopqrstuvwxyz", config.secrets)).toMatchObject({
			decision: "redact",
			patterns: expect.arrayContaining(["tokens"]),
		});
		expect(classifyPawRedaction("plain implementation note", config.secrets)).toMatchObject({
			decision: "none",
			patterns: [],
		});
	});

	test("handles configured untrusted sources as read-only summaries", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(evaluatePawUntrustedSource("readme", config.injection)).toEqual({
			status: "read_only_summary",
			canElevateRisk: false,
			handling: "read_only_subagent_structured_summary_only",
		});
		expect(evaluatePawUntrustedSource("logs", config.injection)).toEqual({
			status: "read_only_summary",
			canElevateRisk: false,
			handling: "read_only_subagent_structured_summary_only",
		});
		expect(evaluatePawUntrustedSource("local", config.injection)).toEqual({
			status: "trusted",
			canElevateRisk: true,
		});
	});
});
