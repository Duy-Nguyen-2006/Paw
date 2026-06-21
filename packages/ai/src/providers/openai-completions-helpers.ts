/**
 * Stream processing and client construction helpers for OpenAI Chat Completions provider.
 */

import OpenAI from "openai";
import type { ChatCompletionChunk } from "openai/resources/chat/completions.js";
import type {
	AssistantMessage,
	Context,
	Model,
	OpenAICompletionsCompat,
	StreamOptions,
	TextContent,
	ThinkingContent,
	ToolCall,
} from "../types.ts";
import type { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { headersToRecord } from "../utils/headers.ts";
import { parseStreamingJson } from "../utils/json-parse.ts";
import { isCloudflareProvider, resolveCloudflareBaseUrl } from "./cloudflare.ts";
import { buildCopilotDynamicHeaders, hasCopilotVisionInput } from "./github-copilot-headers.ts";

export interface OpenAICompletionsOptions extends StreamOptions {
	toolChoice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
	reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
}

export type ResolvedOpenAICompletionsCompat = Omit<Required<OpenAICompletionsCompat>, "cacheControlFormat"> & {
	cacheControlFormat?: OpenAICompletionsCompat["cacheControlFormat"];
};

export interface StreamingToolCallBlock extends ToolCall {
	partialArgs?: string;
	streamIndex?: number;
}

export type StreamingBlock = TextContent | ThinkingContent | StreamingToolCallBlock;
export type StreamingToolCallDelta = NonNullable<ChatCompletionChunk.Choice.Delta["tool_calls"]>[number];

export interface CompletionStreamState {
	textBlock: TextContent | null;
	thinkingBlock: ThinkingContent | null;
	hasFinishReason: boolean;
	toolCallBlocksByIndex: Map<number, StreamingToolCallBlock>;
	toolCallBlocksById: Map<string, StreamingToolCallBlock>;
}

export function createCompletionStreamState(): CompletionStreamState {
	return {
		textBlock: null,
		thinkingBlock: null,
		hasFinishReason: false,
		toolCallBlocksByIndex: new Map(),
		toolCallBlocksById: new Map(),
	};
}

export function createInitialCompletionOutput(model: Model<"openai-completions">): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

export function buildCompletionRequestOptions(options?: OpenAICompletionsOptions) {
	return {
		...(options?.signal ? { signal: options.signal } : {}),
		...(options?.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
		maxRetries: options?.maxRetries ?? 0,
	};
}

function mergeCopilotClientHeaders(
	model: Model<"openai-completions">,
	context: Context,
	headers: Record<string, string>,
): void {
	if (model.provider !== "github-copilot") return;
	const hasImages = hasCopilotVisionInput(context.messages);
	const copilotHeaders = buildCopilotDynamicHeaders({
		messages: context.messages,
		hasImages,
	});
	Object.assign(headers, copilotHeaders);
}

function mergeSessionAffinityHeaders(
	headers: Record<string, string>,
	sessionId: string | undefined,
	compat: ResolvedOpenAICompletionsCompat,
): void {
	if (!sessionId || !compat.sendSessionAffinityHeaders) return;
	headers.session_id = sessionId;
	headers["x-client-request-id"] = sessionId;
	headers["x-session-affinity"] = sessionId;
}

function buildCompletionsDefaultHeaders(
	model: Model<"openai-completions">,
	headers: Record<string, string>,
	apiKey: string,
): Record<string, string | null> {
	if (model.provider === "cloudflare-ai-gateway") {
		return {
			...headers,
			Authorization: headers.Authorization ?? null,
			"cf-aig-authorization": `Bearer ${apiKey}`,
		};
	}
	return headers;
}

export function createOpenAICompletionsClient(
	model: Model<"openai-completions">,
	context: Context,
	apiKey: string,
	optionsHeaders?: Record<string, string>,
	sessionId?: string,
	compat?: ResolvedOpenAICompletionsCompat,
) {
	const headers = { ...model.headers };
	mergeCopilotClientHeaders(model, context, headers);
	if (compat) {
		mergeSessionAffinityHeaders(headers, sessionId, compat);
	}
	if (optionsHeaders) {
		Object.assign(headers, optionsHeaders);
	}
	const defaultHeaders = buildCompletionsDefaultHeaders(model, headers, apiKey);
	return new OpenAI({
		apiKey,
		baseURL: isCloudflareProvider(model.provider) ? resolveCloudflareBaseUrl(model) : model.baseUrl,
		dangerouslyAllowBrowser: true,
		defaultHeaders,
	});
}

export interface CompletionStreamProcessorDeps {
	stream: AssistantMessageEventStream;
	output: AssistantMessage;
	model: Model<"openai-completions">;
	state: CompletionStreamState;
	blocks: StreamingBlock[];
	parseChunkUsage: (
		rawUsage: {
			prompt_tokens?: number;
			completion_tokens?: number;
			prompt_cache_hit_tokens?: number;
			prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
		},
		model: Model<"openai-completions">,
	) => AssistantMessage["usage"];
	mapStopReason: (reason: ChatCompletionChunk.Choice["finish_reason"] | string) => {
		stopReason: AssistantMessage["stopReason"];
		errorMessage?: string;
	};
}

export function createCompletionStreamProcessor(deps: CompletionStreamProcessorDeps) {
	const { stream, output, model, state, blocks, parseChunkUsage, mapStopReason } = deps;
	const getContentIndex = (block: StreamingBlock) => blocks.indexOf(block);

	const ensureTextBlock = (): TextContent => {
		if (!state.textBlock) {
			state.textBlock = { type: "text", text: "" };
			blocks.push(state.textBlock);
			stream.push({ type: "text_start", contentIndex: getContentIndex(state.textBlock), partial: output });
		}
		return state.textBlock;
	};

	const ensureThinkingBlock = (thinkingSignature: string): ThinkingContent => {
		if (!state.thinkingBlock) {
			state.thinkingBlock = {
				type: "thinking",
				thinking: "",
				thinkingSignature,
			};
			blocks.push(state.thinkingBlock);
			stream.push({
				type: "thinking_start",
				contentIndex: getContentIndex(state.thinkingBlock),
				partial: output,
			});
		}
		return state.thinkingBlock;
	};

	const ensureToolCallBlock = (toolCall: StreamingToolCallDelta): StreamingToolCallBlock => {
		const streamIndex = typeof toolCall.index === "number" ? toolCall.index : undefined;
		let block = streamIndex !== undefined ? state.toolCallBlocksByIndex.get(streamIndex) : undefined;
		if (!block && toolCall.id) {
			block = state.toolCallBlocksById.get(toolCall.id);
		}
		if (!block) {
			block = {
				type: "toolCall",
				id: toolCall.id || "",
				name: toolCall.function?.name || "",
				arguments: {},
				partialArgs: "",
				streamIndex,
			};
			if (streamIndex !== undefined) {
				state.toolCallBlocksByIndex.set(streamIndex, block);
			}
			if (toolCall.id) {
				state.toolCallBlocksById.set(toolCall.id, block);
			}
			blocks.push(block);
			stream.push({
				type: "toolcall_start",
				contentIndex: getContentIndex(block),
				partial: output,
			});
		}
		if (streamIndex !== undefined && block.streamIndex === undefined) {
			block.streamIndex = streamIndex;
			state.toolCallBlocksByIndex.set(streamIndex, block);
		}
		if (toolCall.id) {
			state.toolCallBlocksById.set(toolCall.id, block);
		}
		return block;
	};

	const applyChunkMetadata = (chunk: ChatCompletionChunk): void => {
		output.responseId ||= chunk.id;
		if (typeof chunk.model === "string" && chunk.model.length > 0 && chunk.model !== model.id) {
			output.responseModel ||= chunk.model;
		}
		if (chunk.usage) {
			output.usage = parseChunkUsage(chunk.usage, model);
		}
	};

	const applyTextDelta = (delta: string): void => {
		const block = ensureTextBlock();
		block.text += delta;
		stream.push({
			type: "text_delta",
			contentIndex: getContentIndex(block),
			delta,
			partial: output,
		});
	};

	const applyReasoningDelta = (choice: ChatCompletionChunk.Choice): void => {
		const reasoningFields = ["reasoning_content", "reasoning", "reasoning_text"];
		const deltaFields = choice.delta as Record<string, unknown>;
		let foundReasoningField: string | null = null;
		for (const field of reasoningFields) {
			const value = deltaFields[field];
			if (typeof value === "string" && value.length > 0) {
				foundReasoningField = field;
				break;
			}
		}
		if (!foundReasoningField) return;
		const delta = deltaFields[foundReasoningField];
		if (typeof delta !== "string" || delta.length === 0) return;
		const thinkingSignature =
			model.provider === "opencode-go" && foundReasoningField === "reasoning"
				? "reasoning_content"
				: foundReasoningField;
		const block = ensureThinkingBlock(thinkingSignature);
		block.thinking += delta;
		stream.push({
			type: "thinking_delta",
			contentIndex: getContentIndex(block),
			delta,
			partial: output,
		});
	};

	const applyToolCallDeltas = (toolCalls: NonNullable<ChatCompletionChunk.Choice.Delta["tool_calls"]>): void => {
		for (const toolCall of toolCalls) {
			const block = ensureToolCallBlock(toolCall);
			if (!block.id && toolCall.id) {
				block.id = toolCall.id;
				state.toolCallBlocksById.set(toolCall.id, block);
			}
			if (!block.name && toolCall.function?.name) {
				block.name = toolCall.function.name;
			}
			let delta = "";
			if (toolCall.function?.arguments) {
				delta = toolCall.function.arguments;
				block.partialArgs = (block.partialArgs ?? "") + toolCall.function.arguments;
				block.arguments = parseStreamingJson(block.partialArgs);
			}
			stream.push({
				type: "toolcall_delta",
				contentIndex: getContentIndex(block),
				delta,
				partial: output,
			});
		}
	};

	const applyReasoningDetails = (reasoningDetails: unknown): void => {
		if (!reasoningDetails || !Array.isArray(reasoningDetails)) return;
		for (const detail of reasoningDetails) {
			if (detail.type === "reasoning.encrypted" && detail.id && detail.data) {
				const matchingToolCall = output.content.find((b) => b.type === "toolCall" && b.id === detail.id) as
					| ToolCall
					| undefined;
				if (matchingToolCall) {
					matchingToolCall.thoughtSignature = JSON.stringify(detail);
				}
			}
		}
	};

	const applyChoiceDelta = (choice: ChatCompletionChunk.Choice): void => {
		if (!choice.delta) return;
		if (choice.delta.content !== null && choice.delta.content !== undefined && choice.delta.content.length > 0) {
			applyTextDelta(choice.delta.content);
		}
		applyReasoningDelta(choice);
		if (choice.delta.tool_calls) {
			applyToolCallDeltas(choice.delta.tool_calls);
		}
		const reasoningDetails = (choice.delta as { reasoning_details?: unknown }).reasoning_details;
		applyReasoningDetails(reasoningDetails);
	};

	const processChunk = (chunk: ChatCompletionChunk): void => {
		applyChunkMetadata(chunk);
		const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined;
		if (!choice) return;
		if (!chunk.usage && (choice as { usage?: unknown }).usage) {
			output.usage = parseChunkUsage(
				(choice as unknown as { usage: Parameters<typeof parseChunkUsage>[0] }).usage,
				model,
			);
		}
		if (choice.finish_reason) {
			const finishReasonResult = mapStopReason(choice.finish_reason);
			output.stopReason = finishReasonResult.stopReason;
			if (finishReasonResult.errorMessage) {
				output.errorMessage = finishReasonResult.errorMessage;
			}
			state.hasFinishReason = true;
		}
		applyChoiceDelta(choice);
	};

	const finishBlock = (block: StreamingBlock) => {
		const contentIndex = getContentIndex(block);
		if (contentIndex === -1) return;
		if (block.type === "text") {
			stream.push({
				type: "text_end",
				contentIndex,
				content: block.text,
				partial: output,
			});
		} else if (block.type === "thinking") {
			stream.push({
				type: "thinking_end",
				contentIndex,
				content: block.thinking,
				partial: output,
			});
		} else if (block.type === "toolCall") {
			block.arguments = parseStreamingJson(block.partialArgs);
			delete block.partialArgs;
			delete block.streamIndex;
			stream.push({
				type: "toolcall_end",
				contentIndex,
				toolCall: block,
				partial: output,
			});
		}
	};

	return { processChunk, finishBlock };
}

export async function consumeOpenAICompletionStream(
	openaiStream: AsyncIterable<unknown>,
	processChunk: (chunk: ChatCompletionChunk) => void,
): Promise<void> {
	for await (const chunk of openaiStream) {
		if (!chunk || typeof chunk !== "object") continue;
		processChunk(chunk as ChatCompletionChunk);
	}
}

export function assertCompletionStreamFinished(
	output: AssistantMessage,
	state: CompletionStreamState,
	options?: Pick<StreamOptions, "signal">,
): void {
	if (options?.signal?.aborted) {
		throw new Error("Request was aborted");
	}
	if (output.stopReason === "aborted") {
		throw new Error("Request was aborted");
	}
	if (output.stopReason === "error") {
		throw new Error(output.errorMessage || "Provider returned an error stop reason");
	}
	if (!state.hasFinishReason) {
		throw new Error("Stream ended without finish_reason");
	}
}

export function stripCompletionStreamScratchFields(output: AssistantMessage): void {
	for (const block of output.content) {
		delete (block as { index?: number }).index;
		delete (block as { partialArgs?: string }).partialArgs;
		delete (block as { streamIndex?: number }).streamIndex;
	}
}

export function formatCompletionStreamError(
	error: unknown,
	options?: Pick<StreamOptions, "signal">,
): {
	stopReason: AssistantMessage["stopReason"];
	errorMessage: string;
} {
	const stopReason = options?.signal?.aborted ? "aborted" : "error";
	let errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
	const rawMetadata = (error as { error?: { metadata?: { raw?: string } } })?.error?.metadata?.raw;
	if (rawMetadata) errorMessage += `\n${rawMetadata}`;
	return { stopReason, errorMessage };
}

export async function notifyCompletionOnResponse(
	options: OpenAICompletionsOptions | undefined,
	response: { status: number; headers: Headers },
	model: Model<"openai-completions">,
): Promise<void> {
	await options?.onResponse?.({ status: response.status, headers: headersToRecord(response.headers) }, model);
}
