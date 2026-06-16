import type { PawRunMode } from "./approval-policy.ts";
import type { PawRuntimeConfig, PawTaskClass } from "./contracts.ts";

export type PawBudgetPolicyConfig = PawRuntimeConfig["budget"];
export type PawBudgetDecisionStatus = "within_budget" | "warn" | "needs_approval" | "blocked";
export type PawBudgetBlockCode = "BUDGET_EXCEEDED";
export type PawBudgetDimension = "tokens" | "usd";

export type PawBudgetDetails = {
	taskClass: PawTaskClass;
	tokensUsed: number;
	usdUsed: number;
	maxTokens: number;
	maxUsd: number;
	tokenUtilizationPct: number;
	usdUtilizationPct: number;
	utilizationPct: number;
	warnAtPct: number;
	exceededDimensions: PawBudgetDimension[];
	warningDimensions: PawBudgetDimension[];
	softFractionOfTask?: number;
	softTokenLimit?: number;
	softUsdLimit?: number;
};

export type PawBudgetDecision =
	| {
			status: "within_budget";
			details: PawBudgetDetails;
	  }
	| {
			status: "warn";
			message: string;
			suggestedAction: string;
			details: PawBudgetDetails;
	  }
	| {
			status: "needs_approval";
			message: string;
			suggestedAction: string;
			details: PawBudgetDetails;
	  }
	| {
			status: "blocked";
			code: PawBudgetBlockCode;
			message: string;
			suggestedAction: string;
			details: PawBudgetDetails;
	  };

export type PawBudgetUtilizationInput = {
	tokensUsed: number;
	maxTokens: number;
	usdUsed: number;
	maxUsd: number;
};

export type PawTaskBudgetInput = {
	taskClass: PawTaskClass;
	runMode: PawRunMode;
	tokensUsed: number;
	usdUsed: number;
	config: PawBudgetPolicyConfig;
};

export type PawSliceBudgetInput = {
	taskClass: PawTaskClass;
	tokensUsed: number;
	usdUsed: number;
	config: PawBudgetPolicyConfig;
};

export function computePawBudgetUtilizationPct(input: PawBudgetUtilizationInput): number {
	return Math.max(
		computeDimensionUtilizationPct(input.tokensUsed, input.maxTokens),
		computeDimensionUtilizationPct(input.usdUsed, input.maxUsd),
	);
}

export function evaluatePawTaskBudget(input: PawTaskBudgetInput): PawBudgetDecision {
	const details = createTaskBudgetDetails(input.taskClass, input.tokensUsed, input.usdUsed, input.config);

	if (details.exceededDimensions.length > 0) {
		if (input.runMode === "interactive") {
			return needsApproval(
				`The ${input.taskClass} task budget is exceeded for ${formatDimensions(details.exceededDimensions)}.`,
				"Confirm whether to continue beyond the configured task budget.",
				details,
			);
		}

		return blocked(
			`The ${input.taskClass} task budget is exceeded for ${formatDimensions(details.exceededDimensions)} in ${input.runMode} mode.`,
			"Reduce scope or raise the configured budget before rerunning non-interactively.",
			details,
		);
	}

	if (details.warningDimensions.length > 0) {
		return warn(
			`The ${input.taskClass} task budget reached ${formatPct(details.utilizationPct)} of its configured limit.`,
			"Review remaining scope before continuing.",
			details,
		);
	}

	return { status: "within_budget", details };
}

export function evaluatePawSliceBudget(input: PawSliceBudgetInput): PawBudgetDecision {
	const taskDetails = createTaskBudgetDetails(input.taskClass, input.tokensUsed, input.usdUsed, input.config);

	if (taskDetails.exceededDimensions.length > 0) {
		return blocked(
			`The ${input.taskClass} slice exceeds the total task budget for ${formatDimensions(taskDetails.exceededDimensions)}.`,
			"Reduce slice scope or raise the configured task budget before continuing.",
			taskDetails,
		);
	}

	const taskBudget = input.config.per_task[input.taskClass];
	const softFractionOfTask = input.config.per_slice.soft_fraction_of_task;
	const softTokenLimit = taskBudget.max_tokens * softFractionOfTask;
	const softUsdLimit = taskBudget.max_usd * softFractionOfTask;
	const softExceededDimensions = getExceededDimensions(input.tokensUsed, softTokenLimit, input.usdUsed, softUsdLimit);
	const details: PawBudgetDetails = {
		...taskDetails,
		softFractionOfTask,
		softTokenLimit,
		softUsdLimit,
		exceededDimensions: softExceededDimensions,
	};

	if (softExceededDimensions.length > 0) {
		return warn(
			`The ${input.taskClass} slice exceeded the configured soft slice budget for ${formatDimensions(softExceededDimensions)}.`,
			"Review or split the slice before it consumes more of the task budget.",
			details,
		);
	}

	if (details.warningDimensions.length > 0) {
		return warn(
			`The ${input.taskClass} slice reached ${formatPct(details.utilizationPct)} of the total task budget.`,
			"Review remaining task budget before continuing.",
			details,
		);
	}

	return { status: "within_budget", details };
}

