
import { describe, expect, test } from "vitest";
import {
	DEFAULT_PAW_COST_LATENCY_CACHE_THRESHOLDS,
	evaluatePawCostLatencyCache,
	type PawCostLatencyCacheMetrics,
	type PawCostLatencyCacheThresholdConfig,
} from "../src/paw/index.ts";

const PASSING_THRESHOLDS: PawCostLatencyCacheThresholdConfig = {
	maxUsd: 3,
	maxTokens: 1_200_000,
	maxActiveTimeSec: 600,
	advisoryCacheHitRate: 0.7,
};

const PASSING_METRICS: PawCostLatencyCacheMetrics = {
	taskClass: "high_risk",
	usdUsed: 2.25,
	inputTokens: 900_000,
	activeTimeSec: 420,
	providerClass: "hosted",
	cacheHitRate: 0.82,
};

describe("Paw cost latency cache evaluator", () => {
	test("passes high-risk metrics within default thresholds", () => {
		const result = evaluatePawCostLatencyCache({ metrics: PASSING_METRICS });

		expect(result).toMatchObject({
			ok: true,
			status: "PASS",
			issues: [],
			cacheAdvisory: { status: "PASS" },
		});
		expect(DEFAULT_PAW_COST_LATENCY_CACHE_THRESHOLDS).toMatchObject(PASSING_THRESHOLDS);
		expect(result.evidence).toContain("USD=2.25");
		expect(result.evidence).toContain("tokens=900000");
		expect(result.evidence).toContain("activeTimeSec=420");
		expect(result.evidence).toContain("providerClass=hosted");
		expect(result.evidence).toContain("cacheAdvisory=PASS");
	});

	test("kills USD usage above the threshold", () => {
		const result = evaluatePawCostLatencyCache({
			metrics: { ...PASSING_METRICS, usdUsed: 3.01 },
			thresholds: PASSING_THRESHOLDS,
		});

		expect(result).toMatchObject({
			ok: false,
			status: "KILL",
			issues: [{ path: "/usdUsed", message: expect.stringContaining("exceeds 3") }],
		});
	});

	test("kills token usage above the threshold", () => {
		const result = evaluatePawCostLatencyCache({
			metrics: { ...PASSING_METRICS, inputTokens: 1_200_001 },
			thresholds: PASSING_THRESHOLDS,
		});

		expect(result).toMatchObject({
			ok: false,
			status: "KILL",
			issues: [{ path: "/inputTokens", message: expect.stringContaining("exceed 1200000") }],
		});
	});

	test("kills active time above the threshold", () => {
		const result = evaluatePawCostLatencyCache({
			metrics: { ...PASSING_METRICS, activeTimeSec: 601 },
			thresholds: PASSING_THRESHOLDS,
		});

		expect(result).toMatchObject({
			ok: false,
			status: "KILL",
			issues: [{ path: "/activeTimeSec", message: expect.stringContaining("exceeds 600s") }],
		});
	});

	test("passes hosted cache below target with advisory warning", () => {
		const result = evaluatePawCostLatencyCache({
			metrics: { ...PASSING_METRICS, cacheHitRate: 0.65 },
			thresholds: PASSING_THRESHOLDS,
		});

		expect(result).toMatchObject({
			ok: true,
			status: "PASS",
			issues: [],
			cacheAdvisory: {
				status: "WARN",
				issue: { path: "/cacheHitRate", message: expect.stringContaining("below advisory target 0.7") },
			},
		});
		expect(result.evidence).toContain("cacheAdvisory=WARN");
	});

	test("passes local provider with cache advisory marked N/A", () => {
		const localMetrics: PawCostLatencyCacheMetrics = {
			taskClass: "high_risk",
			usdUsed: 2.25,
			inputTokens: 900_000,
			activeTimeSec: 420,
			providerClass: "local",
		};

		const result = evaluatePawCostLatencyCache({
			metrics: localMetrics,
			thresholds: PASSING_THRESHOLDS,
		});

		expect(result).toMatchObject({
			ok: true,
			status: "PASS",
			issues: [],
			cacheAdvisory: { status: "N/A" },
		});
		expect(result.evidence).toContain("providerClass=local");
		expect(result.evidence).toContain("cacheAdvisory=N/A");
	});

	test("kills non-high-risk task class because S2 scope is high-risk only", () => {
		const result = evaluatePawCostLatencyCache({
			metrics: { ...PASSING_METRICS, taskClass: "standard" },
			thresholds: PASSING_THRESHOLDS,
		});

		expect(result).toMatchObject({
			ok: false,
			status: "KILL",
			issues: [{ path: "/taskClass", message: expect.stringContaining("outside S2 high-risk scope") }],
		});
	});
});
