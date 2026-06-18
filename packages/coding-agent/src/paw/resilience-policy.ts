
import type { PawRuntimeConfig } from "./contracts.ts";

export type PawResilienceConfig = PawRuntimeConfig["resilience"];
export type PawVerifyConfig = PawRuntimeConfig["verify"];

export type PawLlmFailureKind = "timeout" | "rate_limit" | "server_error" | "all_providers_down" | "other";
export type PawResilienceBlockCode = "PROVIDER_UNAVAILABLE" | "TOOL_TIMEOUT" | "SUBAGENT_TIMEOUT" | "LOOP_CAP_EXCEEDED";
export type PawVerifyGateSet = "v1" | "v2" | "unconfigured";

export type PawLlmFailureInput = {
	failureKind: PawLlmFailureKind;
	attemptNumber: number;
	config: PawResilienceConfig;
};

export type PawLlmFailureDecision =
	| {
			status: "retry";
			failureKind: PawLlmFailureKind;
			attemptNumber: number;
			maxRetries: number;
			timeoutSec: number;
			backoff: string;
			message: string;
			suggestedAction: string;
	  }
	| {
			status: "failover";
			failureKind: PawLlmFailureKind;
			attemptNumber: number;
			maxRetries: number;
			timeoutSec: number;
			degraded: true;
			reason: string;
			message: string;
			suggestedAction: string;
	  }
	| {
			status: "blocked";
			code: "PROVIDER_UNAVAILABLE";
			failureKind: PawLlmFailureKind;
			attemptNumber: number;
			maxRetries: number;
			timeoutSec: number;
			message: string;
			suggestedAction: string;
	  };

export type PawToolTimeoutDecision = {
	status: "blocked";
	code: "TOOL_TIMEOUT";
	timeoutSec: number;
	killOnTimeout: boolean;
	message: string;
	suggestedAction: string;
};

export type PawSubAgentTimeoutDecision = {
	status: "blocked";
	code: "SUBAGENT_TIMEOUT";
	timeoutSec: number;
	onTimeout: string;
	message: string;
	suggestedAction: string;
};

export type PawLoopCapInput = {
	iterationCount: number;
	plannerPosition: string;
	reviewerPosition: string;
	config: PawResilienceConfig;
};

export type PawLoopCapDecision =
	| {
			status: "continue";
			iterationCount: number;
			maxIterations: number;
	  }
	| {
			status: "blocked";
			code: "LOOP_CAP_EXCEEDED";
			iterationCount: number;
			maxIterations: number;
			plannerPosition: string;
			reviewerPosition: string;
			message: string;
			suggestedAction: string;
	  };

export type PawDegradedStepInput = {
	step: string;
	reason: string;
};

export type PawDegradedStep = {
	step: string;
	degraded: true;
	reason: string;
};

export type PawVerifyGateInput = {
	gate: string;
	available: boolean;
	config: PawVerifyConfig;
	reason?: string;
};

export type PawVerifyGateDecision =
	| {
			status: "verified";
			gate: string;
			verified: true;
			applicable: boolean;
			gateSet: PawVerifyGateSet;
	  }
	| {
			status: "unverified";
			gate: string;
			verified: false;
			applicable: boolean;
			gateSet: PawVerifyGateSet;
			reason: string;
	  };

const RETRYABLE_FAILURE_KINDS: readonly PawLlmFailureKind[] = ["timeout", "rate_limit", "server_error"];
const FAILOVER_FAILURE_KINDS: readonly PawLlmFailureKind[] = ["rate_limit", "server_error"];

export function evaluatePawLlmFailure(input: PawLlmFailureInput): PawLlmFailureDecision {
	const maxRetries = input.config.llm_call.retries;
	const timeoutSec = input.config.llm_call.timeout_sec;

	if (input.failureKind === "all_providers_down") {
		return blockedProviderUnavailable(
			input,
			maxRetries,
			timeoutSec,
			"All configured providers are unavailable.",
			"Check provider credentials, network access, or resume after a provider recovers.",
		);
	}

	if (RETRYABLE_FAILURE_KINDS.includes(input.failureKind) && input.attemptNumber < maxRetries) {
		return {
			status: "retry",
			failureKind: input.failureKind,
			attemptNumber: input.attemptNumber,
			maxRetries,
			timeoutSec,
			backoff: input.config.llm_call.backoff,
			message: `LLM ${formatFailureKind(input.failureKind)} failed on attempt ${input.attemptNumber}; retrying before ${maxRetries} retries are exhausted.`,
			suggestedAction: `Retry with ${input.config.llm_call.backoff} before failover or blocking.`,
		};
	}

	if (FAILOVER_FAILURE_KINDS.includes(input.failureKind) && input.config.llm_call.on_5xx_or_429 === "failover_model") {
		return {
			status: "failover",
			failureKind: input.failureKind,
			attemptNumber: input.attemptNumber,
			maxRetries,
			timeoutSec,
			degraded: true,
			reason: `LLM ${formatFailureKind(input.failureKind)} exhausted ${maxRetries} retries; failover marks the step degraded.`,
			message: `LLM ${formatFailureKind(input.failureKind)} exhausted retries and should fail over to the next configured provider/model.`,
			suggestedAction: "Fail over to the next provider/model and surface degraded=true on the affected step.",
		};
	}

	return blockedProviderUnavailable(
		input,
		maxRetries,
		timeoutSec,
		`LLM ${formatFailureKind(input.failureKind)} cannot advance after ${maxRetries} retries.`,
		"Block as provider unavailable or rerun after the provider issue is resolved.",
	);
}

