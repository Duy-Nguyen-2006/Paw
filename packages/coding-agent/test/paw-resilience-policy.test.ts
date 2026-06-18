
import { describe, expect, test } from "vitest";
import {
	createPawDegradedStep,
	evaluatePawLlmFailure,
	evaluatePawLoopCap,
	evaluatePawSubAgentTimeout,
	evaluatePawToolTimeout,
	evaluatePawVerifyGate,
	loadDefaultPawRuntimeConfig,
} from "../src/paw/index.ts";

describe("Paw resilience and liveness policy", () => {
	test("uses loaded default resilience limits", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(config.resilience.llm_call.timeout_sec).toBe(60);
		expect(config.resilience.llm_call.retries).toBe(3);
		expect(config.resilience.tool_call.timeout_sec).toBe(120);
		expect(config.resilience.subagent.wall_clock_sec).toBe(180);
		expect(config.resilience.loop_caps.max_subagent_iterations).toBe(6);
	});

	test.each(["rate_limit", "server_error"] as const)("%s before max retries returns retry", (failureKind) => {
		const config = loadDefaultPawRuntimeConfig();

		expect(
			evaluatePawLlmFailure({
				failureKind,
				attemptNumber: config.resilience.llm_call.retries - 1,
				config: config.resilience,
			}),
		).toMatchObject({
			status: "retry",
			backoff: "exponential_jitter",
		});
	});

	test.each(["rate_limit", "server_error"] as const)("%s at max retries returns failover", (failureKind) => {
		const config = loadDefaultPawRuntimeConfig();

		expect(
			evaluatePawLlmFailure({
				failureKind,
				attemptNumber: config.resilience.llm_call.retries,
				config: config.resilience,
			}),
		).toMatchObject({
			status: "failover",
			degraded: true,
		});
	});

	test("all providers down returns blocked provider unavailable with suggested action", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(
			evaluatePawLlmFailure({
				failureKind: "all_providers_down",
				attemptNumber: 0,
				config: config.resilience,
			}),
		).toMatchObject({
			status: "blocked",
			code: "PROVIDER_UNAVAILABLE",
			suggestedAction: expect.stringContaining("provider"),
		});
	});

	test("tool timeout blocks with configured kill behavior", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(evaluatePawToolTimeout(config.resilience)).toMatchObject({
			status: "blocked",
			code: "TOOL_TIMEOUT",
			timeoutSec: 120,
			killOnTimeout: true,
			message: expect.stringContaining("120"),
			suggestedAction: expect.stringContaining("kill_on_timeout=true"),
		});
	});

	test("subagent timeout blocks with configured wall clock", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(evaluatePawSubAgentTimeout(config.resilience)).toMatchObject({
			status: "blocked",
			code: "SUBAGENT_TIMEOUT",
			timeoutSec: 180,
			message: expect.stringContaining("180"),
		});
	});

	test("loop count below cap continues", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(
			evaluatePawLoopCap({
				iterationCount: config.resilience.loop_caps.max_subagent_iterations - 1,
				plannerPosition: "Planner says slice is ready.",
				reviewerPosition: "Reviewer still needs tests.",
				config: config.resilience,
			}),
		).toMatchObject({
			status: "continue",
		});
	});

	test("loop count at cap blocks with both positions guidance", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(
			evaluatePawLoopCap({
				iterationCount: config.resilience.loop_caps.max_subagent_iterations,
				plannerPosition: "Planner says slice is ready.",
				reviewerPosition: "Reviewer still needs tests.",
				config: config.resilience,
			}),
		).toMatchObject({
			status: "blocked",
			code: "LOOP_CAP_EXCEEDED",
			message: expect.stringContaining("planner"),
			suggestedAction: expect.stringContaining("reviewer"),
		});
	});

	test("degraded step marker sets degraded true and includes reason", () => {
		expect(
			createPawDegradedStep({
				step: "worker",
				reason: "failover to lower tier after provider retries",
			}),
		).toEqual({
			step: "worker",
			degraded: true,
			reason: "failover to lower tier after provider retries",
		});
	});

	test("unavailable verification gate returns unverified with reason", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(
			evaluatePawVerifyGate({
				gate: "unit_tests",
				available: false,
				reason: "vitest binary unavailable",
				config: config.verify,
			}),
		).toMatchObject({
			status: "unverified",
			verified: false,
			applicable: true,
			reason: "vitest binary unavailable",
		});
	});

	test("available verification gate returns verified and applicable", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(
			evaluatePawVerifyGate({
				gate: "unit_tests",
				available: true,
				config: config.verify,
			}),
		).toMatchObject({
			status: "verified",
			verified: true,
			applicable: true,
			gateSet: "v1",
		});
	});
});
