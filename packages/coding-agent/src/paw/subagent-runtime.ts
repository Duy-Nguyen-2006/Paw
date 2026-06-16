import type { PawSubAgentOutput, PawSubAgentRole, PawValidationIssue } from "./contracts.ts";
import {
	evaluatePawSubAgentResponse,
	type PawSubAgentResponseDecision,
	type PawSubAgentResponseInput,
} from "./subagent-response.ts";

export type PawSubAgentRuntimeInvocation = {
	role: PawSubAgentRole;
	session_id: string;
	slice_id?: string | null;
	artifact_ref: string;
	handoff: string;
	handoff_token_estimate: number;
	max_handoff_tokens: number;
	attempt_number: number;
	model_id?: string | null;
};

export type PawSubAgentRuntimeDegradedMetadata = {
	reason: string;
	details?: string;
};

export type PawSubAgentRuntimeExecutorResult = {
	raw_output: string;
	model_id?: string | null;
	degraded?: PawSubAgentRuntimeDegradedMetadata | null;
};

export type PawSubAgentRuntimeExecutor = (
	invocation: PawSubAgentRuntimeInvocation,
) => PawSubAgentRuntimeExecutorResult | Promise<PawSubAgentRuntimeExecutorResult>;

export type PawSubAgentRuntimeDecision = PawSubAgentResponseDecision & {
	executor_model_id?: string | null;
	executor_degraded?: PawSubAgentRuntimeDegradedMetadata | null;
};

type PawSubAgentRuntimeExecutorMetadata = {
	executor_model_id?: string | null;
	executor_degraded?: PawSubAgentRuntimeDegradedMetadata | null;
};

export async function runPawSubAgentRuntime(
	invocation: PawSubAgentRuntimeInvocation,
	executor: PawSubAgentRuntimeExecutor,
): Promise<PawSubAgentRuntimeDecision> {
	const oversizedIssue = getOversizedHandoffIssue(invocation);
	if (oversizedIssue !== undefined) {
		return createOversizedHandoffDecision(invocation, oversizedIssue);
	}

	const executorResult = await executor(invocation);
	const decision = evaluatePawSubAgentResponse({
		...createResponseInputBase(invocation, executorResult.model_id ?? invocation.model_id ?? null),
		rawOutput: executorResult.raw_output,
	});

	return withExecutorMetadata(decision, {
		executor_model_id: executorResult.model_id,
		executor_degraded: executorResult.degraded,
	});
}

function getOversizedHandoffIssue(invocation: PawSubAgentRuntimeInvocation): PawValidationIssue | undefined {
	if (invocation.handoff_token_estimate <= invocation.max_handoff_tokens) {
		return undefined;
	}

	return {
		path: "/handoff_token_estimate",
		message: `Estimated handoff tokens ${invocation.handoff_token_estimate} exceed max_handoff_tokens ${invocation.max_handoff_tokens}.`,
	};
}

function createResponseInputBase(
	invocation: PawSubAgentRuntimeInvocation,
	modelUsed: string | null,
): Omit<PawSubAgentResponseInput, "rawOutput"> {
	const input: Omit<PawSubAgentResponseInput, "rawOutput"> = {
		attemptNumber: invocation.attempt_number,
		expectedAgent: invocation.role,
		expectedSessionId: invocation.session_id,
		expectedArtifactRef: invocation.artifact_ref,
		modelUsed,
	};

	if ("slice_id" in invocation) {
		input.expectedSliceId = invocation.slice_id ?? null;
	}

	return input;
}

function createOversizedHandoffDecision(
	invocation: PawSubAgentRuntimeInvocation,
	issue: PawValidationIssue,
): PawSubAgentRuntimeDecision {
	const output: PawSubAgentOutput = {
		status: "blocked",
		confidence: "low",
		agent: invocation.role,
		session_id: invocation.session_id,
		slice_id: invocation.slice_id ?? null,
		artifact_ref: invocation.artifact_ref,
		changed_files: [],
		inspected_files: [],
		risks: [
			{
				description: "Sub-agent handoff exceeds the configured handoff token limit.",
				severity: "high",
			},
		],
		next_actions: ["Reduce the handoff context before invoking the sub-agent."],
		blocked_reason: {
			code: "BUDGET_EXCEEDED",
			message: issue.message,
			suggested_action: "Reduce handoff text or increase the sub-agent handoff token cap.",
		},
		tokens_used: 0,
		usd_cost: 0,
		degraded: false,
		model_used: invocation.model_id ?? null,
	};
	const validationDecision = evaluatePawSubAgentResponse({
		...createResponseInputBase(invocation, invocation.model_id ?? null),
		rawOutput: JSON.stringify(output),
	});

	if (validationDecision.status !== "accepted") {
		throw new Error("Synthetic oversized Paw blocked output failed validation.");
	}

	return {
		status: "blocked",
		output: validationDecision.output,
		attempts: invocation.attempt_number,
		issues: [issue],
	};
}

function withExecutorMetadata(
	decision: PawSubAgentResponseDecision,
	metadata: PawSubAgentRuntimeExecutorMetadata,
): PawSubAgentRuntimeDecision {
	if (metadata.executor_model_id === undefined && metadata.executor_degraded === undefined) {
		return decision;
	}

	return {
		...decision,
		...metadata,
	};
}
