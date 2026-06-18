
import { describe, expect, test } from "vitest";
import {
	computePawBudgetUtilizationPct,
	evaluatePawSliceBudget,
	evaluatePawTaskBudget,
	loadDefaultPawRuntimeConfig,
} from "../src/paw/index.ts";

describe("Paw runtime budget policy", () => {
	test("uses loaded default task budget limits", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(config.budget.per_task.trivial).toEqual({
			max_usd: 0.1,
			max_tokens: 40_000,
			warn_at_pct: 70,
		});
		expect(config.budget.per_task.standard).toEqual({
			max_usd: 0.75,
			max_tokens: 250_000,
			warn_at_pct: 70,
		});
		expect(config.budget.per_task.high_risk).toEqual({
			max_usd: 3,
			max_tokens: 1_200_000,
			warn_at_pct: 60,
		});
	});

	test("computes utilization as the maximum of token and USD utilization", () => {
		expect(
			computePawBudgetUtilizationPct({
				tokensUsed: 20,
				maxTokens: 100,
				usdUsed: 0.8,
				maxUsd: 2,
			}),
		).toBe(40);
	});

	test("returns within_budget below the warn threshold", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(
			evaluatePawTaskBudget({
				taskClass: "trivial",
				runMode: "interactive",
				tokensUsed: 27_999,
				usdUsed: 0.069,
				config: config.budget,
			}),
		).toMatchObject({ status: "within_budget" });
	});

	test("warns at the configured threshold before exceedance", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(
			evaluatePawTaskBudget({
				taskClass: "trivial",
				runMode: "interactive",
				tokensUsed: 28_000,
				usdUsed: 0.05,
				config: config.budget,
			}),
		).toMatchObject({
			status: "warn",
			details: {
				utilizationPct: 70,
				warnAtPct: 70,
			},
		});
	});

	test("requires approval when an interactive task exceeds the token limit", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(
			evaluatePawTaskBudget({
				taskClass: "trivial",
				runMode: "interactive",
				tokensUsed: 40_001,
				usdUsed: 0.05,
				config: config.budget,
			}),
		).toMatchObject({
			status: "needs_approval",
			message: expect.stringContaining("trivial"),
			suggestedAction: expect.stringContaining("Confirm"),
			details: {
				exceededDimensions: ["tokens"],
			},
		});
	});

	test.each(["json", "print", "ci"] as const)("%s blocks when a task exceeds the USD limit", (runMode) => {
		const config = loadDefaultPawRuntimeConfig();

		expect(
			evaluatePawTaskBudget({
				taskClass: "trivial",
				runMode,
				tokensUsed: 1_000,
				usdUsed: 0.101,
				config: config.budget,
			}),
		).toMatchObject({
			status: "blocked",
			code: "BUDGET_EXCEEDED",
			message: expect.stringContaining("trivial"),
			suggestedAction: expect.stringContaining("Reduce"),
			details: {
				exceededDimensions: ["usd"],
			},
		});
	});

	test("warns when a slice exceeds the configured soft fraction", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(
			evaluatePawSliceBudget({
				taskClass: "trivial",
				tokensUsed: 16_001,
				usdUsed: 0.02,
				config: config.budget,
			}),
		).toMatchObject({
			status: "warn",
			details: {
				softFractionOfTask: 0.4,
				softTokenLimit: 16_000,
				exceededDimensions: ["tokens"],
			},
		});
	});

	test("blocks a slice that also exceeds the total task budget", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(
			evaluatePawSliceBudget({
				taskClass: "trivial",
				tokensUsed: 40_001,
				usdUsed: 0.02,
				config: config.budget,
			}),
		).toMatchObject({
			status: "blocked",
			code: "BUDGET_EXCEEDED",
			message: expect.stringContaining("slice"),
			suggestedAction: expect.stringContaining("Reduce"),
			details: {
				exceededDimensions: ["tokens"],
			},
		});
	});
});
