import { describe, expect, test } from "vitest";
import { loadDefaultPawRuntimeConfig, type PawRuntimeConfig } from "../src/paw/index.ts";
import { evaluatePawToolRuntimeRequest } from "../src/paw/tool-runtime.ts";

const config: PawRuntimeConfig = loadDefaultPawRuntimeConfig(process.cwd());

describe("evaluatePawToolRuntimeRequest", () => {
	test("allows R0 read-only requests for dry-run inspection", () => {
		const decision = evaluatePawToolRuntimeRequest({
			config,
			request: { toolName: "read_file", riskLevel: "R0", runMode: "json", readOnly: true, paths: ["src/a.ts"] },
		});

		expect(decision).toEqual({
			status: "dry_run_allowed",
			toolName: "read_file",
			riskLevel: "R0",
			executed: false,
			filesChanged: false,
			message: "Paw tool request is allowed for dry-run inspection only.",
			degraded: false,
		});
	});

	test("blocks write-risk tools in read-only mode", () => {
		const decision = evaluatePawToolRuntimeRequest({
			config,
			request: { toolName: "edit_file", riskLevel: "R1", runMode: "json", readOnly: true, paths: ["src/a.ts"] },
		});

		expect(decision.status).toBe("blocked");
		if (decision.status !== "blocked") return;
		expect(decision.code).toBe("TOOL_PERMISSION");
		expect(decision.executed).toBe(false);
		expect(decision.filesChanged).toBe(false);
		expect(decision.message).toContain("Read-only mode blocks R1");
	});

	test("requires exact explicit allow for non-interactive approval risks", () => {
		const blocked = evaluatePawToolRuntimeRequest({
			config,
			request: { toolName: "install_dep", riskLevel: "R3", runMode: "ci", paths: ["package.json"] },
		});
		const allowed = evaluatePawToolRuntimeRequest({
			config,
			request: {
				toolName: "install_dep",
				riskLevel: "R3",
				runMode: "ci",
				allowedRiskLevels: ["R3"],
				sandbox: { availablePrimitives: ["bubblewrap_only"] },
				paths: ["package.json"],
			},
		});

		expect(blocked.status).toBe("blocked");
		if (blocked.status !== "blocked") return;
		expect(blocked.code).toBe("TOOL_PERMISSION");
		expect(allowed.status).toBe("dry_run_allowed");
		if (allowed.status !== "dry_run_allowed") return;
		expect(allowed.executed).toBe(false);
		expect(allowed.sandboxPrimitive).toBe("bubblewrap_only");
	});

	test("blocks R7 in non-interactive modes even with explicit allow", () => {
		const decision = evaluatePawToolRuntimeRequest({
			config,
			request: {
				toolName: "read_secret",
				riskLevel: "R7",
				runMode: "ci",
				allowedRiskLevels: ["R7"],
				paths: ["src/a.ts"],
			},
		});

		expect(decision.status).toBe("blocked");
		if (decision.status !== "blocked") return;
		expect(decision.code).toBe("TOOL_PERMISSION");
		expect(decision.message).toContain("cannot be pre-authorized");
	});

	test("blocks write-capable requests when no configured sandbox primitive is available", () => {
		const decision = evaluatePawToolRuntimeRequest({
			config,
			request: { toolName: "edit_file", riskLevel: "R1", runMode: "json", paths: ["src/a.ts"] },
		});

		expect(decision.status).toBe("blocked");
		if (decision.status !== "blocked") return;
		expect(decision.code).toBe("SANDBOX_UNAVAILABLE");
		expect(decision.message).toContain("writes are blocked");
	});

	test("allows write-capable requests only as dry-run when sandbox primitive is available", () => {
		const decision = evaluatePawToolRuntimeRequest({
			config,
			request: {
				toolName: "edit_file",
				riskLevel: "R1",
				runMode: "json",
				sandbox: { availablePrimitives: ["bubblewrap_landlock"] },
				paths: ["src/a.ts"],
			},
		});

		expect(decision).toEqual({
			status: "dry_run_allowed",
			toolName: "edit_file",
			riskLevel: "R1",
			executed: false,
			filesChanged: false,
			message: "Selected preferred sandbox primitive bubblewrap_landlock.",
			sandboxPrimitive: "bubblewrap_landlock",
			degraded: false,
		});
	});

	test("blocks requests touching configured secret paths", () => {
		for (const path of [".env", "secrets/api.txt", "keys/id_rsa_prod", "cert.pem", "private.key"]) {
			const decision = evaluatePawToolRuntimeRequest({
				config,
				request: { toolName: "read_file", riskLevel: "R0", runMode: "json", readOnly: true, paths: [path] },
			});

			expect(decision.status).toBe("blocked");
			if (decision.status !== "blocked") return;
			expect(decision.code).toBe("SECRET_PATH");
			expect(decision.executed).toBe(false);
			expect(decision.filesChanged).toBe(false);
		}
	});

	test("blocks write-capable requests from untrusted sources", () => {
		const blocked = evaluatePawToolRuntimeRequest({
			config,
			request: {
				toolName: "edit_file",
				riskLevel: "R1",
				runMode: "json",
				source: "web",
				sandbox: { availablePrimitives: ["bubblewrap_only"] },
				paths: ["src/a.ts"],
			},
		});
		const allowedReadOnly = evaluatePawToolRuntimeRequest({
			config,
			request: {
				toolName: "read_file",
				riskLevel: "R0",
				runMode: "json",
				readOnly: true,
				source: "web",
				paths: ["src/a.ts"],
			},
		});

		expect(blocked.status).toBe("blocked");
		if (blocked.status !== "blocked") return;
		expect(blocked.code).toBe("UNTRUSTED_SOURCE");
		expect(allowedReadOnly.status).toBe("dry_run_allowed");
	});

	test("returns invalid for malformed requests", () => {
		const decision = evaluatePawToolRuntimeRequest({
			config,
			request: { toolName: " ", riskLevel: "R0", runMode: "json", readOnly: true, paths: [""] },
		});

		expect(decision).toEqual({
			status: "invalid",
			code: "INVALID_TOOL_REQUEST",
			executed: false,
			filesChanged: false,
			message: "Paw tool runtime request is invalid.",
			issues: [
				{ path: "/toolName", message: "Expected non-empty tool name." },
				{ path: "/paths/0", message: "Expected non-empty path." },
			],
		});
	});
});
