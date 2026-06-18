
import type { PawValidationIssue } from "./contracts.ts";

export type PawScoutBenchmarkCommandName = "ripgrep" | "ctags" | "git";

export type PawScoutBenchmarkCommandMeasurement = {
	command: PawScoutBenchmarkCommandName;
	durationSec: number;
};

export type PawScoutBenchmarkMetrics = {
	repoFileCount: number;
	activeTimeSec: number;
	inputTokens: number;
	cacheHitRate: number;
	commands: readonly PawScoutBenchmarkCommandMeasurement[];
};

export type PawScoutBenchmarkThresholdConfig = {
	minRepoFileCount: number;
	maxActiveTimeSec: number;
	maxInputTokens: number;
	minCacheHitRate: number;
};

export type PawScoutBenchmarkInput = {
	metrics: PawScoutBenchmarkMetrics;
	thresholds?: Partial<PawScoutBenchmarkThresholdConfig>;
};

export type PawScoutBenchmarkResult =
	| {
			ok: true;
			status: "PASS";
			evidence: string;
			issues: readonly [];
	  }
	| {
			ok: false;
			status: "KILL";
			evidence: string;
			issues: readonly PawValidationIssue[];
	  };

export const DEFAULT_PAW_SCOUT_BENCHMARK_THRESHOLDS: PawScoutBenchmarkThresholdConfig = {
	minRepoFileCount: 100_000,
	maxActiveTimeSec: 600,
	maxInputTokens: 1_200_000,
	minCacheHitRate: 0.75,
};

const REQUIRED_SCOUT_COMMANDS: readonly PawScoutBenchmarkCommandName[] = ["ripgrep", "ctags", "git"];

export function evaluatePawScoutBenchmark(input: PawScoutBenchmarkInput): PawScoutBenchmarkResult {
	const thresholds: PawScoutBenchmarkThresholdConfig = {
		...DEFAULT_PAW_SCOUT_BENCHMARK_THRESHOLDS,
		...input.thresholds,
	};
	const issues: PawValidationIssue[] = [];

	if (input.metrics.repoFileCount < thresholds.minRepoFileCount) {
		issues.push({
			path: "/repoFileCount",
			message: `Repo has ${input.metrics.repoFileCount} files; expected at least ${thresholds.minRepoFileCount}.`,
		});
	}

	if (input.metrics.activeTimeSec > thresholds.maxActiveTimeSec) {
		issues.push({
			path: "/activeTimeSec",
			message: `Active time ${input.metrics.activeTimeSec}s exceeds ${thresholds.maxActiveTimeSec}s.`,
		});
	}

	if (input.metrics.inputTokens > thresholds.maxInputTokens) {
		issues.push({
			path: "/inputTokens",
			message: `Input tokens ${input.metrics.inputTokens} exceed ${thresholds.maxInputTokens}.`,
		});
	}

	if (input.metrics.cacheHitRate < thresholds.minCacheHitRate) {
		issues.push({
			path: "/cacheHitRate",
			message: `Cache hit rate ${input.metrics.cacheHitRate} is below ${thresholds.minCacheHitRate}.`,
		});
	}

	for (const command of REQUIRED_SCOUT_COMMANDS) {
		if (findCommandMeasurement(input.metrics.commands, command) === undefined) {
			issues.push({
				path: `/commands/${command}`,
				message: `Missing required ${command} scout benchmark measurement.`,
			});
		}
	}

	const evidence = formatScoutBenchmarkEvidence(input.metrics, thresholds);

	if (issues.length > 0) {
		return {
			ok: false,
			status: "KILL",
			evidence,
			issues,
		};
	}

	return {
		ok: true,
		status: "PASS",
		evidence,
		issues: [],
	};
}

function findCommandMeasurement(
	commands: readonly PawScoutBenchmarkCommandMeasurement[],
	command: PawScoutBenchmarkCommandName,
): PawScoutBenchmarkCommandMeasurement | undefined {
	return commands.find((measurement) => measurement.command === command);
}

function formatScoutBenchmarkEvidence(
	metrics: PawScoutBenchmarkMetrics,
	thresholds: PawScoutBenchmarkThresholdConfig,
): string {
	const commandEvidence = REQUIRED_SCOUT_COMMANDS.map((command) => {
		const measurement = findCommandMeasurement(metrics.commands, command);
		return `${command}=${measurement === undefined ? "missing" : `${measurement.durationSec.toFixed(3)}s`}`;
	}).join(", ");

	return [
		"Injected scout benchmark metrics:",
		`repoFileCount=${metrics.repoFileCount},`,
		`activeTimeSec=${metrics.activeTimeSec},`,
		`inputTokens=${metrics.inputTokens},`,
		`cacheHitRate=${metrics.cacheHitRate},`,
		`${commandEvidence}.`,
		"Thresholds:",
		`minRepoFileCount=${thresholds.minRepoFileCount},`,
		`maxActiveTimeSec=${thresholds.maxActiveTimeSec},`,
		`maxInputTokens=${thresholds.maxInputTokens},`,
		`minCacheHitRate=${thresholds.minCacheHitRate}.`,
	].join(" ");
}