export function evaluatePawToolTimeout(config: PawResilienceConfig): PawToolTimeoutDecision {
	return {
		status: "blocked",
		code: "TOOL_TIMEOUT",
		timeoutSec: config.tool_call.timeout_sec,
		killOnTimeout: config.tool_call.kill_on_timeout,
		message: `Tool call exceeded ${config.tool_call.timeout_sec} seconds and must not keep waiting.`,
		suggestedAction: `Terminate the hung subprocess when kill_on_timeout=${String(config.tool_call.kill_on_timeout)} and rerun or choose a narrower tool call.`,
	};
}

export function evaluatePawSubAgentTimeout(config: PawResilienceConfig): PawSubAgentTimeoutDecision {
	return {
		status: "blocked",
		code: "SUBAGENT_TIMEOUT",
		timeoutSec: config.subagent.wall_clock_sec,
		onTimeout: config.subagent.on_timeout,
		message: `Sub-agent exceeded ${config.subagent.wall_clock_sec} seconds of wall clock time.`,
		suggestedAction: `Mark the sub-agent step ${config.subagent.on_timeout} with SUBAGENT_TIMEOUT and resume with a narrower step.`,
	};
}

export function evaluatePawLoopCap(input: PawLoopCapInput): PawLoopCapDecision {
	const maxIterations = input.config.loop_caps.max_subagent_iterations;

	if (input.iterationCount < maxIterations) {
		return {
			status: "continue",
			iterationCount: input.iterationCount,
			maxIterations,
		};
	}

	return {
		status: "blocked",
		code: "LOOP_CAP_EXCEEDED",
		iterationCount: input.iterationCount,
		maxIterations,
		plannerPosition: input.plannerPosition,
		reviewerPosition: input.reviewerPosition,
		message: `Sub-agent loop reached ${maxIterations} iterations; escalate planner and reviewer disagreement instead of spinning.`,
		suggestedAction: `Fail closed and present both positions. planner: ${input.plannerPosition} reviewer: ${input.reviewerPosition}`,
	};
}

export function createPawDegradedStep(input: PawDegradedStepInput): PawDegradedStep {
	return {
		step: input.step,
		degraded: true,
		reason: input.reason,
	};
}

export function evaluatePawVerifyGate(input: PawVerifyGateInput): PawVerifyGateDecision {
	const gateSet = findPawVerifyGateSet(input.gate, input.config);
	const applicable = gateSet !== "unconfigured";

	if (input.available) {
		return {
			status: "verified",
			gate: input.gate,
			verified: true,
			applicable,
			gateSet,
		};
	}

	return {
		status: "unverified",
		gate: input.gate,
		verified: false,
		applicable,
		gateSet,
		reason: input.reason ?? `Verification gate ${input.gate} is unavailable and must be reported as unverified.`,
	};
}

function blockedProviderUnavailable(
	input: PawLlmFailureInput,
	maxRetries: number,
	timeoutSec: number,
	message: string,
	suggestedAction: string,
): PawLlmFailureDecision {
	return {
		status: "blocked",
		code: "PROVIDER_UNAVAILABLE",
		failureKind: input.failureKind,
		attemptNumber: input.attemptNumber,
		maxRetries,
		timeoutSec,
		message,
		suggestedAction,
	};
}

function findPawVerifyGateSet(gate: string, config: PawVerifyConfig): PawVerifyGateSet {
	if (config.v1_gates.includes(gate)) {
		return "v1";
	}

	if (config.v2_optin_gates.includes(gate)) {
		return "v2";
	}

	return "unconfigured";
}

function formatFailureKind(failureKind: PawLlmFailureKind): string {
	return failureKind.replaceAll("_", " ");
}
