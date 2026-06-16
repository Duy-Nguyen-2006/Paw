import type { PawRuntimeConfig, PawSubAgentRole, PawTaskClass } from "./contracts.ts";

export type PawContextBudgetConfig = PawRuntimeConfig["context"];
export type PawPromptCacheConfig = PawRuntimeConfig["prompt_cache"];

export type PawFileContextReason = "within_file_read_limit" | "binary_file" | "file_too_large";
export type PawToolOutputContextReason = "within_tool_output_limit" | "tool_output_too_large";
export type PawHandoffContextReason = "within_handoff_limit" | "handoff_too_large";

export type PawFileContextInput = {
	byteLength: number;
	binary: boolean;
	config: PawContextBudgetConfig;
};

export type PawFileContextDecision =
	| {
			status: "inline";
			reason: "within_file_read_limit";
			byteLength: number;
			maxBytes: number;
	  }
	| {
			status: "metadata_only";
			reason: Exclude<PawFileContextReason, "within_file_read_limit">;
			byteLength: number;
			maxBytes: number;
	  };

export type PawToolOutputContextInput = {
	tokenCount: number;
	config: PawContextBudgetConfig;
};

export type PawToolOutputContextDecision =
	| {
			status: "inline";
			reason: "within_tool_output_limit";
			tokenCount: number;
			maxTokens: number;
	  }
	| {
			status: "summarize";
			reason: "tool_output_too_large";
			tokenCount: number;
			maxTokens: number;
	  };

export type PawHandoffContextInput = {
	role: PawSubAgentRole;
	tokenCount: number;
	required: boolean;
	config: PawContextBudgetConfig;
};

export type PawHandoffContextDecision =
	| {
			status: "fits";
			reason: "within_handoff_limit";
			role: PawSubAgentRole;
			required: boolean;
			tokenCount: number;
			maxTokens: number;
	  }
	| {
			status: "optional_truncate";
			reason: "handoff_too_large";
			role: PawSubAgentRole;
			required: false;
			tokenCount: number;
			maxTokens: number;
			suggestedAction: string;
	  }
	| {
			status: "escalate";
			reason: "handoff_too_large";
			role: PawSubAgentRole;
			required: true;
			tokenCount: number;
			maxTokens: number;
			drilldown: string;
			requiredSpanRecallMin: number;
			message: string;
			suggestedAction: string;
	  };

export function getPawTaskContextCap(config: PawContextBudgetConfig, taskClass: PawTaskClass): number {
	return config.class_cap_tokens[taskClass];
}

export function getPawSubAgentHandoffCap(config: PawContextBudgetConfig, role: PawSubAgentRole): number {
	return config.subagent_handoff_max_tokens[role];
}

export function evaluatePawFileContext(input: PawFileContextInput): PawFileContextDecision {
	const maxBytes = input.config.file_read_max_bytes;

	if (input.binary) {
		return {
			status: "metadata_only",
			reason: "binary_file",
			byteLength: input.byteLength,
			maxBytes,
		};
	}

	if (input.byteLength > maxBytes) {
		return {
			status: "metadata_only",
			reason: "file_too_large",
			byteLength: input.byteLength,
			maxBytes,
		};
	}

	return {
		status: "inline",
		reason: "within_file_read_limit",
		byteLength: input.byteLength,
		maxBytes,
	};
}

export function evaluatePawToolOutputContext(input: PawToolOutputContextInput): PawToolOutputContextDecision {
	const maxTokens = input.config.tool_output_max_tokens;

	if (input.tokenCount > maxTokens) {
		return {
			status: "summarize",
			reason: "tool_output_too_large",
			tokenCount: input.tokenCount,
			maxTokens,
		};
	}

	return {
		status: "inline",
		reason: "within_tool_output_limit",
		tokenCount: input.tokenCount,
		maxTokens,
	};
}

export function evaluatePawHandoffContext(input: PawHandoffContextInput): PawHandoffContextDecision {
	const maxTokens = getPawSubAgentHandoffCap(input.config, input.role);

	if (input.tokenCount <= maxTokens) {
		return {
			status: "fits",
			reason: "within_handoff_limit",
			role: input.role,
			required: input.required,
			tokenCount: input.tokenCount,
			maxTokens,
		};
	}

	if (!input.required) {
		return {
			status: "optional_truncate",
			reason: "handoff_too_large",
			role: input.role,
			required: false,
			tokenCount: input.tokenCount,
			maxTokens,
			suggestedAction: "Truncate optional handoff content before adding it to context.",
		};
	}

	return {
		status: "escalate",
		reason: "handoff_too_large",
		role: input.role,
		required: true,
		tokenCount: input.tokenCount,
		maxTokens,
		drilldown: input.config.drilldown,
		requiredSpanRecallMin: input.config.required_span_recall_min,
		message: `The ${input.role} handoff would exceed ${maxTokens} tokens and includes required planner spans.`,
		suggestedAction: `Escalate with ${input.config.drilldown} so required spans can be retrieved without silent truncation.`,
	};
}

export function getPawContextAssemblyOrder(
	contextConfig: PawContextBudgetConfig,
	promptCacheConfig: PawPromptCacheConfig,
): string[] {
	if (!promptCacheConfig.assemble_most_stable_first) {
		return [...contextConfig.assembly_order];
	}

	return [...contextConfig.assembly_order];
}
