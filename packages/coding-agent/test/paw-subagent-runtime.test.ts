import type { AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { describe, expect, test } from "vitest";
import {
	createPawCompleteSimpleSubAgentCompletion,
	createPawModelRegistrySubAgentResolver,
	createPawProviderSubAgentExecutor,
	createPawProviderSubAgentRuntimeExecutor,
	type PawProviderSubAgentCompletionInput,
	type PawProviderSubAgentModelRegistry,
	type PawSubAgentOutput,
	type PawSubAgentRole,
	type PawSubAgentRuntimeExecutor,
	type PawSubAgentRuntimeInvocation,
	runPawSubAgentRuntime,
	validatePawSubAgentOutput,
} from "../src/paw/index.ts";

function createInvocation(overrides: Partial<PawSubAgentRuntimeInvocation> = {}): PawSubAgentRuntimeInvocation {
	return {
		role: "worker",
		session_id: "session-1",
		slice_id: "slice-1",
		artifact_ref: ".paw/artifacts/session-1/worker/report.md",
		handoff: "Implement the selected slice.",
		handoff_token_estimate: 32,
		max_handoff_tokens: 100,
		attempt_number: 1,
		model_id: "requested-model",
		...overrides,
	};
}

function createPawSubAgentOutput(
	agent: PawSubAgentRole,
	overrides: Partial<PawSubAgentOutput> = {},
): PawSubAgentOutput {
	return {
		status: "pass",
		confidence: "high",
		agent,
		session_id: "session-1",
		slice_id: "slice-1",
		artifact_ref: `.paw/artifacts/session-1/${agent}/report.md`,
		changed_files: [],
		inspected_files: [],
		risks: [],
		next_actions: [],
		tokens_used: 42,
		usd_cost: 0.01,
		degraded: false,
		model_used: "model-1",
		...overrides,
	};
}

function createAssistantMessage(text: string, overrides: Partial<AssistantMessage> = {}): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "fake-provider",
		model: "fake-model",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 0,
		...overrides,
	};
}

function createModel(overrides: Partial<Model<"anthropic-messages">> = {}): Model<"anthropic-messages"> {
	return {
		id: "fake-model",
		name: "Fake Model",
		api: "anthropic-messages",
		provider: "fake-provider",
		baseUrl: "http://localhost:0",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 4096,
		...overrides,
	};
}

function createFakeModelRegistry(
	overrides: Partial<PawProviderSubAgentModelRegistry> = {},
): PawProviderSubAgentModelRegistry {
	const model = createModel();
	return {
		find: (provider, modelId) => (provider === model.provider && modelId === model.id ? model : undefined),
		hasConfiguredAuth: () => true,
		getApiKeyAndHeaders: () => ({ ok: true, apiKey: "fake-key", headers: { "x-fake": "1" } }),
		...overrides,
	};
}

