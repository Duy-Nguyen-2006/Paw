
import { describe, expect, test } from "vitest";
import { loadDefaultPawRuntimeConfig, type PawRuntimeConfig } from "../src/paw/index.ts";
import { evaluatePawToolRuntimeRequest, executePawToolRuntimePlan } from "../src/paw/tool-runtime.ts";

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

	describe("executePawToolRuntimePlan", () => {
		test("blocks execution when only dry-run approval exists", async () => {
			let executorCalled = false;
			const plan = {
				request: {
					toolName: "edit_file",
					riskLevel: "R1" as const,
					runMode: "json" as const,
					sandbox: { availablePrimitives: ["bubblewrap_landlock"] },
					paths: ["src/a.ts"],
				},
				description: "Edit a safe source file.",
				expectedFilesChanged: true,
			};

			const dryRun = evaluatePawToolRuntimeRequest({ config, request: plan.request });
			const execution = await executePawToolRuntimePlan({
				config,
				plan,
				executor: () => {
					executorCalled = true;
					return { exitCode: 0, filesChanged: true };
				},
			});

			expect(dryRun.status).toBe("dry_run_allowed");
			expect(execution.status).toBe("blocked");
			if (execution.status !== "blocked") return;
			expect(execution.code).toBe("EXECUTE_AUTHORIZATION_REQUIRED");
			expect(execution.executed).toBe(false);
			expect(executorCalled).toBe(false);
		});

		test("keeps default execution path non-mutating without an injected executor", async () => {
			const execution = await executePawToolRuntimePlan({
				config,
				plan: {
					request: {
						toolName: "edit_file",
						riskLevel: "R1",
						runMode: "json",
						sandbox: { availablePrimitives: ["bubblewrap_landlock"] },
						paths: ["src/a.ts"],
					},
					description: "Edit a safe source file.",
					expectedFilesChanged: true,
				},
				authorization: {
					status: "execute_authorized",
					toolName: "edit_file",
					riskLevel: "R1",
					source: "automatic_policy",
					reason: "Safe write authorized after runtime gates passed.",
				},
			});

			expect(execution.status).toBe("blocked");
			if (execution.status !== "blocked") return;
			expect(execution.code).toBe("EXECUTOR_REQUIRED");
			expect(execution.executed).toBe(false);
			expect(execution.filesChanged).toBe(false);
		});

		test("reports executor mutations when execution fails after invocation", async () => {
			const execution = await executePawToolRuntimePlan({
				config,
				plan: {
					request: {
						toolName: "edit_file",
						riskLevel: "R1",
						runMode: "json",
						sandbox: { availablePrimitives: ["bubblewrap_landlock"] },
						paths: ["src/a.ts"],
					},
					description: "Edit a safe source file.",
					expectedFilesChanged: true,
				},
				authorization: {
					status: "execute_authorized",
					toolName: "edit_file",
					riskLevel: "R1",
					source: "automatic_policy",
					reason: "Safe write authorized after runtime gates passed.",
				},
				executor: () => ({ exitCode: 1, stdout: "partial", stderr: "failed", filesChanged: true }),
			});

			expect(execution).toMatchObject({
				status: "blocked",
				code: "EXECUTOR_FAILED",
				executed: true,
				filesChanged: true,
				exitCode: 1,
				stdout: "partial",
				stderr: "failed",
			});
		});

		test("does not invent mutation signal when executor throws", async () => {
			const execution = await executePawToolRuntimePlan({
				config,
				plan: {
					request: {
						toolName: "edit_file",
						riskLevel: "R1",
						runMode: "json",
						sandbox: { availablePrimitives: ["bubblewrap_landlock"] },
						paths: ["src/a.ts"],
					},
					description: "Edit a safe source file.",
					expectedFilesChanged: true,
				},
				authorization: {
					status: "execute_authorized",
					toolName: "edit_file",
					riskLevel: "R1",
					source: "automatic_policy",
					reason: "Safe write authorized after runtime gates passed.",
				},
				executor: () => {
					throw new Error("executor crashed after entering tool runtime");
				},
			});

			expect(execution).toMatchObject({
				status: "blocked",
				code: "EXECUTOR_FAILED",
				executed: true,
				filesChanged: false,
				stderr: "executor crashed after entering tool runtime",
			});
		});

		test("invokes injected executor only after authorization and safety gates pass", async () => {
			let executorCalls = 0;
			const execution = await executePawToolRuntimePlan({
				config,
				plan: {
					request: {
						toolName: "edit_file",
						riskLevel: "R1",
						runMode: "json",
						sandbox: { availablePrimitives: ["bubblewrap_landlock"] },
						paths: ["src/a.ts"],
					},
					description: "Edit a safe source file.",
					expectedFilesChanged: true,
				},
				authorization: {
					status: "execute_authorized",
					toolName: "edit_file",
					riskLevel: "R1",
					source: "automatic_policy",
					reason: "Safe write authorized after runtime gates passed.",
				},
				executor: (input) => {
					executorCalls += 1;
					expect(input.sandboxPrimitive).toBe("bubblewrap_landlock");
					expect(input.approvedRequest.toolName).toBe("edit_file");
					return { exitCode: 0, stdout: "ok", filesChanged: true };
				},
			});

			expect(executorCalls).toBe(1);
			expect(execution).toMatchObject({
				status: "executed",
				executed: true,
				filesChanged: true,
				exitCode: 0,
				stdout: "ok",
			});
		});

		test("blocks secret and untrusted paths before executor invocation", async () => {
			for (const request of [
				{
					toolName: "read_file",
					riskLevel: "R0" as const,
					runMode: "json" as const,
					readOnly: true,
					paths: [".env"],
				},
				{
					toolName: "edit_file",
					riskLevel: "R1" as const,
					runMode: "json" as const,
					source: "web",
					sandbox: { availablePrimitives: ["bubblewrap_landlock"] },
					paths: ["src/a.ts"],
				},
			]) {
				let executorCalled = false;
				const execution = await executePawToolRuntimePlan({
					config,
					plan: { request, description: "Unsafe plan.", expectedFilesChanged: request.riskLevel !== "R0" },
					authorization: {
						status: "execute_authorized",
						toolName: request.toolName,
						riskLevel: request.riskLevel,
						source: "automatic_policy",
						reason: "Authorization cannot bypass safety gates.",
					},
					executor: () => {
						executorCalled = true;
						return { exitCode: 0, filesChanged: true };
					},
				});

				expect(execution.status).toBe("blocked");
				expect(executorCalled).toBe(false);
			}
		});

		test("blocks R7 execution without human approval before executor invocation", async () => {
			let executorCalled = false;
			const execution = await executePawToolRuntimePlan({
				config,
				plan: {
					request: {
						toolName: "rotate_auth_token",
						riskLevel: "R7",
						runMode: "interactive",
						sandbox: { availablePrimitives: ["bubblewrap_landlock"] },
						paths: ["src/auth/token.ts"],
					},
					description: "Rotate auth token.",
					expectedFilesChanged: true,
				},
				authorization: {
					status: "execute_authorized",
					toolName: "rotate_auth_token",
					riskLevel: "R7",
					source: "automatic_policy",
					reason: "Invalid automatic approval for sensitive execution.",
				},
				executor: () => {
					executorCalled = true;
					return { exitCode: 0, filesChanged: true };
				},
			});

			expect(execution.status).toBe("blocked");
			if (execution.status !== "blocked") return;
			expect(execution.code).toBe("NEEDS_USER_DECISION");
			expect(executorCalled).toBe(false);
		});

		test("requires sandbox or unsafe override before write-capable executor invocation", async () => {
			let blockedExecutorCalled = false;
			const blocked = await executePawToolRuntimePlan({
				config,
				plan: {
					request: { toolName: "edit_file", riskLevel: "R1", runMode: "json", paths: ["src/a.ts"] },
					description: "Edit without sandbox.",
					expectedFilesChanged: true,
				},
				authorization: {
					status: "execute_authorized",
					toolName: "edit_file",
					riskLevel: "R1",
					source: "automatic_policy",
					reason: "Safe write authorized after runtime gates passed.",
				},
				executor: () => {
					blockedExecutorCalled = true;
					return { exitCode: 0, filesChanged: true };
				},
			});
			let overrideExecutorCalled = false;
			const override = await executePawToolRuntimePlan({
				config,
				plan: {
					request: {
						toolName: "edit_file",
						riskLevel: "R1",
						runMode: "json",
						sandbox: { availablePrimitives: [], unsafeOverride: true },
						paths: ["src/a.ts"],
					},
					description: "Edit with explicit unsafe sandbox override.",
					expectedFilesChanged: true,
				},
				authorization: {
					status: "execute_authorized",
					toolName: "edit_file",
					riskLevel: "R1",
					source: "automatic_policy",
					reason: "Safe write authorized after runtime gates passed.",
				},
				executor: () => {
					overrideExecutorCalled = true;
					return { exitCode: 0, filesChanged: true };
				},
			});

			expect(blocked.status).toBe("blocked");
			if (blocked.status !== "blocked") return;
			expect(blocked.code).toBe("SANDBOX_UNAVAILABLE");
			expect(blockedExecutorCalled).toBe(false);
			expect(override.status).toBe("executed");
			expect(overrideExecutorCalled).toBe(true);
		});
	});
});
