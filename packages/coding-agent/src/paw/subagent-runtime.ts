import {
	type Api,
	type AssistantMessage,
	type Context,
	completeSimple,
	type Model,
	type SimpleStreamOptions,
	type TextContent,
} from "@earendil-works/pi-ai";
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

export type PawProviderSubAgentPrompt = {
	systemPrompt: string;
	userPrompt: string;
};

export type PawProviderSubAgentCompletionInput = {
	invocation: PawSubAgentRuntimeInvocation;
	model_id: string;
	prompt: PawProviderSubAgentPrompt;
};

export type PawProviderSubAgentCompletionResult = {
	text: string;
	model_id?: string | null;
	degraded?: PawSubAgentRuntimeDegradedMetadata | null;
};

export type PawProviderSubAgentCompletion = (
	input: PawProviderSubAgentCompletionInput,
) => PawProviderSubAgentCompletionResult | Promise<PawProviderSubAgentCompletionResult>;

export type PawProviderSubAgentExecutorInput = {
	complete: PawProviderSubAgentCompletion;
};

export type PawProviderSubAgentModelResolver = (
	input: PawProviderSubAgentCompletionInput,
) => PawProviderSubAgentResolvedModel | Promise<PawProviderSubAgentResolvedModel>;

export type PawProviderSubAgentResolvedModel = {
	model: Model<Api>;
	options?: SimpleStreamOptions;
};

export type PawProviderSubAgentCompleteSimple = (
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
) => Promise<AssistantMessage>;

export type PawProviderSubAgentCompleteSimpleInput = {
	resolveModel: PawProviderSubAgentModelResolver;
	completeSimple?: PawProviderSubAgentCompleteSimple;
};

export type PawProviderSubAgentRegistryAuthResult =
	| {
			ok: true;
			apiKey?: string;
			headers?: Record<string, string>;
	  }
	| {
			ok: false;
			error: string;
	  };

export type PawProviderSubAgentModelRegistry = {
	find(provider: string, modelId: string): Model<Api> | undefined;
	hasConfiguredAuth(model: Model<Api>): boolean;
	getApiKeyAndHeaders(
		model: Model<Api>,
	): PawProviderSubAgentRegistryAuthResult | Promise<PawProviderSubAgentRegistryAuthResult>;
};

export type PawProviderSubAgentRegistryResolverInput = {
	modelRegistry: PawProviderSubAgentModelRegistry;
	defaultProvider?: string;
	defaultOptions?: SimpleStreamOptions;
};

export type PawProviderSubAgentRuntimeExecutorInput = PawProviderSubAgentRegistryResolverInput & {
	completeSimple?: PawProviderSubAgentCompleteSimple;
};

export type PawSubAgentRuntimeDecision = PawSubAgentResponseDecision & {
	executor_model_id?: string | null;
	executor_degraded?: PawSubAgentRuntimeDegradedMetadata | null;
};

type PawSubAgentRuntimeExecutorMetadata = {
	executor_model_id?: string | null;
	executor_degraded?: PawSubAgentRuntimeDegradedMetadata | null;
};

export function createPawProviderSubAgentExecutor(input: PawProviderSubAgentExecutorInput): PawSubAgentRuntimeExecutor {
	return async (invocation) => {
		const completionInput = createPawProviderSubAgentCompletionInput(invocation);
		if (completionInput === undefined) {
			return createProviderUnavailableExecutorResult(invocation, null, "No Paw sub-agent model was selected.");
		}

		try {
			const result = await input.complete(completionInput);
			return {
				raw_output: result.text,
				model_id: result.model_id ?? completionInput.model_id,
				degraded: result.degraded,
			};
		} catch (error) {
			return createProviderUnavailableExecutorResult(invocation, completionInput.model_id, getErrorMessage(error));
		}
	};
}

export function createPawCompleteSimpleSubAgentCompletion(
	input: PawProviderSubAgentCompleteSimpleInput,
): PawProviderSubAgentCompletion {
	return async (completionInput) => {
		const resolved = await input.resolveModel(completionInput);
		const message = await (input.completeSimple ?? completeSimple)(
			resolved.model,
			createPawProviderSubAgentContext(completionInput.prompt),
			resolved.options,
		);
		return {
			text: extractAssistantText(message),
			model_id: message.responseModel ?? message.model ?? resolved.model.id,
		};
	};
}

export function createPawModelRegistrySubAgentResolver(
	input: PawProviderSubAgentRegistryResolverInput,
): PawProviderSubAgentModelResolver {
	return async (completionInput) => {
		const modelRef = parsePawProviderModelRef(completionInput.model_id, input.defaultProvider);
		const model = input.modelRegistry.find(modelRef.provider, modelRef.modelId);
		if (model === undefined) {
			throw new Error(`Paw sub-agent model ${modelRef.provider}/${modelRef.modelId} was not found.`);
		}
		if (!input.modelRegistry.hasConfiguredAuth(model)) {
			throw new Error(`Paw sub-agent model ${modelRef.provider}/${modelRef.modelId} has no configured auth.`);
		}

		const auth = await input.modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok) {
			throw new Error(auth.error);
		}

		return {
			model,
			options: mergePawProviderSubAgentOptions(input.defaultOptions, auth),
		};
	};
}

