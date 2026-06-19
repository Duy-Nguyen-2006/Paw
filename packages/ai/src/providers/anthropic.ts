import Anthropic from "@anthropic-ai/sdk";
import type {
	CacheControlEphemeral,
	ContentBlockParam,
	MessageCreateParamsStreaming,
	MessageParam,
	RawMessageStreamEvent,
	RefusalStopDetails,
} from "@anthropic-ai/sdk/resources/messages.js";
import { calculateCost } from "../models.ts";
import type {
	AnthropicMessagesCompat,
	Api,
	AssistantMessage,
	CacheRetention,
	Context,
	ImageContent,
	Message,
	Model,
	SimpleStreamOptions,
	StopReason,
	StreamFunction,
	StreamOptions,
	TextContent,
	ThinkingContent,
	Tool,
	ToolCall,
	ToolResultMessage,
} from "../types.ts";
import { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { headersToRecord } from "../utils/headers.ts";
import { parseJsonWithRepair, parseStreamingJson } from "../utils/json-parse.ts";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.ts";

import { resolveCloudflareBaseUrl } from "./cloudflare.ts";
import { buildCopilotDynamicHeaders, hasCopilotVisionInput } from "./github-copilot-headers.ts";
import { adjustMaxTokensForThinking, buildBaseOptions } from "./simple-options.ts";
import { transformMessages } from "./transform-messages.ts";

/**
 * Resolve cache retention preference.
 * Defaults to "short" and uses PI_CACHE_RETENTION for backward compatibility.
 */
function resolveCacheRetention(cacheRetention?: CacheRetention): CacheRetention {
	if (cacheRetention) {
		return cacheRetention;
	}
	if (typeof process !== "undefined" && process.env.PI_CACHE_RETENTION === "long") {
		return "long";
	}
	return "short";
}

function getCacheControl(
	model: Model<"anthropic-messages">,
	cacheRetention?: CacheRetention,
): { retention: CacheRetention; cacheControl?: CacheControlEphemeral } {
	const retention = resolveCacheRetention(cacheRetention);
	if (retention === "none") {
		return { retention };
	}
	const ttl = retention === "long" && getAnthropicCompat(model).supportsLongCacheRetention ? "1h" : undefined;
	return {
		retention,
		cacheControl: { type: "ephemeral", ...(ttl && { ttl }) },
	};
}

// Stealth mode: Mimic Claude Code's tool naming exactly
const claudeCodeVersion = "2.1.75";

// Claude Code 2.x tool names (canonical casing)
// Source: https://cchistory.mariozechner.at/data/prompts-2.1.11.md
// To update: https://github.com/badlogic/cchistory
const claudeCodeTools = [
	"Read",
	"Write",
	"Edit",
	"Bash",
	"Grep",
	"Glob",
	"AskUserQuestion",
	"EnterPlanMode",
	"ExitPlanMode",
	"KillShell",
	"NotebookEdit",
	"Skill",
	"Task",
	"TaskOutput",
	"TodoWrite",
	"WebFetch",
	"WebSearch",
];

const ccToolLookup = new Map(claudeCodeTools.map((t) => [t.toLowerCase(), t]));

// Convert tool name to CC canonical casing if it matches (case-insensitive)
const toClaudeCodeName = (name: string) => ccToolLookup.get(name.toLowerCase()) ?? name;
const fromClaudeCodeName = (name: string, tools?: Tool[]) => {
	if (tools && tools.length > 0) {
		const lowerName = name.toLowerCase();
		const matchedTool = tools.find((tool) => tool.name.toLowerCase() === lowerName);
		if (matchedTool) return matchedTool.name;
	}
	return name;
};

/**
 * Convert content blocks to Anthropic API format
 */
function convertContentBlocks(content: (TextContent | ImageContent)[]):
	| string
	| Array<
			| { type: "text"; text: string }
			| {
					type: "image";
					source: {
						type: "base64";
						media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
						data: string;
					};
			  }
	  > {
	// If only text blocks, return as concatenated string for simplicity
	const hasImages = content.some((c) => c.type === "image");
	if (!hasImages) {
		return sanitizeSurrogates(content.map((c) => (c as TextContent).text).join("\n"));
	}

	// If we have images, convert to content block array
	const blocks = content.map((block) => {
		if (block.type === "text") {
			return {
				type: "text" as const,
				text: sanitizeSurrogates(block.text),
			};
		}
		return {
			type: "image" as const,
			source: {
				type: "base64" as const,
				media_type: block.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
				data: block.data,
			},
		};
	});

	// If only images (no text), add placeholder text block
	const hasText = blocks.some((b) => b.type === "text");
	if (!hasText) {
		blocks.unshift({
			type: "text" as const,
			text: "(see attached image)",
		});
	}

	return blocks;
}

export type AnthropicEffort = "low" | "medium" | "high" | "xhigh" | "max";

export type AnthropicThinkingDisplay = "summarized" | "omitted";

const FINE_GRAINED_TOOL_STREAMING_BETA = "fine-grained-tool-streaming-2025-05-14";
const INTERLEAVED_THINKING_BETA = "interleaved-thinking-2025-05-14";

function getAnthropicCompat(
	model: Model<"anthropic-messages">,
): Required<Omit<AnthropicMessagesCompat, "forceAdaptiveThinking">> {
	// Auto-detect session affinity and cache control support from provider
	const isFireworks = model.provider === "fireworks";
	const isCloudflareAiGatewayAnthropic =
		model.provider === "cloudflare-ai-gateway" && model.baseUrl.includes("anthropic");
	return {
		supportsEagerToolInputStreaming: model.compat?.supportsEagerToolInputStreaming ?? !isFireworks,
		supportsLongCacheRetention: model.compat?.supportsLongCacheRetention ?? !isFireworks,
		sendSessionAffinityHeaders:
			model.compat?.sendSessionAffinityHeaders ?? !!(isFireworks || isCloudflareAiGatewayAnthropic),
		supportsCacheControlOnTools: model.compat?.supportsCacheControlOnTools ?? !isFireworks,
		supportsTemperature: model.compat?.supportsTemperature ?? true,
		allowEmptySignature: model.compat?.allowEmptySignature ?? false,
	};
}

export interface AnthropicOptions extends StreamOptions {
	/**
	 * Enable extended thinking.
	 * For adaptive thinking models: the model decides when/how much to think.
	 * For older models: uses budget-based thinking with thinkingBudgetTokens.
	 * Default: undefined (thinking is omitted unless `streamSimpleAnthropic()` maps
	 * a simple reasoning level to this option, or callers set it explicitly).
	 */
	thinkingEnabled?: boolean;
	/**
	 * Token budget for extended thinking (older models only).
	 * Ignored for adaptive thinking models.
	 * Default: 1024 when `thinkingEnabled` is true and no budget is provided.
	 */
	thinkingBudgetTokens?: number;
	/**
	 * Effort level for adaptive thinking models.
	 * Controls how much thinking Claude allocates:
	 * - "max": Always thinks with no constraints (Opus 4.6 only)
	 * - "xhigh": Highest reasoning level (Opus 4.7+, Fable 5)
	 * - "high": Always thinks, deep reasoning
	 * - "medium": Moderate thinking, may skip for simple queries
	 * - "low": Minimal thinking, skips for simple tasks
	 * Ignored for older models.
	 * Default: omitted unless `streamSimpleAnthropic()` maps a simple reasoning
	 * level to this option.
	 */
	effort?: AnthropicEffort;
	/**
	 * Controls how thinking content is returned in API responses.
	 * - "summarized": Thinking blocks contain summarized thinking text.
	 * - "omitted": Thinking blocks return an empty thinking field; the encrypted
	 *   signature still travels back for multi-turn continuity. Use for faster
	 *   time-to-first-text-token when your UI does not surface thinking.
	 *
	 * Note: Anthropic's API default for Claude Opus 4.7 and Claude Mythos Preview
	 * is "omitted". We default to "summarized" here to keep behavior consistent
	 * with older Claude 4 models. Set this explicitly to "omitted" to opt in.
	 * Default: "summarized" when thinking is enabled.
	 */
	thinkingDisplay?: AnthropicThinkingDisplay;
	/**
	 * Whether to request the interleaved thinking beta header for non-adaptive
	 * thinking models. Adaptive thinking models have interleaved thinking built in,
	 * so the header is skipped for them regardless of this setting.
	 * Default: true.
	 */
	interleavedThinking?: boolean;
	/**
	 * Anthropic tool choice behavior. String values map to Anthropic's built-in
	 * choices; `{ type: "tool", name }` forces a specific tool.
	 * Default: omitted (Anthropic default behavior, currently equivalent to auto).
	 */
	toolChoice?: "auto" | "any" | "none" | { type: "tool"; name: string };
	/**
	 * Pre-built Anthropic client instance. When provided, skips internal client
	 * construction entirely. Use this to inject alternative SDK clients such as
	 * `AnthropicVertex` that shares the same messaging API.
	 */
	client?: Anthropic;
}

function mergeHeaders(...headerSources: (Record<string, string | null> | undefined)[]): Record<string, string | null> {
	const merged: Record<string, string | null> = {};
	for (const headers of headerSources) {
		if (headers) {
			Object.assign(merged, headers);
		}
	}
	return merged;
}

interface ServerSentEvent {
	event: string | null;
	data: string;
	raw: string[];
}

interface SseDecoderState {
	event: string | null;
	data: string[];
	raw: string[];
}

const ANTHROPIC_MESSAGE_EVENTS: ReadonlySet<string> = new Set([
	"message_start",
	"message_delta",
	"message_stop",
	"content_block_start",
	"content_block_delta",
	"content_block_stop",
]);

function flushSseEvent(state: SseDecoderState): ServerSentEvent | null {
	if (!state.event && state.data.length === 0) {
		return null;
	}

	const event: ServerSentEvent = {
		event: state.event,
		data: state.data.join("\n"),
		raw: [...state.raw],
	};
	state.event = null;
	state.data = [];
	state.raw = [];
	return event;
}

function decodeSseLine(line: string, state: SseDecoderState): ServerSentEvent | null {
	if (line === "") {
		return flushSseEvent(state);
	}

	state.raw.push(line);
	if (line.startsWith(":")) {
		return null;
	}

	const delimiterIndex = line.indexOf(":");
	const fieldName = delimiterIndex === -1 ? line : line.slice(0, delimiterIndex);
	let value = delimiterIndex === -1 ? "" : line.slice(delimiterIndex + 1);
	if (value.startsWith(" ")) {
		value = value.slice(1);
	}

	if (fieldName === "event") {
		state.event = value;
	} else if (fieldName === "data") {
		state.data.push(value);
	}

	return null;
}

function nextLineBreakIndex(text: string): number {
	const carriageReturnIndex = text.indexOf("\r");
	const newlineIndex = text.indexOf("\n");
	if (carriageReturnIndex === -1) {
		return newlineIndex;
	}
	if (newlineIndex === -1) {
		return carriageReturnIndex;
	}
	return Math.min(carriageReturnIndex, newlineIndex);
}

function consumeLine(text: string): { line: string; rest: string } | null {
	const lineBreakIndex = nextLineBreakIndex(text);
	if (lineBreakIndex === -1) {
		return null;
	}

	let nextIndex = lineBreakIndex + 1;
	if (text[lineBreakIndex] === "\r" && text[nextIndex] === "\n") {
		nextIndex += 1;
	}

	return {
		line: text.slice(0, lineBreakIndex),
		rest: text.slice(nextIndex),
	};
}

function* consumeBufferedEvents(buffer: string, state: SseDecoderState): Generator<ServerSentEvent> {
	let current = buffer;
	while (true) {
		const consumed = consumeLine(current);
		if (!consumed) break;
		current = consumed.rest;
		const event = decodeSseLine(consumed.line, state);
		if (event) yield event;
	}
	if (current.length > 0) {
		const event = decodeSseLine(current, state);
		if (event) yield event;
	}
}

async function* iterateSseMessages(
	body: ReadableStream<Uint8Array>,
	signal?: AbortSignal,
): AsyncGenerator<ServerSentEvent> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	const state: SseDecoderState = { event: null, data: [], raw: [] };
	let buffer = "";

	try {
		while (true) {
			if (signal?.aborted) {
				throw new Error("Request was aborted");
			}

			const { value, done } = await reader.read();
			if (done) {
				break;
			}

			buffer += decoder.decode(value, { stream: true });
			yield* consumeBufferedEvents(buffer, state);
			buffer = "";
		}

		buffer += decoder.decode();
		yield* consumeBufferedEvents(buffer, state);

		const trailingEvent = flushSseEvent(state);
		if (trailingEvent) {
			yield trailingEvent;
		}
	} finally {
		reader.releaseLock();
	}
}

