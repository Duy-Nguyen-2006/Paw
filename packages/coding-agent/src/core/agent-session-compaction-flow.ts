/**
 * Shared compaction orchestration for manual and auto paths (reduces AgentSession S3776).
 */

import type { Agent, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Model, StreamFn } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai";
import { applyCompactionToSession, emitCompactionExtensionEvents } from "./agent-session-compaction-apply.ts";
import {
	type CompactionPreparation,
	type CompactionResult,
	calculateContextTokens,
	compact,
} from "./compaction/index.ts";
import type { ExtensionRunner, SessionBeforeCompactResult } from "./extensions/index.ts";
import type { ModelRegistry } from "./model-registry.ts";
import type { SessionEntry } from "./session-manager.ts";

export interface CompactionAuth {
	apiKey?: string;
	headers?: Record<string, string>;
}

export interface ResolvedCompactionContent {
	summary: string;
	firstKeptEntryId: string;
	tokensBefore: number;
	details: unknown;
	fromExtension: boolean;
}

export type CompactionEndReason = "manual" | "threshold" | "overflow";

export async function resolveAutoCompactionAuth(
	modelRegistry: ModelRegistry,
	model: Model<any>,
	streamFn: StreamFn,
): Promise<CompactionAuth | null> {
	if (streamFn === streamSimple) {
		const authResult = await modelRegistry.getApiKeyAndHeaders(model);
		if (!authResult.ok || !authResult.apiKey) {
			return null;
		}
		return { apiKey: authResult.apiKey, headers: authResult.headers };
	}
	const result = await modelRegistry.getApiKeyAndHeaders(model);
	return result.ok ? { apiKey: result.apiKey, headers: result.headers } : {};
}

export async function runSessionBeforeCompact(
	extensionRunner: ExtensionRunner,
	preparation: CompactionPreparation,
	pathEntries: SessionEntry[],
	customInstructions: string | undefined,
	signal: AbortSignal,
): Promise<{ cancelled: boolean; extensionCompaction?: CompactionResult; fromExtension: boolean }> {
	if (!extensionRunner.hasHandlers("session_before_compact")) {
		return { cancelled: false, fromExtension: false };
	}

	const extensionResult = (await extensionRunner.emit({
		type: "session_before_compact",
		preparation,
		branchEntries: pathEntries,
		customInstructions,
		signal,
	})) as SessionBeforeCompactResult | undefined;

	if (extensionResult?.cancel) {
		return { cancelled: true, fromExtension: false };
	}

	if (extensionResult?.compaction) {
		return { cancelled: false, extensionCompaction: extensionResult.compaction, fromExtension: true };
	}

	return { cancelled: false, fromExtension: false };
}

export async function resolveCompactionContent(
	extensionCompaction: CompactionResult | undefined,
	preparation: CompactionPreparation,
	model: Model<any>,
	auth: CompactionAuth,
	customInstructions: string | undefined,
	signal: AbortSignal,
	thinkingLevel: ThinkingLevel,
	streamFn: StreamFn,
): Promise<ResolvedCompactionContent> {
	if (extensionCompaction) {
		return {
			summary: extensionCompaction.summary,
			firstKeptEntryId: extensionCompaction.firstKeptEntryId,
			tokensBefore: extensionCompaction.tokensBefore,
			details: extensionCompaction.details,
			fromExtension: true,
		};
	}

	const compactResult = await compact(
		preparation,
		model,
		auth.apiKey,
		auth.headers,
		customInstructions,
		signal,
		thinkingLevel,
		streamFn,
	);

	return {
		summary: compactResult.summary,
		firstKeptEntryId: compactResult.firstKeptEntryId,
		tokensBefore: compactResult.tokensBefore,
		details: compactResult.details,
		fromExtension: false,
	};
}

export async function persistCompactionAndNotifyExtensions(
	sessionManager: Parameters<typeof applyCompactionToSession>[0],
	agent: Agent,
	extensionRunner: ExtensionRunner,
	content: ResolvedCompactionContent,
): Promise<CompactionResult> {
	const { compactionResult, savedCompactionEntry } = applyCompactionToSession(
		sessionManager,
		agent,
		content.summary,
		content.firstKeptEntryId,
		content.tokensBefore,
		content.details,
		content.fromExtension,
	);
	await emitCompactionExtensionEvents(extensionRunner, savedCompactionEntry, content.fromExtension);
	return compactionResult;
}

export function compactionOverflowErrorMessage(raw: string): string {
	return `Context overflow recovery failed: ${raw}`;
}

export function compactionAutoErrorMessage(raw: string): string {
	return `Auto-compaction failed: ${raw}`;
}

export function shouldStripErrorAssistantBeforeRetry(agent: Agent): boolean {
	const messages = agent.state.messages;
	const lastMsg = messages.at(-1);
	return lastMsg?.role === "assistant" && (lastMsg as { stopReason?: string }).stopReason === "error";
}

export function stripLastAssistantFromAgent(agent: Agent): void {
	const messages = agent.state.messages;
	if (messages.length > 0 && messages.at(-1)!.role === "assistant") {
		agent.state.messages = messages.slice(0, -1);
	}
}

/**
 * Determine whether the most recent assistant message newer than `compactionIndex` produced
 * a usable (non-zero) context token count.
 *
 * Returns false when no assistant message exists after the compaction boundary, the latest
 * assistant message was aborted or errored, or its provider usage reports no tokens. Pre- and
 * post-compaction usage must not be compared directly: only post-compaction assistant usage
 * reflects the current context size.
 */
export function hasPostCompactionUsage(branchEntries: SessionEntry[], compactionIndex: number): boolean {
	for (let i = branchEntries.length - 1; i > compactionIndex; i--) {
		const entry = branchEntries[i];
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const assistant = entry.message as AssistantMessage;
		if (assistant.stopReason === "aborted" || assistant.stopReason === "error") continue;
		return calculateContextTokens(assistant.usage) > 0;
	}
	return false;
}