describe("runPawSubAgentRuntime", () => {
	test("accepts valid executor output", async () => {
		const output = createPawSubAgentOutput("worker");
		const receivedInvocations: PawSubAgentRuntimeInvocation[] = [];
		const executor: PawSubAgentRuntimeExecutor = (invocation) => {
			receivedInvocations.push(invocation);
			return { raw_output: JSON.stringify(output), model_id: "executor-model" };
		};

		const decision = await runPawSubAgentRuntime(createInvocation(), executor);

		expect(receivedInvocations).toEqual([createInvocation()]);
		expect(decision.status).toBe("accepted");
		expect(decision.attempts).toBe(1);
		if (decision.status === "accepted") {
			expect(decision.output).toEqual(output);
		}
	});

	test("returns retry for invalid executor JSON before attempts are exhausted", async () => {
		const decision = await runPawSubAgentRuntime(createInvocation(), () => ({ raw_output: "{not json" }));

		expect(decision.status).toBe("retry");
		expect(decision.attempts).toBe(1);
		if (decision.status === "retry") {
			expect(decision.issues[0]?.path).toBe("/");
			expect(decision.message).toContain("Sub-agent response did not match the required contract");
		}
	});

	test("returns blocked output for invalid executor JSON when attempts are exhausted", async () => {
		const decision = await runPawSubAgentRuntime(
			createInvocation({ attempt_number: 2, model_id: "requested-model-2" }),
			() => ({ raw_output: "{not json", model_id: "executor-model-2" }),
		);

		expect(decision.status).toBe("blocked");
		expect(decision.attempts).toBe(2);
		if (decision.status === "blocked") {
			expect(decision.output.status).toBe("blocked");
			expect(decision.output.model_used).toBe("executor-model-2");
			expect(validatePawSubAgentOutput(decision.output).ok).toBe(true);
		}
	});

	test("blocks oversized handoff without invoking executor", async () => {
		let executorCalls = 0;
		const decision = await runPawSubAgentRuntime(
			createInvocation({ handoff_token_estimate: 101, max_handoff_tokens: 100 }),
			() => {
				executorCalls += 1;
				return { raw_output: JSON.stringify(createPawSubAgentOutput("worker")) };
			},
		);

		expect(executorCalls).toBe(0);
		expect(decision.status).toBe("blocked");
		expect(decision.attempts).toBe(1);
		if (decision.status === "blocked") {
			expect(decision.issues).toContainEqual({
				path: "/handoff_token_estimate",
				message: "Estimated handoff tokens 101 exceed max_handoff_tokens 100.",
			});
			expect(decision.output.status).toBe("blocked");
			expect(decision.output.blocked_reason?.code).toBe("BUDGET_EXCEEDED");
			expect(validatePawSubAgentOutput(decision.output).ok).toBe(true);
		}
	});
});

describe("createPawProviderSubAgentExecutor", () => {
	test("adapts provider completion text into runtime executor output", async () => {
		const output = createPawSubAgentOutput("worker", { model_used: "provider-model" });
		const completions: PawProviderSubAgentCompletionInput[] = [];
		const executor = createPawProviderSubAgentExecutor({
			complete: (input) => {
				completions.push(input);
				return { text: JSON.stringify(output), model_id: "provider-model" };
			},
		});

		const decision = await runPawSubAgentRuntime(createInvocation({ model_id: "provider-model" }), executor);

		expect(completions).toHaveLength(1);
		expect(completions[0]?.model_id).toBe("provider-model");
		expect(completions[0]?.prompt.systemPrompt).toContain("Paw worker sub-agent");
		expect(completions[0]?.prompt.userPrompt).toContain("session_id: session-1");
		expect(completions[0]?.prompt.userPrompt).toContain("handoff:\nImplement the selected slice.");
		expect(decision.status).toBe("accepted");
		expect(decision.executor_model_id).toBe("provider-model");
		if (decision.status === "accepted") {
			expect(decision.output).toEqual(output);
		}
	});

	test("returns retry for invalid provider completion text through runtime validation", async () => {
		const executor = createPawProviderSubAgentExecutor({
			complete: () => ({ text: "not-json", model_id: "provider-model" }),
		});

		const decision = await runPawSubAgentRuntime(createInvocation({ model_id: "provider-model" }), executor);

		expect(decision.status).toBe("retry");
		expect(decision.executor_model_id).toBe("provider-model");
	});

	test("fails closed when the provider completion throws", async () => {
		const executor = createPawProviderSubAgentExecutor({
			complete: () => {
				throw new Error("provider missing credentials");
			},
		});

		const decision = await runPawSubAgentRuntime(createInvocation({ model_id: "provider-model" }), executor);

		expect(decision.status).toBe("accepted");
		expect(decision.executor_model_id).toBe("provider-model");
		expect(decision.executor_degraded).toEqual({
			reason: "provider_unavailable",
			details: "provider missing credentials",
		});
		if (decision.status === "accepted") {
			expect(decision.output.status).toBe("blocked");
			expect(decision.output.blocked_reason?.code).toBe("PROVIDER_UNAVAILABLE");
			expect(decision.output.model_used).toBe("provider-model");
			expect(validatePawSubAgentOutput(decision.output).ok).toBe(true);
		}
	});

	test("fails closed before invoking provider completion when no model is selected", async () => {
		let completions = 0;
		const executor = createPawProviderSubAgentExecutor({
			complete: () => {
				completions += 1;
				return { text: JSON.stringify(createPawSubAgentOutput("worker")) };
			},
		});

		const decision = await runPawSubAgentRuntime(createInvocation({ model_id: null }), executor);

		expect(completions).toBe(0);
		expect(decision.status).toBe("accepted");
		expect(decision.executor_model_id).toBeNull();
		if (decision.status === "accepted") {
			expect(decision.output.status).toBe("blocked");
			expect(decision.output.blocked_reason?.code).toBe("PROVIDER_UNAVAILABLE");
			expect(decision.output.model_used).toBeNull();
			expect(validatePawSubAgentOutput(decision.output).ok).toBe(true);
		}
	});
});

