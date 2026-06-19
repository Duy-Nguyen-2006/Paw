/**
 * createAgentSession setup helpers (extracted from sdk.ts for S3776).
 */

import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import { clampThinkingLevel, type Message, type Model } from "@earendil-works/pi-ai";
import { formatNoModelsAvailableMessage } from "./auth-guidance.ts";
import { DEFAULT_THINKING_LEVEL } from "./defaults.ts";
import { convertToLlm } from "./messages.ts";
import type { ModelRegistry } from "./model-registry.ts";
import { findInitialModel } from "./model-resolver.ts";
import type { SessionManager } from "./session-manager.ts";
import type { SettingsManager } from "./settings-manager.ts";
import type { ToolName } from "./tools/index.ts";

export interface ResolvedSessionModel {
	model: Model<any> | undefined;
	thinkingLevel: ThinkingLevel;
	modelFallbackMessage: string | undefined;
	hasExistingSession: boolean;
	hasThinkingEntry: boolean;
}

export async function resolveModelAndThinkingForSession(input: {
	optionsModel: Model<any> | undefined;
	optionsThinkingLevel: ThinkingLevel | undefined;
	sessionManager: SessionManager;
	settingsManager: SettingsManager;
	modelRegistry: ModelRegistry;
}): Promise<ResolvedSessionModel> {
	const existingSession = input.sessionManager.buildSessionContext();
	const hasExistingSession = existingSession.messages.length > 0;
	const hasThinkingEntry = input.sessionManager.getBranch().some((entry) => entry.type === "thinking_level_change");

	let model = input.optionsModel;
	let modelFallbackMessage: string | undefined;

	if (!model && hasExistingSession && existingSession.model) {
		const restoredModel = input.modelRegistry.find(existingSession.model.provider, existingSession.model.modelId);
		if (restoredModel && input.modelRegistry.hasConfiguredAuth(restoredModel)) {
			model = restoredModel;
		}
		if (!model) {
			modelFallbackMessage = `Could not restore model ${existingSession.model.provider}/${existingSession.model.modelId}`;
		}
	}

	if (!model) {
		const result = await findInitialModel({
			scopedModels: [],
			isContinuing: hasExistingSession,
			defaultProvider: input.settingsManager.getDefaultProvider(),
			defaultModelId: input.settingsManager.getDefaultModel(),
			defaultThinkingLevel: input.settingsManager.getDefaultThinkingLevel(),
			modelRegistry: input.modelRegistry,
		});
		model = result.model;
		if (!model) {
			modelFallbackMessage = formatNoModelsAvailableMessage();
		} else if (modelFallbackMessage) {
			modelFallbackMessage += `. Using ${model.provider}/${model.id}`;
		}
	}

	let thinkingLevel = input.optionsThinkingLevel;
	if (thinkingLevel === undefined && hasExistingSession) {
		thinkingLevel = hasThinkingEntry
			? (existingSession.thinkingLevel as ThinkingLevel)
			: (input.settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL);
	}
	if (thinkingLevel === undefined) {
		thinkingLevel = input.settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL;
	}
	if (!model) {
		thinkingLevel = "off";
	} else {
		thinkingLevel = clampThinkingLevel(model, thinkingLevel) as ThinkingLevel;
	}

	return {
		model,
		thinkingLevel,
		modelFallbackMessage,
		hasExistingSession,
		hasThinkingEntry,
	};
}

export function resolveInitialActiveToolNames(input: {
	tools?: string[];
	noTools?: "all" | "builtin";
	excludeTools?: string[];
}): string[] {
	const defaultActiveToolNames: ToolName[] = ["read", "bash", "edit", "write"];
	const excludedToolNameSet = input.excludeTools ? new Set(input.excludeTools) : undefined;
	return (input.tools ? [...input.tools] : input.noTools ? [] : defaultActiveToolNames).filter(
		(name) => !excludedToolNameSet?.has(name),
	);
}

const IMAGE_DISABLED_TEXT = "Image reading is disabled.";

export function createConvertToLlmWithBlockImages(
	settingsManager: SettingsManager,
): (messages: AgentMessage[]) => Message[] {
	return (messages: AgentMessage[]) => {
		const converted = convertToLlm(messages);
		if (!settingsManager.getBlockImages()) {
			return converted;
		}
		return converted.map((msg) => {
			if (msg.role !== "user" && msg.role !== "toolResult") {
				return msg;
			}
			const content = msg.content;
			if (!Array.isArray(content) || !content.some((c) => c.type === "image")) {
				return msg;
			}
			const filteredContent = content
				.map((c) => (c.type === "image" ? { type: "text" as const, text: IMAGE_DISABLED_TEXT } : c))
				.filter(
					(c, i, arr) =>
						!(
							c.type === "text" &&
							c.text === IMAGE_DISABLED_TEXT &&
							i > 0 &&
							arr[i - 1].type === "text" &&
							(arr[i - 1] as { type: "text"; text: string }).text === IMAGE_DISABLED_TEXT
						),
				);
			return { ...msg, content: filteredContent };
		});
	};
}
