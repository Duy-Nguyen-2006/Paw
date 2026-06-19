/**
 * Tree navigation helpers (reduces AgentSession.navigateTree S3776).
 */

import type { Model, StreamFn } from "@earendil-works/pi-ai";
import { generateBranchSummary } from "./compaction/index.ts";
import type { ExtensionRunner, SessionBeforeTreeResult, TreePreparation } from "./extensions/index.ts";
import type { BranchSummaryEntry, SessionEntry, SessionManager } from "./session-manager.ts";

export interface TreeNavigationTargetContext {
	newLeafId: string | null;
	editorText?: string;
}

export interface BranchSummaryResolution {
	summaryText?: string;
	summaryDetails?: unknown;
	fromExtension: boolean;
	customInstructions?: string;
	replaceInstructions?: boolean;
	label?: string;
}

export interface RunSessionBeforeTreeOptions {
	summarize: boolean;
	customInstructions?: string;
	replaceInstructions?: boolean;
	label?: string;
}

export async function runSessionBeforeTree(
	extensionRunner: ExtensionRunner,
	preparation: TreePreparation,
	signal: AbortSignal,
	options: RunSessionBeforeTreeOptions,
): Promise<{ cancelled: boolean; resolution: BranchSummaryResolution }> {
	let customInstructions = options.customInstructions;
	let replaceInstructions = options.replaceInstructions;
	let label = options.label;
	let extensionSummary: { summary: string; details?: unknown } | undefined;
	let fromExtension = false;

	if (!extensionRunner.hasHandlers("session_before_tree")) {
		return {
			cancelled: false,
			resolution: { fromExtension: false, customInstructions, replaceInstructions, label },
		};
	}

	const result = (await extensionRunner.emit({
		type: "session_before_tree",
		preparation,
		signal,
	})) as SessionBeforeTreeResult | undefined;

	if (result?.cancel) {
		return { cancelled: true, resolution: { fromExtension: false } };
	}

	if (result?.summary && options.summarize) {
		extensionSummary = result.summary;
		fromExtension = true;
	}

	if (result?.customInstructions !== undefined) {
		customInstructions = result.customInstructions;
	}
	if (result?.replaceInstructions !== undefined) {
		replaceInstructions = result.replaceInstructions;
	}
	if (result?.label !== undefined) {
		label = result.label;
	}

	return {
		cancelled: false,
		resolution: {
			summaryText: extensionSummary?.summary,
			summaryDetails: extensionSummary?.details,
			fromExtension,
			customInstructions,
			replaceInstructions,
			label,
		},
	};
}

export async function resolveDefaultBranchSummary(
	entriesToSummarize: SessionEntry[],
	options: {
		model: Model<any>;
		apiKey: string;
		headers?: Record<string, string>;
		signal: AbortSignal;
		customInstructions?: string;
		replaceInstructions?: boolean;
		reserveTokens?: number;
		streamFn: StreamFn;
	},
): Promise<
	| { aborted: true }
	| { error: string }
	| { summaryText: string; summaryDetails: { readFiles: string[]; modifiedFiles: string[] } }
> {
	const result = await generateBranchSummary(entriesToSummarize, {
		model: options.model,
		apiKey: options.apiKey,
		headers: options.headers,
		signal: options.signal,
		customInstructions: options.customInstructions,
		replaceInstructions: options.replaceInstructions,
		reserveTokens: options.reserveTokens,
		streamFn: options.streamFn,
	});

	if (result.aborted) {
		return { aborted: true };
	}
	if (result.error) {
		return { error: result.error };
	}

	return {
		summaryText: result.summary!,
		summaryDetails: {
			readFiles: result.readFiles || [],
			modifiedFiles: result.modifiedFiles || [],
		},
	};
}

export function resolveTreeNavigationTarget(
	targetEntry: SessionEntry,
	targetId: string,
	extractUserMessageText: (content: string | Array<{ type: string; text?: string }>) => string,
): TreeNavigationTargetContext {
	if (targetEntry.type === "message" && targetEntry.message.role === "user") {
		return {
			newLeafId: targetEntry.parentId,
			editorText: extractUserMessageText(targetEntry.message.content),
		};
	}

	if (targetEntry.type === "custom_message") {
		const editorText =
			typeof targetEntry.content === "string"
				? targetEntry.content
				: targetEntry.content
						.filter((c): c is { type: "text"; text: string } => c.type === "text")
						.map((c) => c.text)
						.join("");
		return { newLeafId: targetEntry.parentId, editorText };
	}

	return { newLeafId: targetId };
}

export function applyTreeLeafSwitch(
	sessionManager: SessionManager,
	options: {
		newLeafId: string | null;
		targetId: string;
		summaryText?: string;
		summaryDetails?: unknown;
		fromExtension: boolean;
		label?: string;
	},
): BranchSummaryEntry | undefined {
	const { newLeafId, targetId, summaryText, summaryDetails, fromExtension, label } = options;

	if (summaryText) {
		const summaryId = sessionManager.branchWithSummary(newLeafId, summaryText, summaryDetails, fromExtension);
		const summaryEntry = sessionManager.getEntry(summaryId) as BranchSummaryEntry;
		if (label) {
			sessionManager.appendLabelChange(summaryId, label);
		}
		return summaryEntry;
	}

	if (newLeafId === null) {
		sessionManager.resetLeaf();
	} else {
		sessionManager.branch(newLeafId);
	}

	if (label) {
		sessionManager.appendLabelChange(targetId, label);
	}

	return undefined;
}
