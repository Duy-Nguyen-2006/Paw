import type OpenAI from "openai";
import type {
	Tool as OpenAITool,
	ResponseCreateParamsStreaming,
	ResponseFunctionCallOutputItemList,
	ResponseFunctionToolCall,
	ResponseInput,
	ResponseInputContent,
	ResponseInputImage,
	ResponseInputText,
	ResponseOutputMessage,
	ResponseReasoningItem,
	ResponseStreamEvent,
} from "openai/resources/responses/responses.js";
import { calculateCost } from "../models.ts";
import type {
	Api,
	AssistantMessage,
	Context,
	ImageContent,
	Message,
	Model,
	StopReason,
	TextContent,
	TextSignatureV1,
	ThinkingContent,
	Tool,
	ToolCall,
	Usage,
} from "../types.ts";
import type { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { shortHash } from "../utils/hash.ts";
import { parseStreamingJson } from "../utils/json-parse.ts";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.ts";
import { transformMessages } from "./transform-messages.ts";

// =============================================================================
// Utilities
// =============================================================================

function encodeTextSignatureV1(id: string, phase?: TextSignatureV1["phase"]): string {
	const payload: TextSignatureV1 = { v: 1, id };
	if (phase) payload.phase = phase;
	return JSON.stringify(payload);
}

function parseTextSignature(
	signature: string | undefined,
): { id: string; phase?: TextSignatureV1["phase"] } | undefined {
	if (!signature) return undefined;
	if (signature.startsWith("{")) {
		try {
			const parsed = JSON.parse(signature) as Partial<TextSignatureV1>;
			if (parsed.v === 1 && typeof parsed.id === "string") {
				if (parsed.phase === "commentary" || parsed.phase === "final_answer") {
					return { id: parsed.id, phase: parsed.phase };
				}
				return { id: parsed.id };
			}
		} catch {
			// Fall through to legacy plain-string handling.
		}
	}
	return { id: signature };
}

export interface OpenAIResponsesStreamOptions {
	serviceTier?: ResponseCreateParamsStreaming["service_tier"];
	resolveServiceTier?: (
		responseServiceTier: ResponseCreateParamsStreaming["service_tier"] | undefined,
		requestServiceTier: ResponseCreateParamsStreaming["service_tier"] | undefined,
	) => ResponseCreateParamsStreaming["service_tier"] | undefined;
	applyServiceTierPricing?: (
		usage: Usage,
		serviceTier: ResponseCreateParamsStreaming["service_tier"] | undefined,
	) => void;
}

export interface ConvertResponsesMessagesOptions {
	includeSystemPrompt?: boolean;
}

export interface ConvertResponsesToolsOptions {
	strict?: boolean | null;
}

// =============================================================================
// Message conversion (helpers reduce convertResponsesMessages S3776)
// =============================================================================

function appendResponsesUserMessage(messages: ResponseInput, msg: Extract<Message, { role: "user" }>): void {
	if (typeof msg.content === "string") {
		messages.push({
			role: "user",
			content: [{ type: "input_text", text: sanitizeSurrogates(msg.content) }],
		});
		return;
	}
	const content: ResponseInputContent[] = msg.content.map((item): ResponseInputContent => {
		if (item.type === "text") {
			return {
				type: "input_text",
				text: sanitizeSurrogates(item.text),
			} satisfies ResponseInputText;
		}
		return {
			type: "input_image",
			detail: "auto",
			image_url: `data:${item.mimeType};base64,${item.data}`,
		} satisfies ResponseInputImage;
	});
	if (content.length === 0) return;
	messages.push({ role: "user", content });
}

function appendResponsesAssistantBlocks<TApi extends Api>(
	output: ResponseInput,
	msg: Extract<Message, { role: "assistant" }>,
	model: Model<TApi>,
	msgIndex: number,
): void {
	const assistantMsg = msg as AssistantMessage;
	const isDifferentModel =
		assistantMsg.model !== model.id && assistantMsg.provider === model.provider && assistantMsg.api === model.api;
	let textBlockIndex = 0;

	for (const block of msg.content) {
		if (block.type === "thinking") {
			appendResponsesThinkingBlock(output, block);
			continue;
		}
		if (block.type === "text") {
			appendResponsesTextBlock(output, block, msgIndex, textBlockIndex);
			textBlockIndex++;
			continue;
		}
		if (block.type === "toolCall") {
			appendResponsesToolCallBlock(output, block, isDifferentModel);
		}
	}
}

function appendResponsesThinkingBlock(output: ResponseInput, block: ThinkingContent): void {
	if (!block.thinkingSignature) return;
	const reasoningItem = JSON.parse(block.thinkingSignature) as ResponseReasoningItem;
	output.push(reasoningItem);
}

function appendResponsesTextBlock(
	output: ResponseInput,
	block: TextContent,
	msgIndex: number,
	textBlockIndex: number,
): void {
	const textBlock = block as TextContent;
	const parsedSignature = parseTextSignature(textBlock.textSignature);
	const fallbackMessageId = textBlockIndex === 0 ? `msg_pi_${msgIndex}` : `msg_pi_${msgIndex}_${textBlockIndex}`;
	let msgId = parsedSignature?.id;
	if (!msgId) {
		msgId = fallbackMessageId;
	} else if (msgId.length > 64) {
		msgId = `msg_${shortHash(msgId)}`;
	}
	output.push({
		type: "message",
		role: "assistant",
		content: [{ type: "output_text", text: sanitizeSurrogates(textBlock.text), annotations: [] }],
		status: "completed",
		id: msgId,
		phase: parsedSignature?.phase,
	} satisfies ResponseOutputMessage);
}

function appendResponsesToolCallBlock(output: ResponseInput, block: ToolCall, isDifferentModel: boolean): void {
	const toolCall = block as ToolCall;
	const [callId, itemIdRaw] = toolCall.id.split("|");
	let itemId: string | undefined = itemIdRaw;
	if (isDifferentModel && itemId?.startsWith("fc_")) {
		itemId = undefined;
	}
	output.push({
		type: "function_call",
		id: itemId,
		call_id: callId,
		name: toolCall.name,
		arguments: JSON.stringify(toolCall.arguments),
	});
}

function appendResponsesToolResultMessage<TApi extends Api>(
	messages: ResponseInput,
	msg: Extract<Message, { role: "toolResult" }>,
	model: Model<TApi>,
): void {
	const textResult = msg.content
		.filter((c): c is TextContent => c.type === "text")
		.map((c) => c.text)
		.join("\n");
	const hasImages = msg.content.some((c): c is ImageContent => c.type === "image");
	const hasText = textResult.length > 0;
	const [callId] = msg.toolCallId.split("|");

	let output: string | ResponseFunctionCallOutputItemList;
	if (hasImages && model.input.includes("image")) {
		output = buildResponsesToolResultImageOutput(msg.content, textResult, hasText);
	} else {
		output = sanitizeSurrogates(hasText ? textResult : "(see attached image)");
	}

	messages.push({
		type: "function_call_output",
		call_id: callId,
		output,
	});
}

function buildResponsesToolResultImageOutput(
	content: Extract<Message, { role: "toolResult" }>["content"],
	textResult: string,
	hasText: boolean,
): ResponseFunctionCallOutputItemList {
	const contentParts: ResponseFunctionCallOutputItemList = [];
	if (hasText) {
		contentParts.push({
			type: "input_text",
			text: sanitizeSurrogates(textResult),
		});
	}
	for (const block of content) {
		if (block.type === "image") {
			contentParts.push({
				type: "input_image",
				detail: "auto",
				image_url: `data:${block.mimeType};base64,${block.data}`,
			});
		}
	}
	return contentParts;
}

export function convertResponsesMessages<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	allowedToolCallProviders: ReadonlySet<string>,
	options?: ConvertResponsesMessagesOptions,
): ResponseInput {
	const messages: ResponseInput = [];

	const normalizeIdPart = (part: string): string => {
		const sanitized = part.replace(/[^a-zA-Z0-9_-]/g, "_");
		const normalized = sanitized.length > 64 ? sanitized.slice(0, 64) : sanitized;
		return normalized.replace(/_+$/, "");
	};

	const buildForeignResponsesItemId = (itemId: string): string => {
		const normalized = `fc_${shortHash(itemId)}`;
		return normalized.length > 64 ? normalized.slice(0, 64) : normalized;
	};

	const normalizeToolCallId = (id: string, _targetModel: Model<TApi>, source: AssistantMessage): string => {
		if (!allowedToolCallProviders.has(model.provider)) return normalizeIdPart(id);
		if (!id.includes("|")) return normalizeIdPart(id);
		const [callId, itemId] = id.split("|");
		const normalizedCallId = normalizeIdPart(callId);
		const isForeignToolCall = source.provider !== model.provider || source.api !== model.api;
		let normalizedItemId = isForeignToolCall ? buildForeignResponsesItemId(itemId) : normalizeIdPart(itemId);
		// OpenAI Responses API requires item id to start with "fc"
		if (!normalizedItemId.startsWith("fc_")) {
			normalizedItemId = normalizeIdPart(`fc_${normalizedItemId}`);
		}
		return `${normalizedCallId}|${normalizedItemId}`;
	};

	const transformedMessages = transformMessages(context.messages, model, normalizeToolCallId);

	const includeSystemPrompt = options?.includeSystemPrompt ?? true;
	if (includeSystemPrompt && context.systemPrompt) {
		const compat = model.compat as { supportsDeveloperRole?: boolean } | undefined;
		const role = model.reasoning && compat?.supportsDeveloperRole !== false ? "developer" : "system";
		messages.push({
			role,
			content: sanitizeSurrogates(context.systemPrompt),
		});
	}

	let msgIndex = 0;
	for (const msg of transformedMessages) {
		if (msg.role === "user") {
			appendResponsesUserMessage(messages, msg);
		} else if (msg.role === "assistant") {
			const output: ResponseInput = [];
			appendResponsesAssistantBlocks(output, msg, model, msgIndex);
			if (output.length === 0) continue;
			messages.push(...output);
		} else if (msg.role === "toolResult") {
			appendResponsesToolResultMessage(messages, msg, model);
		}
		msgIndex++;
	}

	return messages;
}