async function* iterateAnthropicEvents(
	response: Response,
	signal?: AbortSignal,
): AsyncGenerator<RawMessageStreamEvent> {
	if (!response.body) {
		throw new Error("Attempted to iterate over an Anthropic response with no body");
	}

	const state = { sawMessageStart: false, sawMessageEnd: false };
	for await (const sse of iterateSseMessages(response.body, signal)) {
		const event = yieldAnthropicEvent(sse, state);
		if (event !== undefined) yield event;
	}

	if (state.sawMessageStart && !state.sawMessageEnd) {
		throw new Error("Anthropic stream ended before message_stop");
	}
}

function yieldAnthropicEvent(
	sse: { event: string | null; data: string; raw: string[] },
	state: { sawMessageStart: boolean; sawMessageEnd: boolean },
): RawMessageStreamEvent | undefined {
	if (sse.event === "error") {
		throw new Error(sse.data);
	}

	if (!ANTHROPIC_MESSAGE_EVENTS.has(sse.event ?? "")) {
		return undefined;
	}

	try {
		const event = parseJsonWithRepair<RawMessageStreamEvent>(sse.data);
		if (event.type === "message_start") {
			state.sawMessageStart = true;
		} else if (event.type === "message_stop") {
			state.sawMessageEnd = true;
		}
		return event;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Could not parse Anthropic SSE event ${sse.event}: ${message}; data=${sse.data}; raw=${sse.raw.join("\\n")}`,
		);
	}
}

type AnthropicStreamBlock = (ThinkingContent | TextContent | (ToolCall & { partialJson: string })) & { index: number };

interface AnthropicStreamDispatchContext {
	output: AssistantMessage;
	stream: AssistantMessageEventStream;
	blocks: AnthropicStreamBlock[];
	model: Model<"anthropic-messages">;
	context: Context;
	isOAuth: boolean;
}

function findAnthropicBlockByIndex(blocks: AnthropicStreamBlock[], index: number): AnthropicStreamBlock | undefined {
	return blocks.find((b) => b.index === index);
}

function handleAnthropicContentBlockStart(
	ctx: AnthropicStreamDispatchContext,
	event: Extract<RawMessageStreamEvent, { type: "content_block_start" }>,
): void {
	const { output, stream, isOAuth, context } = ctx;
	const startBlock = createAnthropicContentBlock(event, isOAuth, context);
	if (!startBlock) return;
	output.content.push(startBlock);
	const contentIndex = output.content.length - 1;
	const eventType = anthropicBlockStartEventType(startBlock);
	stream.push({ type: eventType, contentIndex, partial: output });
}

function createAnthropicContentBlock(
	event: Extract<RawMessageStreamEvent, { type: "content_block_start" }>,
	isOAuth: boolean,
	context: Context,
): AnthropicStreamBlock | undefined {
	const blockType = event.content_block.type;
	if (blockType === "text") {
		return { type: "text", text: "", index: event.index };
	}
	if (blockType === "thinking") {
		return { type: "thinking", thinking: "", thinkingSignature: "", index: event.index };
	}
	if (blockType === "redacted_thinking") {
		return {
			type: "thinking",
			thinking: "[Reasoning redacted]",
			thinkingSignature: event.content_block.data,
			redacted: true,
			index: event.index,
		};
	}
	if (blockType === "tool_use") {
		return {
			type: "toolCall",
			id: event.content_block.id,
			name: isOAuth ? fromClaudeCodeName(event.content_block.name, context.tools) : event.content_block.name,
			arguments: (event.content_block.input as Record<string, unknown>) ?? {},
			partialJson: "",
			index: event.index,
		};
	}
	return undefined;
}

function anthropicBlockStartEventType(block: AnthropicStreamBlock): "text_start" | "thinking_start" | "toolcall_start" {
	if (block.type === "text") return "text_start";
	if (block.type === "thinking") return "thinking_start";
	return "toolcall_start";
}

function handleAnthropicContentBlockDelta(
	ctx: AnthropicStreamDispatchContext,
	event: Extract<RawMessageStreamEvent, { type: "content_block_delta" }>,
): void {
	const { blocks, stream, output } = ctx;
	const block = findAnthropicBlockByIndex(blocks, event.index);
	if (!block) return;
	const contentIndex = blocks.indexOf(block);

	if (event.delta.type === "text_delta" && block.type === "text") {
		block.text += event.delta.text;
		stream.push({ type: "text_delta", contentIndex, delta: event.delta.text, partial: output });
		return;
	}
	if (event.delta.type === "thinking_delta" && block.type === "thinking") {
		block.thinking += event.delta.thinking;
		stream.push({ type: "thinking_delta", contentIndex, delta: event.delta.thinking, partial: output });
		return;
	}
	if (event.delta.type === "input_json_delta" && block.type === "toolCall") {
		block.partialJson += event.delta.partial_json;
		block.arguments = parseStreamingJson(block.partialJson);
		stream.push({ type: "toolcall_delta", contentIndex, delta: event.delta.partial_json, partial: output });
		return;
	}
	if (event.delta.type === "signature_delta" && block.type === "thinking") {
		block.thinkingSignature = block.thinkingSignature || "";
		block.thinkingSignature += event.delta.signature;
	}
}

function handleAnthropicContentBlockStop(
	ctx: AnthropicStreamDispatchContext,
	event: Extract<RawMessageStreamEvent, { type: "content_block_stop" }>,
): void {
	const { blocks, stream, output } = ctx;
	const block = findAnthropicBlockByIndex(blocks, event.index);
	if (!block) return;
	const contentIndex = blocks.indexOf(block);
	delete (block as { index?: number }).index;
	finalizeAnthropicContentBlock(block, contentIndex, stream, output);
}

function finalizeAnthropicContentBlock(
	block: AnthropicStreamBlock,
	contentIndex: number,
	stream: AssistantMessageEventStream,
	output: AssistantMessage,
): void {
	if (block.type === "text") {
		stream.push({ type: "text_end", contentIndex, content: block.text, partial: output });
		return;
	}
	if (block.type === "thinking") {
		stream.push({ type: "thinking_end", contentIndex, content: block.thinking, partial: output });
		return;
	}
	if (block.type === "toolCall") {
		block.arguments = parseStreamingJson(block.partialJson);
		delete (block as { partialJson?: string }).partialJson;
		stream.push({ type: "toolcall_end", contentIndex, toolCall: block, partial: output });
	}
}

function dispatchAnthropicStreamEvent(ctx: AnthropicStreamDispatchContext, event: RawMessageStreamEvent): void {
	const { model } = ctx;

	if (event.type === "message_start") {
		applyAnthropicMessageStart(ctx, event);
		return;
	}
	if (event.type === "content_block_start") {
		handleAnthropicContentBlockStart(ctx, event);
		return;
	}
	if (event.type === "content_block_delta") {
		handleAnthropicContentBlockDelta(ctx, event);
		return;
	}
	if (event.type === "content_block_stop") {
		handleAnthropicContentBlockStop(ctx, event);
		return;
	}
	if (event.type === "message_delta") {
		applyAnthropicMessageDelta(ctx, event);
	}
}

function applyAnthropicMessageStart(
	ctx: AnthropicStreamDispatchContext,
	event: Extract<RawMessageStreamEvent, { type: "message_start" }>,
): void {
	const { output, model } = ctx;
	output.responseId = event.message.id;
	output.usage.input = event.message.usage.input_tokens || 0;
	output.usage.output = event.message.usage.output_tokens || 0;
	output.usage.cacheRead = event.message.usage.cache_read_input_tokens || 0;
	output.usage.cacheWrite = event.message.usage.cache_creation_input_tokens || 0;
	output.usage.cacheWrite1h = event.message.usage.cache_creation?.ephemeral_1h_input_tokens || 0;
	output.usage.totalTokens =
		output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
	calculateCost(model, output.usage);
}

function applyAnthropicMessageDelta(
	ctx: AnthropicStreamDispatchContext,
	event: Extract<RawMessageStreamEvent, { type: "message_delta" }>,
): void {
	const { output, model } = ctx;
	if (event.delta.stop_reason) {
		const stopReasonResult = mapStopReason(event.delta.stop_reason, event.delta.stop_details);
		output.stopReason = stopReasonResult.stopReason;
		if (stopReasonResult.errorMessage) {
			output.errorMessage = stopReasonResult.errorMessage;
		}
	}
	applyAnthropicMessageDeltaUsage(output, event);
	calculateCost(model, output.usage);
}

function applyAnthropicMessageDeltaUsage(
	output: AssistantMessage,
	event: Extract<RawMessageStreamEvent, { type: "message_delta" }>,
): void {
	if (event.usage.input_tokens != null) output.usage.input = event.usage.input_tokens;
	if (event.usage.output_tokens != null) output.usage.output = event.usage.output_tokens;
	if (event.usage.cache_read_input_tokens != null) {
		output.usage.cacheRead = event.usage.cache_read_input_tokens;
	}
	if (event.usage.cache_creation_input_tokens != null) {
		output.usage.cacheWrite = event.usage.cache_creation_input_tokens;
	}
	output.usage.totalTokens =
		output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
}

export const streamAnthropic: StreamFunction<"anthropic-messages", AnthropicOptions> = (
	model: Model<"anthropic-messages">,
	context: Context,
	options?: AnthropicOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	(async () => {
		const output = createInitialAnthropicOutput(model);

		try {
			const { client, isOAuth } = await resolveAnthropicClient(model, context, options);
			const params = await resolveAnthropicParams(model, context, isOAuth, options);
			const requestOptions = buildAnthropicRequestOptions(options);
			const response = await client.messages.create({ ...params, stream: true }, requestOptions).asResponse();
			await options?.onResponse?.({ status: response.status, headers: headersToRecord(response.headers) }, model);
			stream.push({ type: "start", partial: output });

			const dispatchCtx = createAnthropicDispatchContext(output, stream, model, context, isOAuth);
			await consumeAnthropicResponse(response, dispatchCtx, options);

			assertAnthropicStreamNotAborted(options, output);
			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
		} catch (error) {
			reportAnthropicStreamError(stream, output, options, error);
		}
	})();

	return stream;
};

function createInitialAnthropicOutput(model: Model<"anthropic-messages">): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api as Api,
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

async function resolveAnthropicClient(
	model: Model<"anthropic-messages">,
	context: Context,
	options: AnthropicOptions | undefined,
): Promise<{ client: Anthropic; isOAuth: boolean }> {
	if (options?.client) {
		return { client: options.client, isOAuth: false };
	}

	const apiKey = options?.apiKey;
	if (!apiKey) {
		throw new Error(`No API key for provider: ${model.provider}`);
	}

	const dynamicHeaders = buildCopilotDynamicHeadersForModel(model, context);
	const cacheRetention = options?.cacheRetention ?? resolveCacheRetention();
	const cacheSessionId = cacheRetention === "none" ? undefined : options?.sessionId;
	return createClient(
		model,
		apiKey,
		options?.interleavedThinking ?? true,
		shouldUseFineGrainedToolStreamingBeta(model, context),
		options?.headers,
		dynamicHeaders,
		cacheSessionId,
	);
}

function buildCopilotDynamicHeadersForModel(
	model: Model<"anthropic-messages">,
	context: Context,
): Record<string, string> | undefined {
	if (model.provider !== "github-copilot") return undefined;
	const hasImages = hasCopilotVisionInput(context.messages);
	return buildCopilotDynamicHeaders({
		messages: context.messages,
		hasImages,
	});
}

async function resolveAnthropicParams(
	model: Model<"anthropic-messages">,
	context: Context,
	isOAuth: boolean,
	options: AnthropicOptions | undefined,
): Promise<MessageCreateParamsStreaming> {
	let params = buildParams(model, context, isOAuth, options);
	const nextParams = await options?.onPayload?.(params, model);
	if (nextParams !== undefined) {
		params = nextParams as MessageCreateParamsStreaming;
	}
	return params;
}

function buildAnthropicRequestOptions(options: AnthropicOptions | undefined) {
	return {
		...(options?.signal ? { signal: options.signal } : {}),
		...(options?.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
		maxRetries: options?.maxRetries ?? 0,
	};
}

function createAnthropicDispatchContext(
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	model: Model<"anthropic-messages">,
	context: Context,
	isOAuth: boolean,
): AnthropicStreamDispatchContext {
	return {
		output,
		stream,
		blocks: output.content as AnthropicStreamBlock[],
		model,
		context,
		isOAuth,
	};
}

async function consumeAnthropicResponse(
	response: Response,
	dispatchCtx: AnthropicStreamDispatchContext,
	options: AnthropicOptions | undefined,
): Promise<void> {
	for await (const event of iterateAnthropicEvents(response, options?.signal)) {
		dispatchAnthropicStreamEvent(dispatchCtx, event);
	}
}

function assertAnthropicStreamNotAborted(options: AnthropicOptions | undefined, output: AssistantMessage): void {
	if (options?.signal?.aborted) {
		throw new Error("Request was aborted");
	}
	if (output.stopReason === "aborted" || output.stopReason === "error") {
		throw new Error(output.errorMessage || "An unknown error occurred");
	}
}

function reportAnthropicStreamError(
	stream: AssistantMessageEventStream,
	output: AssistantMessage,
	options: AnthropicOptions | undefined,
	error: unknown,
): void {
	for (const block of output.content) {
		delete (block as { index?: number }).index;
		// partialJson is only a streaming scratch buffer; never persist it.
		delete (block as { partialJson?: string }).partialJson;
	}
	output.stopReason = options?.signal?.aborted ? "aborted" : "error";
	output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
	stream.push({ type: "error", reason: output.stopReason, error: output });
	stream.end();
}

/**
 * Map ThinkingLevel to Anthropic effort levels for adaptive thinking.
 * Note: effort "max" is only valid on Opus 4.6, while Opus 4.7+ and Fable 5 support "xhigh".
 */
function mapThinkingLevelToEffort(
	model: Model<"anthropic-messages">,
	level: SimpleStreamOptions["reasoning"],
): AnthropicEffort {
	const mapped = level ? model.thinkingLevelMap?.[level] : undefined;
	if (typeof mapped === "string") return mapped as AnthropicEffort;

	switch (level) {
		case "minimal":
		case "low":
			return "low";
		case "medium":
			return "medium";
		case "high":
			return "high";
		default:
			return "high";
	}
}

export const streamSimpleAnthropic: StreamFunction<"anthropic-messages", SimpleStreamOptions> = (
	model: Model<"anthropic-messages">,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
	const apiKey = options?.apiKey;
	if (!apiKey) {
		throw new Error(`No API key for provider: ${model.provider}`);
	}

	const base = buildBaseOptions(model, options, apiKey);
	if (!options?.reasoning) {
		return streamAnthropic(model, context, { ...base, thinkingEnabled: false } satisfies AnthropicOptions);
	}

	// For models with adaptive thinking: use an effort level.
	// For older models: use budget-based thinking.
	if (model.compat?.forceAdaptiveThinking === true) {
		const effort = mapThinkingLevelToEffort(model, options.reasoning);
		return streamAnthropic(model, context, {
			...base,
			thinkingEnabled: true,
			effort,
		} satisfies AnthropicOptions);
	}

	// Undefined means the caller did not request an output cap; let the helper use the model cap.
	// Do not coerce to 0 here, or the thinking budget would become the entire max_tokens value.
	const adjusted = adjustMaxTokensForThinking(
		base.maxTokens,
		model.maxTokens,
		options.reasoning,
		options.thinkingBudgets,
	);

	return streamAnthropic(model, context, {
		...base,
		maxTokens: adjusted.maxTokens,
		thinkingEnabled: true,
		thinkingBudgetTokens: adjusted.thinkingBudget,
	} satisfies AnthropicOptions);
};

function isOAuthToken(apiKey: string): boolean {
	return apiKey.includes("sk-ant-oat");
}

function createClient(
	model: Model<"anthropic-messages">,
	apiKey: string,
	interleavedThinking: boolean,
	useFineGrainedToolStreamingBeta: boolean,
	optionsHeaders?: Record<string, string>,
	dynamicHeaders?: Record<string, string>,
	sessionId?: string,
): { client: Anthropic; isOAuthToken: boolean } {
	// Adaptive thinking models have interleaved thinking built in, so skip the beta header.
	const needsInterleavedBeta = interleavedThinking && model.compat?.forceAdaptiveThinking !== true;
	const betaFeatures: string[] = [];
	if (useFineGrainedToolStreamingBeta) {
		betaFeatures.push(FINE_GRAINED_TOOL_STREAMING_BETA);
	}
	if (needsInterleavedBeta) {
		betaFeatures.push(INTERLEAVED_THINKING_BETA);
	}

	if (model.provider === "cloudflare-ai-gateway") {
		const client = new Anthropic({
			apiKey: null,
			authToken: null,
			baseURL: resolveCloudflareBaseUrl(model),
			dangerouslyAllowBrowser: true,
			defaultHeaders: mergeHeaders(
				{
					accept: "application/json",
					"anthropic-dangerous-direct-browser-access": "true",
					"cf-aig-authorization": `Bearer ${apiKey}`,
					"x-api-key": null,
					Authorization: null,
					...(betaFeatures.length > 0 ? { "anthropic-beta": betaFeatures.join(",") } : {}),
				},
				model.headers,
				optionsHeaders,
			),
		});

		return { client, isOAuthToken: false };
	}

	// Copilot: Bearer auth, selective betas.
	if (model.provider === "github-copilot") {
		const client = new Anthropic({
			apiKey: null,
			authToken: apiKey,
			baseURL: model.baseUrl,
			dangerouslyAllowBrowser: true,
			defaultHeaders: mergeHeaders(
				{
					accept: "application/json",
					"anthropic-dangerous-direct-browser-access": "true",
					...(betaFeatures.length > 0 ? { "anthropic-beta": betaFeatures.join(",") } : {}),
				},
				model.headers,
				dynamicHeaders,
				optionsHeaders,
			),
		});

		return { client, isOAuthToken: false };
	}

	// OAuth: Bearer auth, Claude Code identity headers
	if (isOAuthToken(apiKey)) {
		const client = new Anthropic({
			apiKey: null,
			authToken: apiKey,
			baseURL: model.baseUrl,
			dangerouslyAllowBrowser: true,
			defaultHeaders: mergeHeaders(
				{
					accept: "application/json",
					"anthropic-dangerous-direct-browser-access": "true",
					"anthropic-beta": ["claude-code-20250219", "oauth-2025-04-20", ...betaFeatures].join(","),
					"user-agent": `claude-cli/${claudeCodeVersion}`,
					"x-app": "cli",
				},
				model.headers,
				optionsHeaders,
			),
		});

		return { client, isOAuthToken: true };
	}

	// API key auth
	const sessionAffinityHeaders: Record<string, string | null> =
		sessionId && getAnthropicCompat(model).sendSessionAffinityHeaders ? { "x-session-affinity": sessionId } : {};
	const client = new Anthropic({
		apiKey,
		authToken: null,
		baseURL: model.baseUrl,
		dangerouslyAllowBrowser: true,
		defaultHeaders: mergeHeaders(
			{
				accept: "application/json",
				"anthropic-dangerous-direct-browser-access": "true",
				...(betaFeatures.length > 0 ? { "anthropic-beta": betaFeatures.join(",") } : {}),
			},
			sessionAffinityHeaders,
			model.headers,
			optionsHeaders,
		),
	});

	return { client, isOAuthToken: false };
}

function buildParams(
	model: Model<"anthropic-messages">,
	context: Context,
	isOAuthToken: boolean,
	options?: AnthropicOptions,
): MessageCreateParamsStreaming {
	const { cacheControl } = getCacheControl(model, options?.cacheRetention);
	const compat = getAnthropicCompat(model);
	const params: MessageCreateParamsStreaming = {
		model: model.id,
		messages: convertMessages(context.messages, model, isOAuthToken, cacheControl, compat.allowEmptySignature),
		max_tokens: options?.maxTokens ?? model.maxTokens,
		stream: true,
	};

	applyAnthropicSystemPrompt(params, context, isOAuthToken, cacheControl);
	applyAnthropicTemperature(params, options, compat);
	applyAnthropicTools(params, context, isOAuthToken, compat, cacheControl);
	applyAnthropicThinking(params, model, options);
	applyAnthropicMetadata(params, options);
	applyAnthropicToolChoice(params, options);

	return params;
}

function applyAnthropicSystemPrompt(
	params: MessageCreateParamsStreaming,
	context: Context,
	isOAuthToken: boolean,
	cacheControl: CacheControlEphemeral | undefined,
): void {
	// For OAuth tokens, we MUST include Claude Code identity
	if (isOAuthToken) {
		params.system = [
			{
				type: "text",
				text: "You are Claude Code, Anthropic's official CLI for Claude.",
				...(cacheControl ? { cache_control: cacheControl } : {}),
			},
		];
		if (context.systemPrompt) {
			params.system.push({
				type: "text",
				text: sanitizeSurrogates(context.systemPrompt),
				...(cacheControl ? { cache_control: cacheControl } : {}),
			});
		}
		return;
	}
	if (context.systemPrompt) {
		// Add cache control to system prompt for non-OAuth tokens
		params.system = [
			{
				type: "text",
				text: sanitizeSurrogates(context.systemPrompt),
				...(cacheControl ? { cache_control: cacheControl } : {}),
			},
		];
	}
}

function applyAnthropicTemperature(
	params: MessageCreateParamsStreaming,
	options: AnthropicOptions | undefined,
	compat: Required<Omit<AnthropicMessagesCompat, "forceAdaptiveThinking">>,
): void {
	// Temperature is incompatible with extended thinking and unsupported on Claude Opus 4.7+.
	if (options?.temperature !== undefined && !options?.thinkingEnabled && compat.supportsTemperature) {
		params.temperature = options.temperature;
	}
}

function applyAnthropicTools(
	params: MessageCreateParamsStreaming,
	context: Context,
	isOAuthToken: boolean,
	compat: Required<Omit<AnthropicMessagesCompat, "forceAdaptiveThinking">>,
	cacheControl: CacheControlEphemeral | undefined,
): void {
	if (!context.tools || context.tools.length === 0) return;
	params.tools = convertTools(
		context.tools,
		isOAuthToken,
		compat.supportsEagerToolInputStreaming,
		compat.supportsCacheControlOnTools ? cacheControl : undefined,
	);
}

function applyAnthropicThinking(
	params: MessageCreateParamsStreaming,
	model: Model<"anthropic-messages">,
	options: AnthropicOptions | undefined,
): void {
	// Configure thinking mode: adaptive, budget-based, or explicitly disabled.
	if (!model.reasoning) return;

	if (options?.thinkingEnabled) {
		// Default to "summarized" so Opus 4.7 and Mythos Preview behave like
		// older Claude 4 models (whose API default is also "summarized").
		const display: AnthropicThinkingDisplay = options.thinkingDisplay ?? "summarized";
		if (model.compat?.forceAdaptiveThinking === true) {
			applyAnthropicAdaptiveThinking(params, options, display);
		} else {
			applyAnthropicBudgetThinking(params, options, display);
		}
		return;
	}

	if (options?.thinkingEnabled === false && model.thinkingLevelMap?.off !== null) {
		params.thinking = { type: "disabled" };
	}
}

function applyAnthropicAdaptiveThinking(
	params: MessageCreateParamsStreaming,
	options: AnthropicOptions,
	display: AnthropicThinkingDisplay,
): void {
	// Adaptive thinking: Claude decides when and how much to think.
	params.thinking = { type: "adaptive", display };
	if (options.effort) {
		// The Anthropic SDK types can lag newly supported effort values such as "xhigh".
		params.output_config =
			options.effort === "xhigh"
				? ({ effort: options.effort } as unknown as NonNullable<
						MessageCreateParamsStreaming["output_config"]
					>)
				: { effort: options.effort };
	}
}

function applyAnthropicBudgetThinking(
	params: MessageCreateParamsStreaming,
	options: AnthropicOptions,
	display: AnthropicThinkingDisplay,
): void {
	// Budget-based thinking for older models
	params.thinking = {
		type: "enabled",
		budget_tokens: options.thinkingBudgetTokens || 1024,
		display,
	};
}

function applyAnthropicMetadata(
	params: MessageCreateParamsStreaming,
	options: AnthropicOptions | undefined,
): void {
	if (!options?.metadata) return;
	const userId = options.metadata.user_id;
	if (typeof userId === "string") {
		params.metadata = { user_id: userId };
	}
}

function applyAnthropicToolChoice(
	params: MessageCreateParamsStreaming,
	options: AnthropicOptions | undefined,
): void {
	if (!options?.toolChoice) return;
	if (typeof options.toolChoice === "string") {
		params.tool_choice = { type: options.toolChoice };
	} else {
		params.tool_choice = options.toolChoice;
	}
}

// Normalize tool call IDs to match Anthropic's required pattern and length
function normalizeToolCallId(id: string): string {
	return id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

function appendAnthropicUserParam(params: MessageParam[], msg: Extract<Message, { role: "user" }>): void {
	if (typeof msg.content === "string") {
		if (msg.content.trim().length > 0) {
			params.push({ role: "user", content: sanitizeSurrogates(msg.content) });
		}
		return;
	}
	const blocks: ContentBlockParam[] = msg.content.map((item) => {
		if (item.type === "text") {
			return { type: "text", text: sanitizeSurrogates(item.text) };
		}
		return {
			type: "image",
			source: {
				type: "base64",
				media_type: item.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
				data: item.data,
			},
		};
	});
	const filteredBlocks = blocks.filter((b) => (b.type === "text" ? b.text.trim().length > 0 : true));
	if (filteredBlocks.length === 0) return;
	params.push({ role: "user", content: filteredBlocks });
}

function appendAnthropicThinkingBlock(
	blocks: ContentBlockParam[],
	block: ThinkingContent,
	allowEmptySignature: boolean,
): void {
	if (block.redacted) {
		blocks.push({ type: "redacted_thinking", data: block.thinkingSignature! });
		return;
	}
	if (block.thinking.trim().length === 0) return;
	if (!block.thinkingSignature || block.thinkingSignature.trim().length === 0) {
		blocks.push(
			allowEmptySignature
				? { type: "thinking", thinking: sanitizeSurrogates(block.thinking), signature: "" }
				: { type: "text", text: sanitizeSurrogates(block.thinking) },
		);
		return;
	}
	blocks.push({
		type: "thinking",
		thinking: sanitizeSurrogates(block.thinking),
		signature: block.thinkingSignature,
	});
}

function appendAnthropicAssistantParam(
	params: MessageParam[],
	msg: Extract<Message, { role: "assistant" }>,
	isOAuthToken: boolean,
	allowEmptySignature: boolean,
): void {
	const blocks: ContentBlockParam[] = [];
	for (const block of msg.content) {
		if (block.type === "text") {
			if (block.text.trim().length === 0) continue;
			blocks.push({ type: "text", text: sanitizeSurrogates(block.text) });
		} else if (block.type === "thinking") {
			appendAnthropicThinkingBlock(blocks, block, allowEmptySignature);
		} else if (block.type === "toolCall") {
			blocks.push({
				type: "tool_use",
				id: block.id,
				name: isOAuthToken ? toClaudeCodeName(block.name) : block.name,
				input: block.arguments ?? {},
			});
		}
	}
	if (blocks.length === 0) return;
	params.push({ role: "assistant", content: blocks });
}

function collectAnthropicToolResultBatch(
	transformedMessages: Message[],
	startIndex: number,
): { params: MessageParam; nextIndex: number } {
	const toolResults: ContentBlockParam[] = [];
	let j = startIndex;
	for (; j < transformedMessages.length && transformedMessages[j].role === "toolResult"; j++) {
		const toolMsg = transformedMessages[j] as ToolResultMessage;
		toolResults.push({
			type: "tool_result",
			tool_use_id: toolMsg.toolCallId,
			content: convertContentBlocks(toolMsg.content),
			is_error: toolMsg.isError,
		});
	}
	return {
		params: { role: "user", content: toolResults },
		nextIndex: j - 1,
	};
}

function applyAnthropicCacheControlToParams(params: MessageParam[], cacheControl: CacheControlEphemeral): void {
	if (params.length === 0) return;
	const lastMessage = params[params.length - 1];
	if (lastMessage.role !== "user") return;
	if (Array.isArray(lastMessage.content)) {
		const lastBlock = lastMessage.content[lastMessage.content.length - 1];
		if (lastBlock && (lastBlock.type === "text" || lastBlock.type === "image" || lastBlock.type === "tool_result")) {
			(lastBlock as { cache_control?: CacheControlEphemeral }).cache_control = cacheControl;
		}
		return;
	}
	if (typeof lastMessage.content === "string") {
		lastMessage.content = [
			{ type: "text", text: lastMessage.content, cache_control: cacheControl },
		] as MessageParam["content"];
	}
}

function convertMessages(
	messages: Message[],
	model: Model<"anthropic-messages">,
	isOAuthToken: boolean,
	cacheControl?: CacheControlEphemeral,
	allowEmptySignature = false,
): MessageParam[] {
	const params: MessageParam[] = [];

	// Transform messages for cross-provider compatibility
	const transformedMessages = transformMessages(messages, model, normalizeToolCallId);

	for (let i = 0; i < transformedMessages.length; i++) {
		const msg = transformedMessages[i];
		if (msg.role === "user") {
			appendAnthropicUserParam(params, msg);
		} else if (msg.role === "assistant") {
			appendAnthropicAssistantParam(params, msg, isOAuthToken, allowEmptySignature);
		} else if (msg.role === "toolResult") {
			const batch = collectAnthropicToolResultBatch(transformedMessages, i);
			params.push(batch.params);
			i = batch.nextIndex;
		}
	}

	if (cacheControl) {
		applyAnthropicCacheControlToParams(params, cacheControl);
	}

	return params;
}

function shouldUseFineGrainedToolStreamingBeta(model: Model<"anthropic-messages">, context: Context): boolean {
	return !!context.tools?.length && !getAnthropicCompat(model).supportsEagerToolInputStreaming;
}

function convertTools(
	tools: Tool[],
	isOAuthToken: boolean,
	supportsEagerToolInputStreaming: boolean,
	cacheControl?: CacheControlEphemeral,
): Anthropic.Messages.Tool[] {
	if (!tools) return [];

	return tools.map((tool, index) => {
		const schema = tool.parameters as { properties?: unknown; required?: string[] };

		return {
			name: isOAuthToken ? toClaudeCodeName(tool.name) : tool.name,
			description: tool.description,
			...(supportsEagerToolInputStreaming ? { eager_input_streaming: true } : {}),
			input_schema: {
				type: "object",
				properties: schema.properties ?? {},
				required: schema.required ?? [],
			},
			...(cacheControl && index === tools.length - 1 ? { cache_control: cacheControl } : {}),
		};
	});
}

function mapStopReason(
	reason: Anthropic.Messages.StopReason | string,
	stopDetails?: RefusalStopDetails | null,
): { stopReason: StopReason; errorMessage?: string } {
	switch (reason) {
		case "end_turn":
			return { stopReason: "stop" };
		case "max_tokens":
			return { stopReason: "length" };
		case "tool_use":
			return { stopReason: "toolUse" };
		case "refusal":
			return {
				stopReason: "error",
				errorMessage: stopDetails?.explanation || `The model refused to complete the request`,
			};
		case "pause_turn": // Stop is good enough -> resubmit
			return { stopReason: "stop" };
		case "stop_sequence":
			return { stopReason: "stop" }; // We don't supply stop sequences, so this should never happen
		case "sensitive": // Content flagged by safety filters (not yet in SDK types)
			return { stopReason: "error" };
		default:
			// Handle unknown stop reasons gracefully (API may add new values)
			throw new Error(`Unhandled stop reason: ${reason}`);
	}
}
