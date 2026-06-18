
import type { PawTaskClass, PawValidationIssue } from "./contracts.ts";

export type PawCostLatencyCacheProviderClass = "hosted" | "local";

export type PawCostLatencyCacheMetrics = {
	taskClass: PawTaskClass;
	usdUsed: number;
	inputTokens: number;
	activeTimeSec: number;
	providerClass: PawCostLatencyCacheProviderClass;
	cacheHitRate?: number;
};

export type PawCostLatencyCacheThresholdConfig = {
	maxUsd: number;
	maxTokens: number;
	maxActiveTimeSec: number;
	advisoryCacheHitRate: number;
};

export type PawCostLatencyCacheInput = {
	metrics: PawCostLatencyCacheMetrics;
	thresholds?: Partial<PawCostLatencyCacheThresholdConfig>;
};

export type PawCostLatencyCacheAdvisory =
	| {
			status: "PASS";
			message: string;
	  }
	| {
			status: "WARN";
			message: string;
			issue: PawValidationIssue;
	  }
	| {
			status: "N/A";
			message: string;
	  };

export type PawCostLatencyCacheResult =
	| {
			ok: true;
			status: "PASS";
			evidence: string;
			issues: readonly [];
			cacheAdvisory: PawCostLatencyCacheAdvisory;
	  }
	| {
			ok: false;
			status: "KILL";
			evidence: string;
			issues: readonly PawValidationIssue[];
			cacheAdvisory: PawCostLatencyCacheAdvisory;
	  };

export const DEFAULT_PAW_COST_LATENCY_CACHE_THRESHOLDS: PawCostLatencyCacheThresholdConfig = {
	maxUsd: 3,
	maxTokens: 1_200_000,
	maxActiveTimeSec: 600,
	advisoryCacheHitRate: 0.7,
};

export function evaluatePawCostLatencyCache(input: PawCostLatencyCacheInput): PawCostLatencyCacheResult {
	const thresholds: PawCostLatencyCacheThresholdConfig = {
		...DEFAULT_PAW_COST_LATENCY_CACHE_THRESHOLDS,
		...input.thresholds,
	};
	const issues: PawValidationIssue[] = [];

	if (input.metrics.taskClass !== "high_risk") {
		issues.push({
			path: "/taskClass",
			message: `Task class ${input.metrics.taskClass} is outside S2 high-risk scope.`,
		});
	}

	if (input.metrics.usdUsed > thresholds.maxUsd) {
		issues.push({
			path: "/usdUsed",
			message: `USD used ${formatUsd(input.metrics.usdUsed)} exceeds ${thresholds.maxUsd}.`,
		});
	}

	if (input.metrics.inputTokens > thresholds.maxTokens) {
		issues.push({
			path: "/inputTokens",
			message: `Input tokens ${input.metrics.inputTokens} exceed ${thresholds.maxTokens}.`,
		});
	}

	if (input.metrics.activeTimeSec > thresholds.maxActiveTimeSec) {
		issues.push({
			path: "/activeTimeSec",
			message: `Active time ${input.metrics.activeTimeSec}s exceeds ${thresholds.maxActiveTimeSec}s.`,
		});
	}

	const cacheAdvisory = evaluateCacheAdvisory(input.metrics, thresholds);
	const evidence = formatCostLatencyCacheEvidence(input.metrics, thresholds, cacheAdvisory);

	if (issues.length > 0) {
		return {
			ok: false,
			status: "KILL",
			evidence,
			issues,
			cacheAdvisory,
		};
	}

	return {
		ok: true,
		status: "PASS",
		evidence,
		issues: [],
		cacheAdvisory,
	};
}

function evaluateCacheAdvisory(
	metrics: PawCostLatencyCacheMetrics,
	thresholds: PawCostLatencyCacheThresholdConfig,
): PawCostLatencyCacheAdvisory {
	if (metrics.providerClass === "local") {
		return {
			status: "N/A",
			message: "Local provider cache advisory is not applicable.",
		};
	}

	if (metrics.cacheHitRate === undefined) {
		return {
			status: "WARN",
			message: `Hosted cache hit rate is missing; advisory target is ${thresholds.advisoryCacheHitRate}.`,
			issue: {
				path: "/cacheHitRate",
				message: `Hosted cache hit rate is missing; advisory target is ${thresholds.advisoryCacheHitRate}.`,
			},
		};
	}

	if (metrics.cacheHitRate < thresholds.advisoryCacheHitRate) {
		return {
			status: "WARN",
			message: `Hosted cache hit rate ${metrics.cacheHitRate} is below advisory target ${thresholds.advisoryCacheHitRate}.`,
			issue: {
				path: "/cacheHitRate",
				message: `Hosted cache hit rate ${metrics.cacheHitRate} is below advisory target ${thresholds.advisoryCacheHitRate}.`,
			},
		};
	}

	return {
		status: "PASS",
		message: `Hosted cache hit rate ${metrics.cacheHitRate} meets advisory target ${thresholds.advisoryCacheHitRate}.`,
	};
}

function formatCostLatencyCacheEvidence(
	metrics: PawCostLatencyCacheMetrics,
	thresholds: PawCostLatencyCacheThresholdConfig,
	cacheAdvisory: PawCostLatencyCacheAdvisory,
): string {
	return [
		"Injected S2 cost latency cache metrics:",
		`taskClass=${metrics.taskClass},`,
		`USD=${formatUsd(metrics.usdUsed)},`,
		`tokens=${metrics.inputTokens},`,
		`activeTimeSec=${metrics.activeTimeSec},`,
		`providerClass=${metrics.providerClass},`,
		`cacheHitRate=${formatCacheHitRate(metrics)},`,
		`cacheAdvisory=${cacheAdvisory.status} (${cacheAdvisory.message}).`,
		"Thresholds:",
		`maxUsd=${formatUsd(thresholds.maxUsd)},`,
		`maxTokens=${thresholds.maxTokens},`,
		`maxActiveTimeSec=${thresholds.maxActiveTimeSec},`,
		`advisoryCacheHitRate=${thresholds.advisoryCacheHitRate}.`,
	].join(" ");
}

function formatCacheHitRate(metrics: PawCostLatencyCacheMetrics): string {
	if (metrics.providerClass === "local") {
		return "N/A";
	}

	return metrics.cacheHitRate === undefined ? "missing" : `${metrics.cacheHitRate}`;
}

function formatUsd(value: number): string {
	return value.toFixed(2);
}