// =============================================================================
// Tool conversion
// =============================================================================

export function convertResponsesTools(tools: Tool[], options?: ConvertResponsesToolsOptions): OpenAITool[] {
	const strict = options?.strict === undefined ? false : options.strict;
	return tools.map((tool) => ({
		type: "function",
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters as any, // TypeBox already generates JSON Schema
		strict,
	}));
}

// =============================================================================
// Stream processing
// =============================================================================

type ResponsesStreamBlock = ThinkingContent | TextContent | (ToolCall & { partialJson: string });

interface ResponsesStreamState<TApi extends Api> {
	currentItem: ResponseReasoningItem | ResponseOutputMessage | ResponseFunctionToolCall | null;
	currentBlock: ResponsesStreamBlock | null;
	output: AssistantMessage;
	stream: AssistantMessageEventStream;
	model: Model<TApi>;
	options?: OpenAIResponsesStreamOptions;
	blockIndex: () => number;
}

function handleResponsesOutputItemAdded<TApi extends Api>(
	state: ResponsesStreamState<TApi>,
	item: Extract<ResponseStreamEvent, { type: "response.output_item.added" }>["item"],
): void {
	if (!item) return;
	const { output, stream, blockIndex } = state;
	if (item.type === "reasoning") {
		state.currentItem = item;
		state.currentBlock = { type: "thinking", thinking: "" };
		output.content.push(state.currentBlock);
		stream.push({ type: "thinking_start", contentIndex: blockIndex(), partial: output });
	} else if (item.type === "message") {
		state.currentItem = item;
		state.currentBlock = { type: "text", text: "" };
		output.content.push(state.currentBlock);
		stream.push({ type: "text_start", contentIndex: blockIndex(), partial: output });
	} else if (item.type === "function_call") {
		state.currentItem = item;
		state.currentBlock = {
			type: "toolCall",
			id: `${item.call_id}|${item.id}`,
			name: item.name,
			arguments: {},
			partialJson: item.arguments || "",
		};
		output.content.push(state.currentBlock);
		stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });
	}
}

