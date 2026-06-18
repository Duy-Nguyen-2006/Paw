import type { PawRiskLevel, PawRuntimeConfig, PawSubAgentOutput, PawValidationIssue } from "./contracts.ts";
import { evaluatePawSandbox } from "./security-policy.ts";
import type { PawSubAgentRuntimeDecision, PawSubAgentRuntimeInvocation } from "./subagent-runtime.ts";

export interface PawSubAgentSandboxPreflightInput {
	availablePrimitives: readonly string[];
	riskLevel?: PawRiskLevel;
	unsafeOverride?: boolean;
}

export function evaluatePawSubAgentSandboxPreflight(
	config: PawRuntimeConfig,
	invocation: PawSubAgentRuntimeInvocation,
	input: PawSubAgentSandboxPreflightInput | undefined,
): Extract<PawSubAgentRuntimeDecision, { status: "blocked" }> | null {
	if (input === undefined) {
		return null;
	}

	const decision = evaluatePawSandbox({
		config: config.sandbox,
		availablePrimitives: input.availablePrimitives,
		riskLevel: input.riskLevel ?? "R1",
		unsafeOverride: input.unsafeOverride,
	});
	if (decision.status === "allow") {
		return null;
	}

	const issue: PawValidationIssue = { path: "/sandbox", message: decision.message };
	return {
		status: "blocked",
		output: createSandboxUnavailableOutput(invocation, decision.message, decision.suggestedAction),
		attempts: 0,
		issues: [issue],
	};
}

function createSandboxUnavailableOutput(
	invocation: PawSubAgentRuntimeInvocation,
	message: string,
	suggestedAction: string,
): PawSubAgentOutput {
	return {
		status: "blocked",
		confidence: "low",
		agent: invocation.role,
		session_id: invocation.session_id,
		slice_id: invocation.slice_id ?? null,
		artifact_ref: invocation.artifact_ref,
		changed_files: [],
		inspected_files: [],
		risks: [
			{ description: "No configured Paw sandbox primitive is available for write-capable work.", severity: "high" },
		],
		next_actions: [suggestedAction],
		blocked_reason: {
			code: "SANDBOX_UNAVAILABLE",
			message,
			suggested_action: suggestedAction,
		},
		tokens_used: 0,
		usd_cost: 0,
		degraded: true,
		model_used: invocation.model_id ?? null,
	};
}
