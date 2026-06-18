
import type { PawSubAgentOutput, PawSubAgentRole, PawValidationIssue } from "./contracts.ts";
import { parsePawSubAgentOutputJson, validatePawSubAgentOutput } from "./subagent.ts";

export type PawSubAgentResponseInput = {
	rawOutput: string;
	attemptNumber: number;
	maxInvalidAttempts?: number;
	expectedAgent: PawSubAgentRole;
	expectedSessionId: string;
	expectedArtifactRef: string;
	expectedSliceId?: string | null;
	modelUsed?: string | null;
};

export type PawSubAgentResponseDecision =
	| {
			status: "accepted";
			output: PawSubAgentOutput;
			attempts: number;
	  }
	| {
			status: "retry";
			attempts: number;
			issues: PawValidationIssue[];
			message: string;
	  }
	| {
			status: "blocked";
			output: PawSubAgentOutput;
			attempts: number;
			issues: PawValidationIssue[];
	  };

function createMismatchIssue(
	path: string,
	expected: string | null,
	actual: string | null | undefined,
): PawValidationIssue {
	return {
		path,
		message: `Expected ${expected === null ? "null" : JSON.stringify(expected)} but received ${
			actual === undefined ? "undefined" : actual === null ? "null" : JSON.stringify(actual)
		}`,
	};
}

function getMetadataIssues(output: PawSubAgentOutput, input: PawSubAgentResponseInput): PawValidationIssue[] {
	const issues: PawValidationIssue[] = [];

	if (output.agent !== input.expectedAgent) {
		issues.push(createMismatchIssue("/agent", input.expectedAgent, output.agent));
	}

	if (output.session_id !== input.expectedSessionId) {
		issues.push(createMismatchIssue("/session_id", input.expectedSessionId, output.session_id));
	}

	if (output.artifact_ref !== input.expectedArtifactRef) {
		issues.push(createMismatchIssue("/artifact_ref", input.expectedArtifactRef, output.artifact_ref));
	}

	if ("expectedSliceId" in input && output.slice_id !== input.expectedSliceId) {
		issues.push(createMismatchIssue("/slice_id", input.expectedSliceId ?? null, output.slice_id));
	}

	return issues;
}

function summarizeIssues(issues: PawValidationIssue[]): string {
	return issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
}

function createRetryMessage(issues: PawValidationIssue[]): string {
	return `Sub-agent response did not match the required contract: ${summarizeIssues(issues)}`;
}

function createBlockedOutput(input: PawSubAgentResponseInput, issues: PawValidationIssue[]): PawSubAgentOutput {
	const output: PawSubAgentOutput = {
		status: "blocked",
		confidence: "low",
		agent: input.expectedAgent,
		session_id: input.expectedSessionId,
		slice_id: input.expectedSliceId ?? null,
		artifact_ref: input.expectedArtifactRef,
		changed_files: [],
		inspected_files: [],
		risks: [
			{
				description: "Sub-agent response did not match the required contract.",
				severity: "high",
			},
		],
		next_actions: ["Retry the sub-agent with the required JSON contract."],
		blocked_reason: {
			code: "CONTEXT_MISSING",
			message: createRetryMessage(issues),
			suggested_action: "Retry the sub-agent with a valid Paw sub-agent output JSON object.",
		},
		tokens_used: 0,
		usd_cost: 0,
		degraded: false,
		model_used: input.modelUsed ?? null,
	};
	const validation = validatePawSubAgentOutput(output);

	if (!validation.ok) {
		throw new Error(`Synthetic Paw blocked output failed validation: ${summarizeIssues(validation.issues)}`);
	}

	return validation.value;
}

export function evaluatePawSubAgentResponse(input: PawSubAgentResponseInput): PawSubAgentResponseDecision {
	const maxInvalidAttempts = input.maxInvalidAttempts ?? 2;
	const parsed = parsePawSubAgentOutputJson(input.rawOutput);
	const issues = parsed.ok ? getMetadataIssues(parsed.value, input) : parsed.issues;

	if (parsed.ok && issues.length === 0) {
		return {
			status: "accepted",
			output: parsed.value,
			attempts: input.attemptNumber,
		};
	}

	if (input.attemptNumber < maxInvalidAttempts) {
		return {
			status: "retry",
			attempts: input.attemptNumber,
			issues,
			message: createRetryMessage(issues),
		};
	}

	return {
		status: "blocked",
		output: createBlockedOutput(input, issues),
		attempts: input.attemptNumber,
		issues,
	};
}