function appendReasoningSummaryDelta<TApi extends Api>(
	state: ResponsesStreamState<TApi>,
	delta: string,
	separator?: string,
): void {
	const { currentItem, currentBlock, stream, output, blockIndex } = state;
	if (currentItem?.type !== "reasoning" || currentBlock?.type !== "thinking") return;
	currentItem.summary = currentItem.summary || [];
	const lastPart = currentItem.summary[currentItem.summary.length - 1];
	if (!lastPart) return;
	const append = separator ?? delta;
	currentBlock.thinking += append;
	if (separator) lastPart.text += separator;
	else lastPart.text += delta;
	stream.push({
		type: "thinking_delta",
		contentIndex: blockIndex(),
		delta: append,
		partial: output,
	});
}

function handleResponsesOutputItemDone<TApi extends Api>(
	state: ResponsesStreamState<TApi>,
	item: Extract<ResponseStreamEvent, { type: "response.output_item.done" }>["item"],
): void {
	const { currentBlock, stream, output, blockIndex } = state;
	if (item.type === "reasoning" && currentBlock?.type === "thinking") {
		const summaryText = item.summary?.map((s) => s.text).join("\n\n") || "";
		const contentText = item.content?.map((c) => c.text).join("\n\n") || "";
		currentBlock.thinking = summaryText || contentText || currentBlock.thinking;
		currentBlock.thinkingSignature = JSON.stringify(item);
		stream.push({
			type: "thinking_end",
			contentIndex: blockIndex(),
			content: currentBlock.thinking,
			partial: output,
		});
		state.currentBlock = null;
		return;
	}
	if (item.type === "message" && currentBlock?.type === "text") {
		currentBlock.text = item.content.map((c) => (c.type === "output_text" ? c.text : c.refusal)).join("");
		currentBlock.textSignature = encodeTextSignatureV1(item.id, item.phase ?? undefined);
		stream.push({
			type: "text_end",
			contentIndex: blockIndex(),
			content: currentBlock.text,
			partial: output,
		});
		state.currentBlock = null;
		return;
	}
	if (item.type === "function_call") {
		const args =
			currentBlock?.type === "toolCall" && currentBlock.partialJson
				? parseStreamingJson(currentBlock.partialJson)
				: parseStreamingJson(item.arguments || "{}");
		let toolCall: ToolCall;
		if (currentBlock?.type === "toolCall") {
			currentBlock.arguments = args;
			delete (currentBlock as { partialJson?: string }).partialJson;
			toolCall = currentBlock;
		} else {
			toolCall = {
				type: "toolCall",
				id: `${item.call_id}|${item.id}`,
				name: item.name,
				arguments: args,
			};
		}
		state.currentBlock = null;
		stream.push({ type: "toolcall_end", contentIndex: blockIndex(), toolCall, partial: output });
	}
}