describe("createPawProviderSubAgentRuntimeExecutor", () => {
	test("composes registry resolution and completeSimple execution through runtime validation", async () => {
		const output = createPawSubAgentOutput("worker", { model_used: "fake-model" });
		const contexts: Context[] = [];
		const executor = createPawProviderSubAgentRuntimeExecutor({
			modelRegistry: createFakeModelRegistry(),
			defaultProvider: "fake-provider",
			defaultOptions: { maxTokens: 222 },
			completeSimple: async (_model, context, options) => {
				contexts.push(context);
				return createAssistantMessage(JSON.stringify(output), {
					model: options?.maxTokens === 222 && options.apiKey === "fake-key" ? "fake-model" : "bad-model",
				});
			},
		});

		const decision = await runPawSubAgentRuntime(createInvocation({ model_id: "fake-model" }), executor);

		expect(contexts[0]?.systemPrompt).toContain("Paw worker sub-agent");
		expect(contexts[0]?.messages[0]).toMatchObject({
			role: "user",
			content: expect.stringContaining("slice_id: slice-1"),
		});
		expect(decision.status).toBe("accepted");
		expect(decision.executor_model_id).toBe("fake-model");
		if (decision.status === "accepted") {
			expect(decision.output).toEqual(output);
		}
	});

	test("fails closed when composed registry resolution rejects", async () => {
		const executor = createPawProviderSubAgentRuntimeExecutor({
			modelRegistry: createFakeModelRegistry({ hasConfiguredAuth: () => false }),
			defaultProvider: "fake-provider",
			completeSimple: async () => createAssistantMessage("should not be called"),
		});

		const decision = await runPawSubAgentRuntime(createInvocation({ model_id: "fake-model" }), executor);

		expect(decision.status).toBe("accepted");
		expect(decision.executor_degraded?.reason).toBe("provider_unavailable");
		if (decision.status === "accepted") {
			expect(decision.output.status).toBe("blocked");
			expect(decision.output.blocked_reason?.code).toBe("PROVIDER_UNAVAILABLE");
			expect(decision.output.blocked_reason?.message).toContain("has no configured auth");
		}
	});

	test("does not call completeSimple when invocation has no selected model", async () => {
		let completions = 0;
		const executor = createPawProviderSubAgentRuntimeExecutor({
			modelRegistry: createFakeModelRegistry(),
			defaultProvider: "fake-provider",
			completeSimple: async () => {
				completions += 1;
				return createAssistantMessage("should not be called");
			},
		});

		const decision = await runPawSubAgentRuntime(createInvocation({ model_id: null }), executor);

		expect(completions).toBe(0);
		expect(decision.status).toBe("accepted");
		if (decision.status === "accepted") {
			expect(decision.output.status).toBe("blocked");
			expect(decision.output.blocked_reason?.code).toBe("PROVIDER_UNAVAILABLE");
		}
	});
});