function createTaskBudgetDetails(
	taskClass: PawTaskClass,
	tokensUsed: number,
	usdUsed: number,
	config: PawBudgetPolicyConfig,
): PawBudgetDetails {
	const taskBudget = config.per_task[taskClass];
	const tokenUtilizationPct = computeDimensionUtilizationPct(tokensUsed, taskBudget.max_tokens);
	const usdUtilizationPct = computeDimensionUtilizationPct(usdUsed, taskBudget.max_usd);
	const utilizationPct = Math.max(tokenUtilizationPct, usdUtilizationPct);

	return {
		taskClass,
		tokensUsed,
		usdUsed,
		maxTokens: taskBudget.max_tokens,
		maxUsd: taskBudget.max_usd,
		tokenUtilizationPct,
		usdUtilizationPct,
		utilizationPct,
		warnAtPct: taskBudget.warn_at_pct,
		exceededDimensions: getExceededDimensions(tokensUsed, taskBudget.max_tokens, usdUsed, taskBudget.max_usd),
		warningDimensions: getWarningDimensions(
			tokenUtilizationPct,
			usdUtilizationPct,
			taskBudget.warn_at_pct,
			tokensUsed,
			taskBudget.max_tokens,
			usdUsed,
			taskBudget.max_usd,
		),
	};
}

function computeDimensionUtilizationPct(used: number, limit: number): number {
	if (limit === 0) {
		return used === 0 ? 0 : Number.POSITIVE_INFINITY;
	}

	return (used / limit) * 100;
}

function getExceededDimensions(
	tokensUsed: number,
	maxTokens: number,
	usdUsed: number,
	maxUsd: number,
): PawBudgetDimension[] {
	const dimensions: PawBudgetDimension[] = [];

	if (tokensUsed > maxTokens) {
		dimensions.push("tokens");
	}
	if (usdUsed > maxUsd) {
		dimensions.push("usd");
	}

	return dimensions;
}

function getWarningDimensions(
	tokenUtilizationPct: number,
	usdUtilizationPct: number,
	warnAtPct: number,
	tokensUsed: number,
	maxTokens: number,
	usdUsed: number,
	maxUsd: number,
): PawBudgetDimension[] {
	const dimensions: PawBudgetDimension[] = [];

	if (tokenUtilizationPct >= warnAtPct && tokensUsed <= maxTokens) {
		dimensions.push("tokens");
	}
	if (usdUtilizationPct >= warnAtPct && usdUsed <= maxUsd) {
		dimensions.push("usd");
	}

	return dimensions;
}

function warn(message: string, suggestedAction: string, details: PawBudgetDetails): PawBudgetDecision {
	return {
		status: "warn",
		message,
		suggestedAction,
		details,
	};
}

function needsApproval(message: string, suggestedAction: string, details: PawBudgetDetails): PawBudgetDecision {
	return {
		status: "needs_approval",
		message,
		suggestedAction,
		details,
	};
}

function blocked(message: string, suggestedAction: string, details: PawBudgetDetails): PawBudgetDecision {
	return {
		status: "blocked",
		code: "BUDGET_EXCEEDED",
		message,
		suggestedAction,
		details,
	};
}

function formatDimensions(dimensions: readonly PawBudgetDimension[]): string {
	return dimensions.join(" and ");
}

function formatPct(value: number): string {
	if (!Number.isFinite(value)) {
		return "infinite utilization";
	}

	return `${Math.round(value * 100) / 100}%`;
}