function applyResponsesCompletedEvent<TApi extends Api>(
	state: ResponsesStreamState<TApi>,
	response: NonNullable<Extract<ResponseStreamEvent, { type: "response.completed" }>["response"]>,
): void {
	const { output, model, options } = state;
	if (response?.id) {
		output.responseId = response.id;
	}
	if (response?.usage) {
		const cachedTokens = response.usage.input_tokens_details?.cached_tokens || 0;
		output.usage = {
			input: (response.usage.input_tokens || 0) - cachedTokens,
			output: response.usage.output_tokens || 0,
			cacheRead: cachedTokens,
			cacheWrite: 0,
			totalTokens: response.usage.total_tokens || 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		};
	}
	calculateCost(model, output.usage);
	if (options?.applyServiceTierPricing) {
		const serviceTier = options.resolveServiceTier
			? options.resolveServiceTier(response?.service_tier, options.serviceTier)
			: (response?.service_tier ?? options.serviceTier);
		options.applyServiceTierPricing(output.usage, serviceTier);
	}
	output.stopReason = mapStopReason(response?.status);
	if (output.content.some((b) => b.type === "toolCall") && output.stopReason === "stop") {
		output.stopReason = "toolUse";
	}
}

function dispatchResponsesStreamEvent<TApi extends Api>(
	state: ResponsesStreamState<TApi>,
	event: ResponseStreamEvent,
): void {
	switch (event.type) {
		case "response.created":
			applyResponsesCreatedEvent(state, event);
			break;
		case "response.output_item.added":
			handleResponsesOutputItemAdded(state, event.item);
			break;
		case "response.reasoning_summary_part.added":
			applyResponsesReasoningSummaryPartAdded(state, event);
			break;
		case "response.reasoning_summary_text.delta":
			appendReasoningSummaryDelta(state, event.delta);
			break;
		case "response.reasoning_summary_part.done":
			appendReasoningSummaryDelta(state, "\n\n", "\n\n");
			break;
		case "response.reasoning_text.delta":
			applyResponsesReasoningTextDelta(state, event);
			break;
		case "response.content_part.added":
			applyResponsesContentPartAdded(state, event);
			break;
		case "response.output_text.delta":
			applyResponsesOutputTextDelta(state, event);
			break;
		case "response.refusal.delta":
			applyResponsesRefusalDelta(state, event);
			break;
		case "response.function_call_arguments.delta":
			applyResponsesFunctionCallArgumentsDelta(state, event);
			break;
		case "response.function_call_arguments.done":
			applyResponsesFunctionCallArgumentsDone(state, event);
			break;
		case "response.output_item.done":
			handleResponsesOutputItemDone(state, event.item);
			break;
		case "response.completed":
			applyResponsesCompletedEvent(state, event.response);
			break;
		case "error":
			throw new Error(`Error Code ${event.code}: ${event.message}`);
		case "response.failed":
			throwResponsesFailedError(event);
			break;
		default:
			break;
	}
}

