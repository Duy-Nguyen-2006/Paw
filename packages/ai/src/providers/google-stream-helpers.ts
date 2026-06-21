/**
 * Shared stream chunk processing for Google Generative AI and Vertex providers.
 */

import type { Part } from "@google/genai";
import { calculateCost } from "../models.ts";
import type { Api, AssistantMessage, Model, TextContent, ThinkingContent, ToolCall } from "../types.ts";
import type { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { isThinkingPart, mapStopReasonString, retainThoughtSignature } from "./google-shared.ts";

export type GoogleStreamChunk = {
	responseId?: string;
	candidates?: Array<{
		content?: { parts?: Part[] };
		finishReason?: string;
	}>;
	usageMetadata?: {
		promptTokenCount?: number;
		cachedContentTokenCount?: number;
		candidatesTokenCount?: number;
		thoughtsTokenCount?: number;
		totalTokenCount?: number;
	};
};

export type GoogleStreamProcessState = {
	currentBlock: TextContent | ThinkingContent | null;
	toolCallCounter: { value: number };
};

export function createGoogleStreamProcessState(): GoogleStreamProcessState {
	return { currentBlock: null, toolCallCounter: { value: 0 } };
}

function blockIndex(output: AssistantMessage): number {
	return output.content.length - 1;
}

function endCurrentTextOrThinkingBlock(
	stream: AssistantMessageEventStream,
	output: AssistantMessage,
	currentBlock: TextContent | ThinkingContent,
): void {
	const idx = blockIndex(output);
	if (currentBlock.type === "text") {
		stream.push({
			type: "text_end",
			contentIndex: idx,
			content: currentBlock.text,
			partial: output,
		});
	} else {
		stream.push({
			type: "thinking_end",
			contentIndex: idx,
			content: currentBlock.thinking,
			partial: output,
		});
	}
}

function startThinkingBlock(
	stream: AssistantMessageEventStream,
	output: AssistantMessage,
	state: GoogleStreamProcessState,
): void {
	state.currentBlock = { type: "thinking", thinking: "", thinkingSignature: undefined };
	output.content.push(state.currentBlock);
	stream.push({ type: "thinking_start", contentIndex: blockIndex(output), partial: output });
}

function startTextBlock(
	stream: AssistantMessageEventStream,
	output: AssistantMessage,
	state: GoogleStreamProcessState,
): void {
	state.currentBlock = { type: "text", text: "" };
	output.content.push(state.currentBlock);
	stream.push({ type: "text_start", contentIndex: blockIndex(output), partial: output });
}

function ensureBlockForTextPart(
	stream: AssistantMessageEventStream,
	output: AssistantMessage,
	state: GoogleStreamProcessState,
	isThinking: boolean,
): void {
	const { currentBlock } = state;
	const needsNewBlock =
		!currentBlock ||
		(isThinking && currentBlock.type !== "thinking") ||
		(!isThinking && currentBlock.type !== "text");

	if (!needsNewBlock) {
		return;
	}

	if (currentBlock) {
		endCurrentTextOrThinkingBlock(stream, output, currentBlock);
	}

	if (isThinking) {
		startThinkingBlock(stream, output, state);
	} else {
		startTextBlock(stream, output, state);
	}
}

function appendTextPartDelta(
	stream: AssistantMessageEventStream,
	output: AssistantMessage,
	state: GoogleStreamProcessState,
	part: Part,
): void {
	const block = state.currentBlock;
	if (!block) {
		return;
	}

	const text = part.text ?? "";
	const idx = blockIndex(output);

	if (block.type === "thinking") {
		block.thinking += text;
		block.thinkingSignature = retainThoughtSignature(block.thinkingSignature, part.thoughtSignature);
		stream.push({ type: "thinking_delta", contentIndex: idx, delta: text, partial: output });
	} else {
		block.text += text;
		block.textSignature = retainThoughtSignature(block.textSignature, part.thoughtSignature);
		stream.push({ type: "text_delta", contentIndex: idx, delta: text, partial: output });
	}
}

function processTextPart(
	stream: AssistantMessageEventStream,
	output: AssistantMessage,
	state: GoogleStreamProcessState,
	part: Part,
): void {
	if (part.text === undefined) {
		return;
	}

	const isThinking = isThinkingPart(part);
	ensureBlockForTextPart(stream, output, state, isThinking);
	appendTextPartDelta(stream, output, state, part);
}

function processFunctionCallPart(
	stream: AssistantMessageEventStream,
	output: AssistantMessage,
	state: GoogleStreamProcessState,
	part: Part,
): void {
	if (!part.functionCall) {
		return;
	}

	if (state.currentBlock) {
		endCurrentTextOrThinkingBlock(stream, output, state.currentBlock);
		state.currentBlock = null;
	}

	const providedId = part.functionCall.id;
	const needsNewId = !providedId || output.content.some((b) => b.type === "toolCall" && b.id === providedId);
	const toolCallId = needsNewId
		? `${part.functionCall.name}_${Date.now()}_${++state.toolCallCounter.value}`
		: providedId;

	const toolCall: ToolCall = {
		type: "toolCall",
		id: toolCallId,
		name: part.functionCall.name || "",
		arguments: (part.functionCall.args as Record<string, any>) ?? {},
		...(part.thoughtSignature && { thoughtSignature: part.thoughtSignature }),
	};

	output.content.push(toolCall);
	const idx = blockIndex(output);
	stream.push({ type: "toolcall_start", contentIndex: idx, partial: output });
	stream.push({
		type: "toolcall_delta",
		contentIndex: idx,
		delta: JSON.stringify(toolCall.arguments),
		partial: output,
	});
	stream.push({ type: "toolcall_end", contentIndex: idx, toolCall, partial: output });
}

function processCandidateParts(
	stream: AssistantMessageEventStream,
	output: AssistantMessage,
	state: GoogleStreamProcessState,
	parts: Part[],
): void {
	for (const part of parts) {
		processTextPart(stream, output, state, part);
		processFunctionCallPart(stream, output, state, part);
	}
}

function applyFinishReason(output: AssistantMessage, finishReason: string): void {
	output.stopReason = mapStopReasonString(finishReason);
	if (output.content.some((b) => b.type === "toolCall")) {
		output.stopReason = "toolUse";
	}
}

function applyUsageMetadata<TApi extends Api>(
	model: Model<TApi>,
	output: AssistantMessage,
	usageMetadata: NonNullable<GoogleStreamChunk["usageMetadata"]>,
): void {
	output.usage = {
		input: (usageMetadata.promptTokenCount || 0) - (usageMetadata.cachedContentTokenCount || 0),
		output: (usageMetadata.candidatesTokenCount || 0) + (usageMetadata.thoughtsTokenCount || 0),
		cacheRead: usageMetadata.cachedContentTokenCount || 0,
		cacheWrite: 0,
		totalTokens: usageMetadata.totalTokenCount || 0,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0,
		},
	};
	calculateCost(model, output.usage);
}

