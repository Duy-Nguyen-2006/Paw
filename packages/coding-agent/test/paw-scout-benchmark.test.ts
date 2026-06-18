
import { describe, expect, test } from "vitest";
import {
	evaluatePawScoutBenchmark,
	type PawScoutBenchmarkMetrics,
	type PawScoutBenchmarkThresholdConfig,
} from "../src/paw/index.ts";

const PASSING_THRESHOLDS: PawScoutBenchmarkThresholdConfig = {
	minRepoFileCount: 100_000,
	maxActiveTimeSec: 120,
	maxInputTokens: 48_000,
	minCacheHitRate: 0.8,
};

const PASSING_METRICS: PawScoutBenchmarkMetrics = {
	repoFileCount: 125_000,
	activeTimeSec: 90,
	inputTokens: 32_000,
	cacheHitRate: 0.91,
	commands: [
		{ command: "ripgrep", durationSec: 1.2 },
		{ command: "ctags", durationSec: 8.5 },
		{ command: "git", durationSec: 0.7 },
	],
};

describe("Paw scout benchmark evaluator", () => {
	test("passes large-repo metrics within thresholds and records command evidence", () => {
		const result = evaluatePawScoutBenchmark({
			metrics: PASSING_METRICS,
			thresholds: PASSING_THRESHOLDS,
		});

		expect(result).toMatchObject({
			ok: true,
			status: "PASS",
			issues: [],
		});
		expect(result.evidence).toContain("ripgrep=1.200s");
		expect(result.evidence).toContain("ctags=8.500s");
		expect(result.evidence).toContain("git=0.700s");
	});

	test("kills a repo below the minimum file count", () => {
		const result = evaluatePawScoutBenchmark({
			metrics: { ...PASSING_METRICS, repoFileCount: 99_999 },
			thresholds: PASSING_THRESHOLDS,
		});

		expect(result).toMatchObject({
			ok: false,
			status: "KILL",
			issues: [{ path: "/repoFileCount", message: expect.stringContaining("at least 100000") }],
		});
	});

	test("kills active time above the threshold", () => {
		const result = evaluatePawScoutBenchmark({
			metrics: { ...PASSING_METRICS, activeTimeSec: 121 },
			thresholds: PASSING_THRESHOLDS,
		});

		expect(result).toMatchObject({
			ok: false,
			status: "KILL",
			issues: [{ path: "/activeTimeSec", message: expect.stringContaining("exceeds 120s") }],
		});
	});

	test("kills token usage above the threshold", () => {
		const result = evaluatePawScoutBenchmark({
			metrics: { ...PASSING_METRICS, inputTokens: 48_001 },
			thresholds: PASSING_THRESHOLDS,
		});

		expect(result).toMatchObject({
			ok: false,
			status: "KILL",
			issues: [{ path: "/inputTokens", message: expect.stringContaining("exceed 48000") }],
		});
	});

	test("kills cache hit rate below the threshold", () => {
		const result = evaluatePawScoutBenchmark({
			metrics: { ...PASSING_METRICS, cacheHitRate: 0.79 },
			thresholds: PASSING_THRESHOLDS,
		});

		expect(result).toMatchObject({
			ok: false,
			status: "KILL",
			issues: [{ path: "/cacheHitRate", message: expect.stringContaining("below 0.8") }],
		});
	});

	test("kills when a required command measurement is missing", () => {
		const result = evaluatePawScoutBenchmark({
			metrics: {
				...PASSING_METRICS,
				commands: [
					{ command: "ripgrep", durationSec: 1.2 },
					{ command: "git", durationSec: 0.7 },
				],
			},
			thresholds: PASSING_THRESHOLDS,
		});

		expect(result).toMatchObject({
			ok: false,
			status: "KILL",
			issues: [{ path: "/commands/ctags", message: expect.stringContaining("Missing required ctags") }],
		});
		expect(result.evidence).toContain("ripgrep=1.200s");
		expect(result.evidence).toContain("ctags=missing");
		expect(result.evidence).toContain("git=0.700s");
	});
});
