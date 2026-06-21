import {
	type BedrockRuntimeClient,
	BedrockRuntimeServiceException,
	StopReason as BedrockStopReason,
	type Tool as BedrockTool,
	CachePointType,
	CacheTTL,
	type ContentBlock,
	type ContentBlockDeltaEvent,
	type ContentBlockStartEvent,
	type ContentBlockStopEvent,
	ConversationRole,
	ConverseStreamCommand,
	type ConverseStreamMetadataEvent,
	ImageFormat,
	type Message,
	type SystemContentBlock,
	type ToolChoice,
	type ToolConfiguration,
	type ToolResultContentBlock,
	ToolResultStatus,
} from "@aws-sdk/client-bedrock-runtime";
import type { BuildMiddleware, DocumentType, MetadataBearer } from "@smithy/types";
import { calculateCost } from "../models.ts";
import type {
	Api,
	AssistantMessage,
	CacheRetention,
	Context,
	ImageContent,
	Model,
	Message as PiMessage,
	SimpleStreamOptions,
	StopReason,
	StreamFunction,
	StreamOptions,
	TextContent,
	ThinkingBudgets,
	ThinkingContent,
	ThinkingLevel,
	Tool,
	ToolCall,
	ToolResultMessage,
	UserMessage,
} from "../types.ts";
import { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { parseStreamingJson } from "../utils/json-parse.ts";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.ts";
import { createBedrockRuntimeClient, getConfiguredBedrockRegion } from "./amazon-bedrock-client-helpers.ts";
import { adjustMaxTokensForThinking, buildBaseOptions, clampReasoning } from "./simple-options.ts";
import { transformMessages } from "./transform-messages.ts";

export type BedrockThinkingDisplay = "summarized" | "omitted";

export interface BedrockOptions extends StreamOptions {
	region?: string;
	profile?: string;
	toolChoice?: "auto" | "any" | "none" | { type: "tool"; name: string };
	/* See https://docs.aws.amazon.com/bedrock/latest/userguide/inference-reasoning.html for supported models. */
	reasoning?: ThinkingLevel;
	/* Custom token budgets per thinking level. Overrides default budgets. */
	thinkingBudgets?: ThinkingBudgets;
	/* Only supported by Claude 4.x models, see https://docs.aws.amazon.com/bedrock/latest/userguide/claude-messages-extended-thinking.html#claude-messages-extended-thinking-tool-use-interleaved */
	interleavedThinking?: boolean;
	/**
	 * Controls how Claude's thinking content is returned in responses.
	 * - "summarized": Thinking blocks contain summarized thinking text (default here).
	 * - "omitted": Thinking content is redacted but the signature still travels back
	 *   for multi-turn continuity, reducing time-to-first-text-token.
	 *
	 * Note: Anthropic's API default for Claude Opus 4.8 and Mythos Preview is
	 * "omitted". We default to "summarized" here to keep behavior consistent with
	 * older Claude 4 models. Only applies to Claude models on Bedrock.
	 */
	thinkingDisplay?: BedrockThinkingDisplay;
	/** Key-value pairs attached to the inference request for cost allocation tagging.
	 * Keys: max 64 chars, no `aws:` prefix. Values: max 256 chars. Max 50 pairs.
	 * Tags appear in AWS Cost Explorer split cost allocation data.
	 * @see https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ConverseStream.html */
	requestMetadata?: Record<string, string>;
	/** Bearer token for Bedrock API key authentication.
	 * When set, bypasses SigV4 signing and sends Authorization: Bearer <token> instead.
	 * Requires `bedrock:CallWithBearerToken` IAM permission on the token's identity.
	 * Set via AWS_BEARER_TOKEN_BEDROCK env var or pass directly.
	 * @see https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazonbedrock.html */
	bearerToken?: string;
}

type Block = (TextContent | ThinkingContent | ToolCall) & { index?: number; partialJson?: string };

const EMPTY_TEXT_PLACEHOLDER = "<empty>";

export const streamBedrock: StreamFunction<"bedrock-converse-stream", BedrockOptions> = (
	model: Model<"bedrock-converse-stream">,
	context: Context,
	options: BedrockOptions = {},
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	(async () => {
		const output = createInitialBedrockOutput(model);
		const blocks = output.content as Block[];

		try {
			const commandInput = await buildBedrockCommandInput(model, context, options);
			const nextCommandInput = await options?.onPayload?.(commandInput, model);
			const finalCommandInput = (nextCommandInput ?? commandInput) as typeof commandInput;
			const command = new ConverseStreamCommand(finalCommandInput);

			const client = createBedrockRuntimeClient(model, options);
			if (options.headers && Object.keys(options.headers).length > 0) {
				addCustomHeadersMiddleware(client, options.headers);
			}

			const response = await client.send(command, { abortSignal: options.signal });
			await notifyBedrockResponseMetadata(options, response, model);

			for await (const item of response.stream!) {
				dispatchBedrockStreamItem(
					item as unknown as Parameters<typeof dispatchBedrockStreamItem>[0],
					blocks,
					output,
					stream,
					model,
				);
			}

			assertBedrockStreamSuccess(options, output);
			stream.push({ type: "done", reason: output.stopReason as "stop" | "length" | "toolUse", message: output });
			stream.end();
		} catch (error) {
			reportBedrockStreamError(stream, output, options, error);
		}
	})();

	return stream;
};

function createInitialBedrockOutput(model: Model<"bedrock-converse-stream">): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "bedrock-converse-stream" as Api,
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

async function buildBedrockCommandInput(
	model: Model<"bedrock-converse-stream">,
	context: Context,
	options: BedrockOptions,
) {
	const cacheRetention = resolveCacheRetention(options.cacheRetention);
	const inferenceMaxTokens = options.maxTokens ?? (isAnthropicClaudeModel(model) ? model.maxTokens : undefined);
	return {
		modelId: model.id,
		messages: convertMessages(context, model, cacheRetention),
		system: buildSystemPrompt(context.systemPrompt, model, cacheRetention),
		inferenceConfig: {
			...(inferenceMaxTokens !== undefined && { maxTokens: inferenceMaxTokens }),
			...(options.temperature !== undefined && { temperature: options.temperature }),
		},
		toolConfig: convertToolConfig(context.tools, options.toolChoice),
		additionalModelRequestFields: buildAdditionalModelRequestFields(model, options),
		...(options.requestMetadata !== undefined && { requestMetadata: options.requestMetadata }),
	};
}

async function notifyBedrockResponseMetadata(
	options: BedrockOptions,
	response: { $metadata: { httpStatusCode?: number; requestId?: string } },
	model: Model<"bedrock-converse-stream">,
): Promise<void> {
	if (response.$metadata.httpStatusCode === undefined) return;
	const responseHeaders: Record<string, string> = {};
	if (response.$metadata.requestId) {
		responseHeaders["x-amzn-requestid"] = response.$metadata.requestId;
	}
	await options?.onResponse?.({ status: response.$metadata.httpStatusCode, headers: responseHeaders }, model);
}

function assertBedrockStreamSuccess(options: BedrockOptions, output: AssistantMessage): void {
	if (options.signal?.aborted) {
		throw new Error("Request was aborted");
	}
	if (output.stopReason === "error" || output.stopReason === "aborted") {
		throw new Error("An unknown error occurred");
	}
}

function reportBedrockStreamError(
	stream: AssistantMessageEventStream,
	output: AssistantMessage,
	options: BedrockOptions,
	error: unknown,
): void {
	for (const block of output.content) {
		delete (block as Block).index;
		// partialJson is only a streaming scratch buffer; never persist it.
		delete (block as Block).partialJson;
	}
	output.stopReason = options.signal?.aborted ? "aborted" : "error";
	output.errorMessage = formatBedrockError(error);
	stream.push({ type: "error", reason: output.stopReason, error: output });
	stream.end();
}

/**
 * Human-readable prefixes for Bedrock SDK exception names.
 * The downstream retry logic in agent-session matches patterns like
 * `server.?error` and `service.?unavailable`, so we preserve the legacy
 * prefix format rather than using the raw SDK exception name.
 */
const BEDROCK_ERROR_PREFIXES: Record<string, string> = {
	InternalServerException: "Internal server error",
	ModelStreamErrorException: "Model stream error",
	ValidationException: "Validation error",
	ThrottlingException: "Throttling error",
	ServiceUnavailableException: "Service unavailable",
};

/**
 * Some models reject the account/profile's configured Bedrock data retention mode
 * (e.g. "data retention mode 'default' is not available for this model"). Point
 * users at the AWS docs explaining how to configure a supported mode.
 */
const BEDROCK_DATA_RETENTION_DOCS_URL = "https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html";

/**
 * Format a Bedrock error with a human-readable prefix.
 * AWS SDK exceptions (both from `client.send()` and from stream event items)
 * extend BedrockRuntimeServiceException. We map the `.name` to a stable
 * human-readable prefix so downstream consumers (retry logic, context-overflow
 * detection) can distinguish error categories via simple string matching.
 */
function formatBedrockError(error: unknown): string {
	const message = error instanceof Error ? error.message : JSON.stringify(error);
	const dataRetentionHint = /data retention mode/i.test(message)
		? ` See ${BEDROCK_DATA_RETENTION_DOCS_URL} for supported data retention modes.`
		: "";
	if (error instanceof BedrockRuntimeServiceException) {
		const prefix = BEDROCK_ERROR_PREFIXES[error.name] ?? error.name;
		return `${prefix}: ${message}${dataRetentionHint}`;
	}
	return `${message}${dataRetentionHint}`;
}

/**
 * Header keys that must never be overwritten by caller-supplied headers.
 * `host` and `x-amz-*` participate in the SigV4 canonical request; `authorization`
 * is owned by SigV4 or the bearer-token path (config.token + authSchemePreference).
 * Compared case-insensitively (caller key is lower-cased before lookup).
 */
const RESERVED_HEADER_EXACT = new Set(["authorization", "host"]);

function isReservedHeader(key: string): boolean {
	const lower = key.toLowerCase();
	return lower.startsWith("x-amz-") || RESERVED_HEADER_EXACT.has(lower);
}

/**
 * Attach caller-supplied headers to the outgoing Bedrock request via a Smithy
 * `build`-step middleware. The `build` step runs after request serialisation but
 * before SigV4 signing, so injected headers are covered by the signature. Reserved
 * SigV4 / auth headers (`x-amz-*`, `authorization`, `host`) are silently skipped;
 * all other caller headers override any existing same-named header on the request.
 */
function addCustomHeadersMiddleware(client: BedrockRuntimeClient, headers: Record<string, string>): void {
	const middleware: BuildMiddleware<object, MetadataBearer> = (next) => async (args) => {
		const request = args.request;
		if (request && typeof request === "object" && "headers" in request) {
			const requestHeaders = (request as { headers: Record<string, string> }).headers;
			for (const [key, value] of Object.entries(headers)) {
				if (!isReservedHeader(key)) {
					requestHeaders[key] = value;
				}
			}
		}
		return next(args);
	};
	client.middlewareStack.add(middleware, { step: "build", name: "pi-ai-custom-headers", priority: "low" });
}

export const streamSimpleBedrock: StreamFunction<"bedrock-converse-stream", SimpleStreamOptions> = (
	model: Model<"bedrock-converse-stream">,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
	const base = buildBaseOptions(model, options, undefined);
	if (!options?.reasoning) {
		return streamBedrock(model, context, { ...base, reasoning: undefined } satisfies BedrockOptions);
	}

	if (isAnthropicClaudeModel(model)) {
		if (supportsAdaptiveThinking(model.id, model.name)) {
			return streamBedrock(model, context, {
				...base,
				reasoning: options.reasoning,
				thinkingBudgets: options.thinkingBudgets,
			} satisfies BedrockOptions);
		}

		// Undefined means the caller did not request an output cap; let the helper use the model cap.
		// Do not coerce to 0 here, or the thinking budget would become the entire maxTokens value.
		const adjusted = adjustMaxTokensForThinking(
			base.maxTokens,
			model.maxTokens,
			options.reasoning,
			options.thinkingBudgets,
		);

		return streamBedrock(model, context, {
			...base,
			maxTokens: adjusted.maxTokens,
			reasoning: options.reasoning,
			thinkingBudgets: {
				...(options.thinkingBudgets || {}),
				[clampReasoning(options.reasoning)!]: adjusted.thinkingBudget,
			},
		} satisfies BedrockOptions);
	}

	return streamBedrock(model, context, {
		...base,
		reasoning: options.reasoning,
		thinkingBudgets: options.thinkingBudgets,
	} satisfies BedrockOptions);
};

function throwIfBedrockStreamException(item: {
	internalServerException?: unknown;
	modelStreamErrorException?: unknown;
	validationException?: unknown;
	throttlingException?: unknown;
	serviceUnavailableException?: unknown;
}): void {
	if (item.internalServerException) throw item.internalServerException;
	if (item.modelStreamErrorException) throw item.modelStreamErrorException;
	if (item.validationException) throw item.validationException;
	if (item.throttlingException) throw item.throttlingException;
	if (item.serviceUnavailableException) throw item.serviceUnavailableException;
}

function dispatchBedrockStreamItem(
	item: {
		messageStart?: { role: string };
		contentBlockStart?: ContentBlockStartEvent;
		contentBlockDelta?: ContentBlockDeltaEvent;
		contentBlockStop?: ContentBlockStopEvent;
		messageStop?: { stopReason?: string };
		metadata?: ConverseStreamMetadataEvent;
	} & Parameters<typeof throwIfBedrockStreamException>[0],
	blocks: Block[],
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	model: Model<"bedrock-converse-stream">,
): void {
	throwIfBedrockStreamException(item);
	if (item.messageStart) {
		applyBedrockMessageStart(item.messageStart, output, stream);
		return;
	}
	if (item.contentBlockStart) {
		handleContentBlockStart(item.contentBlockStart, blocks, output, stream);
		return;
	}
	if (item.contentBlockDelta) {
		handleContentBlockDelta(item.contentBlockDelta, blocks, output, stream);
		return;
	}
	if (item.contentBlockStop) {
		handleContentBlockStop(item.contentBlockStop, blocks, output, stream);
		return;
	}
	if (item.messageStop) {
		output.stopReason = mapStopReason(item.messageStop.stopReason);
		return;
	}
	if (item.metadata) {
		handleMetadata(item.metadata, model, output);
	}
}

function applyBedrockMessageStart(
	messageStart: { role: string },
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
): void {
	if (messageStart.role !== ConversationRole.ASSISTANT) {
		throw new Error("Unexpected assistant message start but got user message start instead");
	}
	stream.push({ type: "start", partial: output });
}

function ensureBedrockTextBlock(
	contentBlockIndex: number,
	blocks: Block[],
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
): { block: Block; index: number } {
	let index = blocks.findIndex((b) => b.index === contentBlockIndex);
	let block = blocks[index];
	if (!block) {
		const newBlock: Block = { type: "text", text: "", index: contentBlockIndex };
		output.content.push(newBlock);
		index = blocks.length - 1;
		block = blocks[index];
		stream.push({ type: "text_start", contentIndex: index, partial: output });
	}
	return { block, index };
}

function applyBedrockTextDelta(
	deltaText: string,
	contentBlockIndex: number,
	blocks: Block[],
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
): void {
	const { block, index } = ensureBedrockTextBlock(contentBlockIndex, blocks, output, stream);
	if (block.type === "text") {
		block.text += deltaText;
		stream.push({ type: "text_delta", contentIndex: index, delta: deltaText, partial: output });
	}
}

function applyBedrockToolUseDelta(
	deltaInput: string,
	block: Block | undefined,
	index: number,
	stream: AssistantMessageEventStream,
	output: AssistantMessage,
): void {
	if (!block || block.type !== "toolCall") return;
	block.partialJson = (block.partialJson || "") + deltaInput;
	block.arguments = parseStreamingJson(block.partialJson);
	stream.push({ type: "toolcall_delta", contentIndex: index, delta: deltaInput, partial: output });
}

function ensureBedrockThinkingBlock(
	contentBlockIndex: number,
	blocks: Block[],
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	block: Block | undefined,
	index: number,
): { thinkingBlock: Block; thinkingIndex: number } {
	if (block) {
		return { thinkingBlock: block, thinkingIndex: index };
	}
	const newBlock: Block = { type: "thinking", thinking: "", thinkingSignature: "", index: contentBlockIndex };
	output.content.push(newBlock);
	const thinkingIndex = blocks.length - 1;
	stream.push({ type: "thinking_start", contentIndex: thinkingIndex, partial: output });
	return { thinkingBlock: blocks[thinkingIndex], thinkingIndex };
}

function applyBedrockReasoningDelta(
	reasoningContent: NonNullable<NonNullable<ContentBlockDeltaEvent["delta"]>["reasoningContent"]>,
	contentBlockIndex: number,
	blocks: Block[],
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	block: Block | undefined,
	index: number,
): void {
	if (!reasoningContent) return;
	const { thinkingBlock, thinkingIndex } = ensureBedrockThinkingBlock(
		contentBlockIndex,
		blocks,
		output,
		stream,
		block,
		index,
	);
	if (thinkingBlock.type !== "thinking") return;
	applyBedrockReasoningText(thinkingBlock, reasoningContent, thinkingIndex, output, stream);
	applyBedrockReasoningSignature(thinkingBlock, reasoningContent);
}

function applyBedrockReasoningText(
	thinkingBlock: ThinkingContent,
	reasoningContent: NonNullable<NonNullable<ContentBlockDeltaEvent["delta"]>["reasoningContent"]>,
	thinkingIndex: number,
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
): void {
	if (!reasoningContent.text) return;
	thinkingBlock.thinking += reasoningContent.text;
	stream.push({
		type: "thinking_delta",
		contentIndex: thinkingIndex,
		delta: reasoningContent.text,
		partial: output,
	});
}

function applyBedrockReasoningSignature(
	thinkingBlock: ThinkingContent,
	reasoningContent: NonNullable<NonNullable<ContentBlockDeltaEvent["delta"]>["reasoningContent"]>,
): void {
	if (!reasoningContent.signature) return;
	thinkingBlock.thinkingSignature = (thinkingBlock.thinkingSignature || "") + reasoningContent.signature;
}

function handleContentBlockStart(
	event: ContentBlockStartEvent,
	blocks: Block[],
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
): void {
	const index = event.contentBlockIndex!;
	const start = event.start;
	if (!start?.toolUse) return;
	const block: Block = {
		type: "toolCall",
		id: start.toolUse.toolUseId || "",
		name: start.toolUse.name || "",
		arguments: {},
		partialJson: "",
		index,
	};
	output.content.push(block);
	stream.push({ type: "toolcall_start", contentIndex: blocks.length - 1, partial: output });
}

function handleContentBlockDelta(
	event: ContentBlockDeltaEvent,
	blocks: Block[],
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
): void {
	const contentBlockIndex = event.contentBlockIndex!;
	const delta = event.delta;
	const index = blocks.findIndex((b) => b.index === contentBlockIndex);
	const block = blocks[index];

	if (delta?.text !== undefined) {
		applyBedrockTextDelta(delta.text, contentBlockIndex, blocks, output, stream);
		return;
	}
	if (delta?.toolUse) {
		applyBedrockToolUseDelta(delta.toolUse.input || "", block, index, stream, output);
		return;
	}
	if (delta?.reasoningContent) {
		applyBedrockReasoningDelta(delta.reasoningContent, contentBlockIndex, blocks, output, stream, block, index);
	}
}

function handleMetadata(
	event: ConverseStreamMetadataEvent,
	model: Model<"bedrock-converse-stream">,
	output: AssistantMessage,
): void {
	if (event.usage) {
		output.usage.input = event.usage.inputTokens || 0;
		output.usage.output = event.usage.outputTokens || 0;
		output.usage.cacheRead = event.usage.cacheReadInputTokens || 0;
		output.usage.cacheWrite = event.usage.cacheWriteInputTokens || 0;
		output.usage.totalTokens = event.usage.totalTokens || output.usage.input + output.usage.output;
		calculateCost(model, output.usage);
	}
}

function handleContentBlockStop(
	event: ContentBlockStopEvent,
	blocks: Block[],
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
): void {
	const index = blocks.findIndex((b) => b.index === event.contentBlockIndex);
	const block = blocks[index];
	if (!block) return;
	delete (block as Block).index;

	switch (block.type) {
		case "text":
			stream.push({ type: "text_end", contentIndex: index, content: block.text, partial: output });
			break;
		case "thinking":
			stream.push({ type: "thinking_end", contentIndex: index, content: block.thinking, partial: output });
			break;
		case "toolCall":
			block.arguments = parseStreamingJson(block.partialJson);
			// Finalize in-place and strip the scratch buffer so replay only
			// carries parsed arguments.
			delete (block as Block).partialJson;
			stream.push({ type: "toolcall_end", contentIndex: index, toolCall: block, partial: output });
			break;
	}
}

/**
 * Check if the model supports adaptive thinking (Opus 4.6+, Sonnet 4.6).
 * Checks both model ID and model name to support application inference profiles
 * whose ARNs don't contain the model name.
 */
function getModelMatchCandidates(modelId: string, modelName?: string): string[] {
	const values = modelName ? [modelId, modelName] : [modelId];
	return values.flatMap((value) => {
		const lower = value.toLowerCase();
		return [lower, lower.replace(/[\s_.:]+/g, "-")];
	});
}

function supportsAdaptiveThinking(modelId: string, modelName?: string): boolean {
	const candidates = getModelMatchCandidates(modelId, modelName);
	return candidates.some(
		(s) =>
			s.includes("opus-4-6") ||
			s.includes("opus-4-7") ||
			s.includes("opus-4-8") ||
			s.includes("sonnet-4-6") ||
			s.includes("fable-5"),
	);
}

function supportsNativeXhighEffort(model: Model<"bedrock-converse-stream">): boolean {
	const candidates = getModelMatchCandidates(model.id, model.name);
	return candidates.some((s) => s.includes("opus-4-7") || s.includes("opus-4-8") || s.includes("fable-5"));
}

function mapThinkingLevelToEffort(
	model: Model<"bedrock-converse-stream">,
	level: SimpleStreamOptions["reasoning"],
): "low" | "medium" | "high" | "xhigh" | "max" {
	if (level === "xhigh" && supportsNativeXhighEffort(model)) return "xhigh";

	const mapped = level ? model.thinkingLevelMap?.[level] : undefined;
	if (typeof mapped === "string") return mapped as "low" | "medium" | "high" | "xhigh" | "max";

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

/**
 * Check if the model is an Anthropic Claude model on Bedrock.
 * Checks both model ID and model name to support application inference profiles
 * whose ARNs don't contain the model name.
 */
function isAnthropicClaudeModel(model: Model<"bedrock-converse-stream">): boolean {
	const id = model.id.toLowerCase();
	const name = model.name?.toLowerCase() ?? "";
	return (
		id.includes("anthropic.claude") ||
		id.includes("anthropic/claude") ||
		name.includes("anthropic.claude") ||
		name.includes("anthropic/claude") ||
		name.includes("claude")
	);
}

/**
 * Check if the model supports prompt caching.
 * Supported: Claude 3.5 Haiku, Claude 3.7 Sonnet, Claude 4.x models
 *
 * For base models and system-defined inference profiles the model ID / ARN
 * contains the model name, so we can decide locally.
 *
 * For application inference profiles (whose ARNs don't contain the model name),
 * also checks model.name which is user-controlled via models.json or registerProvider.
 * As a last resort, set AWS_BEDROCK_FORCE_CACHE=1 to enable cache points.
 * Amazon Nova models have automatic caching and don't need explicit cache points.
 */
function supportsPromptCaching(model: Model<"bedrock-converse-stream">): boolean {
	const candidates = getModelMatchCandidates(model.id, model.name);

	const hasClaudeRef = candidates.some((s) => s.includes("claude"));
	if (!hasClaudeRef) {
		// Application inference profiles don't contain the model name in the ARN.
		// Allow users to force cache points via environment variable.
		if (typeof process !== "undefined" && process.env.AWS_BEDROCK_FORCE_CACHE === "1") return true;
		return false;
	}
	// Claude 4.x models (opus-4, sonnet-4, haiku-4)
	if (candidates.some((s) => s.includes("-4-"))) return true;
	// Claude 3.7 Sonnet
	if (candidates.some((s) => s.includes("claude-3-7-sonnet"))) return true;
	// Claude 3.5 Haiku
	if (candidates.some((s) => s.includes("claude-3-5-haiku"))) return true;
	return false;
}

/**
 * Check if the model supports thinking signatures in reasoningContent.
 * Only Anthropic Claude models support the signature field.
 * Other models (OpenAI, Qwen, Minimax, Moonshot, etc.) reject it with:
 * "This model doesn't support the reasoningContent.reasoningText.signature field"
 *
 * Checks both model ID and model name to support application inference profiles.
 */
function supportsThinkingSignature(model: Model<"bedrock-converse-stream">): boolean {
	return isAnthropicClaudeModel(model);
}

function buildSystemPrompt(
	systemPrompt: string | undefined,
	model: Model<"bedrock-converse-stream">,
	cacheRetention: CacheRetention,
): SystemContentBlock[] | undefined {
	if (!systemPrompt) return undefined;

	const blocks: SystemContentBlock[] = [{ text: sanitizeSurrogates(systemPrompt) }];

	// Add cache point for supported Claude models when caching is enabled
	if (cacheRetention !== "none" && supportsPromptCaching(model)) {
		blocks.push({
			cachePoint: { type: CachePointType.DEFAULT, ...(cacheRetention === "long" ? { ttl: CacheTTL.ONE_HOUR } : {}) },
		});
	}

	return blocks;
}

function normalizeToolCallId(id: string): string {
	const sanitized = id.replace(/[^a-zA-Z0-9_-]/g, "_");
	return sanitized.length > 64 ? sanitized.slice(0, 64) : sanitized;
}

function createNonBlankTextBlock(text: string): ContentBlock.TextMember | undefined {
	const sanitized = sanitizeSurrogates(text);
	return sanitized.trim().length === 0 ? undefined : { text: sanitized };
}

function createRequiredTextBlock(text: string): ContentBlock.TextMember {
	return createNonBlankTextBlock(text) ?? { text: EMPTY_TEXT_PLACEHOLDER };
}

function convertToolResultContent(content: (TextContent | ImageContent)[]): ToolResultContentBlock[] {
	const result: ToolResultContentBlock[] = [];
	for (const c of content) {
		if (c.type === "image") {
			result.push({ image: createImageBlock(c.mimeType, c.data) });
		} else {
			const textBlock = createNonBlankTextBlock(c.text);
			if (textBlock) result.push(textBlock);
		}
	}
	if (result.length === 0) result.push({ text: EMPTY_TEXT_PLACEHOLDER });
	return result;
}

function buildBedrockUserContent(m: UserMessage): ContentBlock[] {
	const content: ContentBlock[] = [];
	if (typeof m.content === "string") {
		content.push(createRequiredTextBlock(m.content));
		return content;
	}
	for (const c of m.content) {
		if (c.type === "text") {
			const textBlock = createNonBlankTextBlock(c.text);
			if (textBlock) content.push(textBlock);
		} else if (c.type === "image") {
			content.push({ image: createImageBlock(c.mimeType, c.data) });
		}
	}
	if (content.length === 0) content.push({ text: EMPTY_TEXT_PLACEHOLDER });
	return content;
}

function buildBedrockThinkingBlock(
	model: Model<"bedrock-converse-stream">,
	c: ThinkingContent,
): ContentBlock | undefined {
	const thinking = sanitizeSurrogates(c.thinking);
	if (thinking.trim().length === 0) return undefined;
	if (!supportsThinkingSignature(model)) {
		return { reasoningContent: { reasoningText: { text: thinking } } };
	}
	if (!c.thinkingSignature || c.thinkingSignature.trim().length === 0) {
		return { text: thinking };
	}
	return {
		reasoningContent: {
			reasoningText: { text: thinking, signature: c.thinkingSignature },
		},
	};
}

function convertBedrockAssistantMessage(
	m: AssistantMessage,
	model: Model<"bedrock-converse-stream">,
): Message | undefined {
	if (m.content.length === 0) return undefined;
	const contentBlocks: ContentBlock[] = [];
	for (const c of m.content) {
		if (c.type === "text") {
			const textBlock = createNonBlankTextBlock(c.text);
			if (textBlock) contentBlocks.push(textBlock);
		} else if (c.type === "toolCall") {
			contentBlocks.push({ toolUse: { toolUseId: c.id, name: c.name, input: c.arguments } });
		} else if (c.type === "thinking") {
			const block = buildBedrockThinkingBlock(model, c);
			if (block) contentBlocks.push(block);
		}
	}
	if (contentBlocks.length === 0) return undefined;
	return { role: ConversationRole.ASSISTANT, content: contentBlocks };
}

function collectBedrockToolResultBatch(
	transformedMessages: PiMessage[],
	startIndex: number,
): { messages: Message[]; nextIndex: number } {
	const toolResults: ContentBlock.ToolResultMember[] = [];
	let j = startIndex;
	for (; j < transformedMessages.length && transformedMessages[j].role === "toolResult"; j++) {
		const toolMsg = transformedMessages[j] as ToolResultMessage;
		toolResults.push({
			toolResult: {
				toolUseId: toolMsg.toolCallId,
				content: convertToolResultContent(toolMsg.content),
				status: toolMsg.isError ? ToolResultStatus.ERROR : ToolResultStatus.SUCCESS,
			},
		});
	}
	return {
		messages: [{ role: ConversationRole.USER, content: toolResults }],
		nextIndex: j - 1,
	};
}

function appendBedrockCachePointIfNeeded(
	result: Message[],
	model: Model<"bedrock-converse-stream">,
	cacheRetention: CacheRetention,
): void {
	if (cacheRetention === "none" || !supportsPromptCaching(model) || result.length === 0) return;
	const lastMessage = result[result.length - 1];
	if (lastMessage.role !== ConversationRole.USER || !lastMessage.content) return;
	(lastMessage.content as ContentBlock[]).push({
		cachePoint: {
			type: CachePointType.DEFAULT,
			...(cacheRetention === "long" ? { ttl: CacheTTL.ONE_HOUR } : {}),
		},
	});
}

function convertMessages(
	context: Context,
	model: Model<"bedrock-converse-stream">,
	cacheRetention: CacheRetention,
): Message[] {
	const result: Message[] = [];
	const transformedMessages = transformMessages(context.messages, model, normalizeToolCallId) as PiMessage[];

	for (let i = 0; i < transformedMessages.length; i++) {
		const m = transformedMessages[i];
		if (m.role === "user") {
			result.push({ role: ConversationRole.USER, content: buildBedrockUserContent(m as UserMessage) });
			continue;
		}
		if (m.role === "assistant") {
			const assistantMsg = convertBedrockAssistantMessage(m as AssistantMessage, model);
			if (assistantMsg) result.push(assistantMsg);
			continue;
		}
		if (m.role === "toolResult") {
			const batch = collectBedrockToolResultBatch(transformedMessages, i);
			result.push(...batch.messages);
			i = batch.nextIndex;
		}
	}

	appendBedrockCachePointIfNeeded(result, model, cacheRetention);
	return result;
}

function convertToolConfig(
	tools: Tool[] | undefined,
	toolChoice: BedrockOptions["toolChoice"],
): ToolConfiguration | undefined {
	if (!tools?.length || toolChoice === "none") return undefined;

	const bedrockTools: BedrockTool[] = tools.map((tool) => ({
		toolSpec: {
			name: tool.name,
			description: tool.description,
			inputSchema: { json: tool.parameters as unknown as DocumentType },
		},
	}));

	let bedrockToolChoice: ToolChoice | undefined;
	switch (toolChoice) {
		case "auto":
			bedrockToolChoice = { auto: {} };
			break;
		case "any":
			bedrockToolChoice = { any: {} };
			break;
		default:
			if (toolChoice?.type === "tool") {
				bedrockToolChoice = { tool: { name: toolChoice.name } };
			}
	}

	return { tools: bedrockTools, toolChoice: bedrockToolChoice };
}

function mapStopReason(reason: string | undefined): StopReason {
	switch (reason) {
		case BedrockStopReason.END_TURN:
		case BedrockStopReason.STOP_SEQUENCE:
			return "stop";
		case BedrockStopReason.MAX_TOKENS:
		case BedrockStopReason.MODEL_CONTEXT_WINDOW_EXCEEDED:
			return "length";
		case BedrockStopReason.TOOL_USE:
			return "toolUse";
		default:
			return "error";
	}
}

function isGovCloudBedrockTarget(model: Model<"bedrock-converse-stream">, options: BedrockOptions): boolean {
	const region = getConfiguredBedrockRegion(options);
	if (region?.toLowerCase().startsWith("us-gov-")) {
		return true;
	}

	const modelId = model.id.toLowerCase();
	return modelId.startsWith("us-gov.") || modelId.startsWith("arn:aws-us-gov:");
}

function buildAdditionalModelRequestFields(
	model: Model<"bedrock-converse-stream">,
	options: BedrockOptions,
): Record<string, any> | undefined {
	if (!options.reasoning || !model.reasoning) {
		return undefined;
	}

	if (!isAnthropicClaudeModel(model)) return undefined;
	return buildAnthropicClaudeAdditionalFields(model, options);
}

function buildAnthropicClaudeAdditionalFields(
	model: Model<"bedrock-converse-stream">,
	options: BedrockOptions,
): Record<string, any> {
	// GovCloud Bedrock currently rejects the Claude thinking.display field.
	// Omit it there until the GovCloud Converse schema catches up.
	const display = isGovCloudBedrockTarget(model, options) ? undefined : (options.thinkingDisplay ?? "summarized");
	const isAdaptive = supportsAdaptiveThinking(model.id, model.name);
	const result: Record<string, any> = isAdaptive
		? buildAdaptiveThinkingFields(model, options, display)
		: buildBudgetThinkingFields(options, display);

	if (!isAdaptive && (options.interleavedThinking ?? true)) {
		result.anthropic_beta = ["interleaved-thinking-2025-05-14"];
	}
	return result;
}

function buildAdaptiveThinkingFields(
	model: Model<"bedrock-converse-stream">,
	options: BedrockOptions,
	display: BedrockThinkingDisplay | undefined,
): Record<string, any> {
	return {
		thinking: { type: "adaptive", ...(display !== undefined ? { display } : {}) },
		output_config: { effort: mapThinkingLevelToEffort(model, options.reasoning!) },
	};
}

function buildBudgetThinkingFields(
	options: BedrockOptions,
	display: BedrockThinkingDisplay | undefined,
): Record<string, any> {
	const budget = resolveBedrockBudgetTokens(options);
	return {
		thinking: {
			type: "enabled",
			budget_tokens: budget,
			...(display !== undefined ? { display } : {}),
		},
	};
}

function resolveBedrockBudgetTokens(options: BedrockOptions): number {
	const defaultBudgets: Record<ThinkingLevel, number> = {
		minimal: 1024,
		low: 2048,
		medium: 8192,
		high: 16384,
		xhigh: 16384, // Claude doesn't support xhigh, clamp to high
	};

	// Custom budgets override defaults (xhigh not in ThinkingBudgets, use high)
	const level = options.reasoning === "xhigh" ? "high" : options.reasoning!;
	return options.thinkingBudgets?.[level] ?? defaultBudgets[options.reasoning!];
}

function createImageBlock(mimeType: string, data: string) {
	let format: ImageFormat;
	switch (mimeType) {
		case "image/jpeg":
		case "image/jpg":
			format = ImageFormat.JPEG;
			break;
		case "image/png":
			format = ImageFormat.PNG;
			break;
		case "image/gif":
			format = ImageFormat.GIF;
			break;
		case "image/webp":
			format = ImageFormat.WEBP;
			break;
		default:
			throw new Error(`Unknown image type: ${mimeType}`);
	}

	const binaryString = atob(data);
	const bytes = new Uint8Array(binaryString.length);
	for (let i = 0; i < binaryString.length; i++) {
		bytes[i] = binaryString.charCodeAt(i);
	}

	return { source: { bytes }, format };
}