export function createPawProviderSubAgentRuntimeExecutor(
	input: PawProviderSubAgentRuntimeExecutorInput,
): PawSubAgentRuntimeExecutor {
	return createPawProviderSubAgentExecutor({
		complete: createPawCompleteSimpleSubAgentCompletion({
			resolveModel: createPawModelRegistrySubAgentResolver(input),
			completeSimple: input.completeSimple,
		}),
	});
}

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

function parsePawProviderModelRef(
	modelId: string,
	defaultProvider: string | undefined,
): { provider: string; modelId: string } {
	const trimmed = modelId.trim();
	if (trimmed.length === 0) {
		throw new Error("Paw sub-agent model id cannot be blank.");
	}

	const slashIndex = trimmed.indexOf("/");
	if (slashIndex === -1) {
		if (defaultProvider === undefined || defaultProvider.trim().length === 0) {
			throw new Error(`Paw sub-agent model ${JSON.stringify(trimmed)} must include provider/model.`);
		}
		return { provider: defaultProvider, modelId: trimmed };
	}

	const provider = trimmed.slice(0, slashIndex);
	const model = trimmed.slice(slashIndex + 1);
	if (provider.length === 0 || model.length === 0) {
		throw new Error(`Paw sub-agent model ${JSON.stringify(trimmed)} must include provider/model.`);
	}
	return { provider, modelId: model };
}

function mergePawProviderSubAgentOptions(
	defaultOptions: SimpleStreamOptions | undefined,
	auth: Extract<PawProviderSubAgentRegistryAuthResult, { ok: true }>,
): SimpleStreamOptions {
	return {
		...defaultOptions,
		apiKey: auth.apiKey ?? defaultOptions?.apiKey,
		headers: { ...defaultOptions?.headers, ...auth.headers },
	};
}

function createPawProviderSubAgentCompletionInput(
	invocation: PawSubAgentRuntimeInvocation,
): PawProviderSubAgentCompletionInput | undefined {
	const modelId = invocation.model_id ?? null;
	if (modelId === null || modelId.trim().length === 0) {
		return undefined;
	}

	return {
		invocation,
		model_id: modelId,
		prompt: createPawProviderSubAgentPrompt(invocation),
	};
}

function createPawProviderSubAgentPrompt(invocation: PawSubAgentRuntimeInvocation): PawProviderSubAgentPrompt {
	return {
		systemPrompt: `You are the Paw ${invocation.role} sub-agent. Return exactly one JSON object that satisfies the Paw sub-agent output contract.`,
		userPrompt: [
			`session_id: ${invocation.session_id}`,
			`slice_id: ${invocation.slice_id ?? "null"}`,
			`artifact_ref: ${invocation.artifact_ref}`,
			`attempt_number: ${invocation.attempt_number}`,
			"handoff:",
			invocation.handoff,
		].join("\n"),
	};
}

function createPawProviderSubAgentContext(prompt: PawProviderSubAgentPrompt): Context {
	return {
		systemPrompt: prompt.systemPrompt,
		messages: [
			{
				role: "user",
				content: prompt.userPrompt,
				timestamp: 0,
			},
		],
	};
}

function extractAssistantText(message: AssistantMessage): string {
	return message.content
		.filter(isTextContent)
		.map((content) => content.text)
		.join("\n");
}

function isTextContent(content: AssistantMessage["content"][number]): content is TextContent {
	return content.type === "text";
}

function createProviderUnavailableExecutorResult(
	invocation: PawSubAgentRuntimeInvocation,
	modelId: string | null,
	message: string,
): PawSubAgentRuntimeExecutorResult {
	return {
		raw_output: JSON.stringify(createProviderUnavailableOutput(invocation, modelId, message)),
		model_id: modelId,
		degraded: {
			reason: "provider_unavailable",
			details: message,
		},
	};
}

function createProviderUnavailableOutput(
	invocation: PawSubAgentRuntimeInvocation,
	modelId: string | null,
	message: string,
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
			{
				description: "Paw sub-agent provider execution is unavailable.",
				severity: "high",
			},
		],
		next_actions: ["Configure a Paw provider-backed sub-agent executor before retrying."],
		blocked_reason: {
			code: "PROVIDER_UNAVAILABLE",
			message,
			suggested_action: "Configure a supported Paw provider and retry the sub-agent step.",
		},
		tokens_used: 0,
		usd_cost: 0,
		degraded: true,
		model_used: modelId,
	};
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim().length > 0) {
		return error.message;
	}
	return "Paw sub-agent provider did not return a completion.";
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
