/**
 * Codex Responses stream lifecycle helpers (extracted from openai-codex-responses.ts for S3776).
 */

import type { Api, AssistantMessage, Model, StreamOptions } from "../types.ts";
import type { AssistantMessageEventStream } from "../utils/event-stream.ts";

export function createInitialCodexOutput(model: Model<"openai-codex-responses">): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "openai-codex-responses" as Api,
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

export function stripCodexStreamScratchBuffers(output: AssistantMessage): void {
	for (const block of output.content) {
		delete (block as { partialJson?: string }).partialJson;
	}
}

export function pushCodexStreamError(
	stream: AssistantMessageEventStream,
	output: AssistantMessage,
	options: StreamOptions | undefined,
	error: unknown,
): void {
	stripCodexStreamScratchBuffers(output);
	output.stopReason = options?.signal?.aborted ? "aborted" : "error";
	output.errorMessage = error instanceof Error ? error.message : String(error);
	stream.push({ type: "error", reason: output.stopReason, error: output });
	stream.end();
}