function applyResponsesCreatedEvent<TApi extends Api>(
	state: ResponsesStreamState<TApi>,
	event: Extract<ResponseStreamEvent, { type: "response.created" }>,
): void {
	state.output.responseId = event.response.id;
}

function applyResponsesReasoningSummaryPartAdded<TApi extends Api>(
	state: ResponsesStreamState<TApi>,
	event: Extract<ResponseStreamEvent, { type: "response.reasoning_summary_part.added" }>,
): void {
	if (state.currentItem?.type !== "reasoning") return;
	state.currentItem.summary = state.currentItem.summary || [];
	state.currentItem.summary.push(event.part);
}

function applyResponsesReasoningTextDelta<TApi extends Api>(
	state: ResponsesStreamState<TApi>,
	event: Extract<ResponseStreamEvent, { type: "response.reasoning_text.delta" }>,
): void {
	const { currentItem, currentBlock, stream, output, blockIndex } = state;
	if (currentItem?.type !== "reasoning" || currentBlock?.type !== "thinking") return;
	currentBlock.thinking += event.delta;
	stream.push({
		type: "thinking_delta",
		contentIndex: blockIndex(),
		delta: event.delta,
		partial: output,
	});
}

function applyResponsesContentPartAdded<TApi extends Api>(
	state: ResponsesStreamState<TApi>,
	event: Extract<ResponseStreamEvent, { type: "response.content_part.added" }>,
): void {
	if (state.currentItem?.type !== "message") return;
	state.currentItem.content = state.currentItem.content || [];
	if (event.part.type === "output_text" || event.part.type === "refusal") {
		state.currentItem.content.push(event.part);
	}
}

function applyResponsesOutputTextDelta<TApi extends Api>(
	state: ResponsesStreamState<TApi>,
	event: Extract<ResponseStreamEvent, { type: "response.output_text.delta" }>,
): void {
	const { currentItem, currentBlock, stream, output, blockIndex } = state;
	if (currentItem?.type !== "message" || currentBlock?.type !== "text" || !currentItem.content?.length) return;
	const lastPart = currentItem.content[currentItem.content.length - 1];
	if (lastPart?.type !== "output_text") return;
	currentBlock.text += event.delta;
	lastPart.text += event.delta;
	stream.push({
		type: "text_delta",
		contentIndex: blockIndex(),
		delta: event.delta,
		partial: output,
	});
}