describe("createPawModelRegistrySubAgentResolver", () => {
	test("resolves provider-qualified model references with auth options", async () => {
		const resolver = createPawModelRegistrySubAgentResolver({
			modelRegistry: createFakeModelRegistry(),
			defaultOptions: { maxTokens: 321, headers: { "x-default": "yes" } },
		});

		const result = await resolver({
			invocation: createInvocation({ model_id: "fake-provider/fake-model" }),
			model_id: "fake-provider/fake-model",
			prompt: { systemPrompt: "system", userPrompt: "user" },
		});

		expect(result.model.provider).toBe("fake-provider");
		expect(result.model.id).toBe("fake-model");
		expect(result.options).toEqual({
			maxTokens: 321,
			apiKey: "fake-key",
			headers: { "x-default": "yes", "x-fake": "1" },
		});
	});

	test("resolves bare model references with a default provider", async () => {
		const resolver = createPawModelRegistrySubAgentResolver({
			modelRegistry: createFakeModelRegistry(),
			defaultProvider: "fake-provider",
		});

		const result = await resolver({
			invocation: createInvocation({ model_id: "fake-model" }),
			model_id: "fake-model",
			prompt: { systemPrompt: "system", userPrompt: "user" },
		});

		expect(result.model.provider).toBe("fake-provider");
		expect(result.model.id).toBe("fake-model");
	});

	test("throws for bare model references without a default provider", async () => {
		const resolver = createPawModelRegistrySubAgentResolver({ modelRegistry: createFakeModelRegistry() });

		await expect(
			resolver({
				invocation: createInvocation({ model_id: "fake-model" }),
				model_id: "fake-model",
				prompt: { systemPrompt: "system", userPrompt: "user" },
			}),
		).rejects.toThrow('Paw sub-agent model "fake-model" must include provider/model.');
	});

	test("throws for unknown models", async () => {
		const resolver = createPawModelRegistrySubAgentResolver({ modelRegistry: createFakeModelRegistry() });

		await expect(
			resolver({
				invocation: createInvocation({ model_id: "fake-provider/missing-model" }),
				model_id: "fake-provider/missing-model",
				prompt: { systemPrompt: "system", userPrompt: "user" },
			}),
		).rejects.toThrow("Paw sub-agent model fake-provider/missing-model was not found.");
	});

	test("throws when resolved models have no configured auth", async () => {
		const resolver = createPawModelRegistrySubAgentResolver({
			modelRegistry: createFakeModelRegistry({ hasConfiguredAuth: () => false }),
		});

		await expect(
			resolver({
				invocation: createInvocation({ model_id: "fake-provider/fake-model" }),
				model_id: "fake-provider/fake-model",
				prompt: { systemPrompt: "system", userPrompt: "user" },
			}),
		).rejects.toThrow("Paw sub-agent model fake-provider/fake-model has no configured auth.");
	});

	test("throws when auth resolution fails", async () => {
		const resolver = createPawModelRegistrySubAgentResolver({
			modelRegistry: createFakeModelRegistry({ getApiKeyAndHeaders: () => ({ ok: false, error: "auth failed" }) }),
		});

		await expect(
			resolver({
				invocation: createInvocation({ model_id: "fake-provider/fake-model" }),
				model_id: "fake-provider/fake-model",
				prompt: { systemPrompt: "system", userPrompt: "user" },
			}),
		).rejects.toThrow("auth failed");
	});

	test("feeds completeSimple adapter without real provider calls", async () => {
		const output = createPawSubAgentOutput("worker", { model_used: "fake-model" });
		const completion = createPawCompleteSimpleSubAgentCompletion({
			resolveModel: createPawModelRegistrySubAgentResolver({
				modelRegistry: createFakeModelRegistry(),
				defaultProvider: "fake-provider",
			}),
			completeSimple: async (_model, _context, options) =>
				createAssistantMessage(JSON.stringify(output), {
					model: options?.apiKey === "fake-key" ? "fake-model" : "missing-auth",
				}),
		});

		const result = await completion({
			invocation: createInvocation({ model_id: "fake-model" }),
			model_id: "fake-model",
			prompt: { systemPrompt: "system", userPrompt: "user" },
		});

		expect(result).toEqual({ text: JSON.stringify(output), model_id: "fake-model" });
	});
});