/**
 * Process one chunk from generateContentStream.
 */
export function processGoogleStreamChunk<TApi extends Api>(
	stream: AssistantMessageEventStream,
	output: AssistantMessage,
	state: GoogleStreamProcessState,
	model: Model<TApi>,
	chunk: GoogleStreamChunk,
): void {
	output.responseId ||= chunk.responseId;
	const candidate = chunk.candidates?.[0];

	if (candidate?.content?.parts) {
		processCandidateParts(stream, output, state, candidate.content.parts);
	}

	if (candidate?.finishReason) {
		applyFinishReason(output, candidate.finishReason);
	}

	if (chunk.usageMetadata) {
		applyUsageMetadata(model, output, chunk.usageMetadata);
	}
}

export function finalizeOpenGoogleStreamBlock(
	stream: AssistantMessageEventStream,
	output: AssistantMessage,
	state: GoogleStreamProcessState,
): void {
	if (!state.currentBlock) {
		return;
	}
	endCurrentTextOrThinkingBlock(stream, output, state.currentBlock);
}

export function assertGoogleStreamCompleted(output: AssistantMessage, signal: AbortSignal | undefined): void {
	if (signal?.aborted) {
		throw new Error("Request was aborted");
	}
	if (output.stopReason === "aborted" || output.stopReason === "error") {
		throw new Error("An unknown error occurred");
	}
}

export function handleGoogleStreamError(
	stream: AssistantMessageEventStream,
	output: AssistantMessage,
	error: unknown,
	signal: AbortSignal | undefined,
): void {
	for (const block of output.content) {
		if ("index" in block) {
			delete (block as { index?: number }).index;
		}
	}
	output.stopReason = signal?.aborted ? "aborted" : "error";
	output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
	stream.push({ type: "error", reason: output.stopReason, error: output });
	stream.end();
}