function applyResponsesRefusalDelta<TApi extends Api>(
	state: ResponsesStreamState<TApi>,
	event: Extract<ResponseStreamEvent, { type: "response.refusal.delta" }>,
): void {
	const { currentItem, currentBlock, stream, output, blockIndex } = state;
	if (currentItem?.type !== "message" || currentBlock?.type !== "text" || !currentItem.content?.length) return;
	const lastPart = currentItem.content[currentItem.content.length - 1];
	if (lastPart?.type !== "refusal") return;
	currentBlock.text += event.delta;
	lastPart.refusal += event.delta;
	stream.push({
		type: "text_delta",
		contentIndex: blockIndex(),
		delta: event.delta,
		partial: output,
	});
}

function applyResponsesFunctionCallArgumentsDelta<TApi extends Api>(
	state: ResponsesStreamState<TApi>,
	event: Extract<ResponseStreamEvent, { type: "response.function_call_arguments.delta" }>,
): void {
	const { currentItem, currentBlock, stream, output, blockIndex } = state;
	if (currentItem?.type !== "function_call" || currentBlock?.type !== "toolCall") return;
	currentBlock.partialJson += event.delta;
	currentBlock.arguments = parseStreamingJson(currentBlock.partialJson);
	stream.push({
		type: "toolcall_delta",
		contentIndex: blockIndex(),
		delta: event.delta,
		partial: output,
	});
}

function applyResponsesFunctionCallArgumentsDone<TApi extends Api>(
	state: ResponsesStreamState<TApi>,
	event: Extract<ResponseStreamEvent, { type: "response.function_call_arguments.done" }>,
): void {
	const { currentItem, currentBlock, stream, output, blockIndex } = state;
	if (currentItem?.type !== "function_call" || currentBlock?.type !== "toolCall") return;
	const previousPartialJson = currentBlock.partialJson;
	currentBlock.partialJson = event.arguments;
	currentBlock.arguments = parseStreamingJson(currentBlock.partialJson);
	if (event.arguments.startsWith(previousPartialJson)) {
		const delta = event.arguments.slice(previousPartialJson.length);
		if (delta.length > 0) {
			stream.push({
				type: "toolcall_delta",
				contentIndex: blockIndex(),
				delta,
				partial: output,
			});
		}
	}
}

function throwResponsesFailedError(event: Extract<ResponseStreamEvent, { type: "response.failed" }>): never {
	const error = event.response?.error;
	const details = event.response?.incomplete_details;
	const msg = error
		? `${error.code || "unknown"}: ${error.message || "no message"}`
		: details?.reason
			? `incomplete: ${details.reason}`
			: "Unknown error (no error details in response)";
	throw new Error(msg);
}

export async function processResponsesStream<TApi extends Api>(
	openaiStream: AsyncIterable<ResponseStreamEvent>,
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	model: Model<TApi>,
	options?: OpenAIResponsesStreamOptions,
): Promise<void> {
	const state: ResponsesStreamState<TApi> = {
		currentItem: null,
		currentBlock: null,
		output,
		stream,
		model,
		options,
		blockIndex: () => output.content.length - 1,
	};

	for await (const event of openaiStream) {
		dispatchResponsesStreamEvent(state, event);
	}
}

function mapStopReason(status: OpenAI.Responses.ResponseStatus | undefined): StopReason {
	if (!status) return "stop";
	switch (status) {
		case "completed":
			return "stop";
		case "incomplete":
			return "length";
		case "failed":
		case "cancelled":
			return "error";
		// These two are wonky ...
		case "in_progress":
		case "queued":
			return "stop";
		default: {
			const _exhaustive: never = status;
			throw new Error(`Unhandled stop reason: ${_exhaustive}`);
		}
	}
}