describe("createPawCompleteSimpleSubAgentCompletion", () => {
	test("resolves a model and adapts completeSimple text into provider completion text", async () => {
		const output = createPawSubAgentOutput("worker", { model_used: "response-model" });
		const resolvedModels: PawProviderSubAgentCompletionInput[] = [];
		const contexts: Context[] = [];
		const optionsSeen: (SimpleStreamOptions | undefined)[] = [];
		const completion = createPawCompleteSimpleSubAgentCompletion({
			resolveModel: (input) => {
				resolvedModels.push(input);
				return { model: createModel(), options: { maxTokens: 123 } };
			},
			completeSimple: async (_model, context, options) => {
				contexts.push(context);
				optionsSeen.push(options);
				return createAssistantMessage(JSON.stringify(output), {
					model: "requested-model",
					responseModel: "response-model",
				});
			},
		});

		const result = await completion({
			invocation: createInvocation({ model_id: "requested-model" }),
			model_id: "requested-model",
			prompt: { systemPrompt: "system prompt", userPrompt: "user prompt" },
		});

		expect(resolvedModels).toHaveLength(1);
		expect(contexts).toEqual([
			{ systemPrompt: "system prompt", messages: [{ role: "user", content: "user prompt", timestamp: 0 }] },
		]);
		expect(optionsSeen).toEqual([{ maxTokens: 123 }]);
		expect(result).toEqual({ text: JSON.stringify(output), model_id: "response-model" });
	});

	test("tries failover models after a provider completion failure", async () => {
		const output = createPawSubAgentOutput("worker", { model_used: "fallback-model" });
		const seenModels: string[] = [];
		const completion = createPawCompleteSimpleSubAgentCompletion({
			resolveModel: (input) => ({ model: createModel({ id: input.model_id }), options: { maxTokens: 123 } }),
			completeSimple: async (model) => {
				seenModels.push(model.id);
				if (model.id !== "fallback-model") {
					throw new Error("primary provider unavailable");
				}
				return createAssistantMessage(JSON.stringify(output), { model: model.id });
			},
		});

		const result = await completion({
			invocation: createInvocation({ model_id: "primary-model" }),
			model_id: "primary-model",
			fallback_model_ids: ["fallback-model"],
			prompt: { systemPrompt: "system", userPrompt: "user" },
		});

		expect(seenModels).toEqual(["primary-model", "fallback-model"]);
		expect(result).toEqual({
			text: JSON.stringify(output),
			model_id: "fallback-model",
			degraded: {
				reason: "provider_failover",
				details: "Failed over from primary-model to fallback-model.",
			},
		});
	});

	test("joins multiple assistant text blocks and ignores non-text blocks", async () => {
		const completion = createPawCompleteSimpleSubAgentCompletion({
			resolveModel: () => ({ model: createModel({ id: "resolved-model" }) }),
			completeSimple: async () =>
				createAssistantMessage("", {
					content: [
						{ type: "thinking", thinking: "hidden" },
						{ type: "text", text: "first" },
						{ type: "text", text: "second" },
					],
					model: "resolved-model",
				}),
		});

		const result = await completion({
			invocation: createInvocation({ model_id: "requested-model" }),
			model_id: "requested-model",
			prompt: { systemPrompt: "system", userPrompt: "user" },
		});

		expect(result).toEqual({ text: "first\nsecond", model_id: "resolved-model" });
	});
});
