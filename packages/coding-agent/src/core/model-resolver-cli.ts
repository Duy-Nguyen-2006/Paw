/**
 * CLI model resolution helpers (reduces resolveCliModel cognitive complexity).
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { type Api, type Model, modelsAreEqual } from "@earendil-works/pi-ai";
import { isValidThinkingLevel } from "../cli/args.ts";
import type { ModelRegistry } from "./model-registry.ts";
import { buildFallbackModel, type ParsedModelResult, parseModelPattern } from "./model-resolver.ts";

export function buildProviderMap(availableModels: Model<Api>[]): Map<string, string> {
	const providerMap = new Map<string, string>();
	for (const m of availableModels) {
		providerMap.set(m.provider.toLowerCase(), m.provider);
	}
	return providerMap;
}

export function tryExactCliModelMatch(cliModel: string, availableModels: Model<Api>[]): Model<Api> | undefined {
	const lower = cliModel.toLowerCase();
	return availableModels.find((m) => m.id.toLowerCase() === lower || `${m.provider}/${m.id}`.toLowerCase() === lower);
}

export function inferProviderFromSlash(
	cliModel: string,
	providerMap: Map<string, string>,
): { provider: string; pattern: string } | undefined {
	const slashIndex = cliModel.indexOf("/");
	if (slashIndex === -1) return undefined;
	const maybeProvider = cliModel.substring(0, slashIndex);
	const canonical = providerMap.get(maybeProvider.toLowerCase());
	if (!canonical) return undefined;
	return { provider: canonical, pattern: cliModel.substring(slashIndex + 1) };
}

export function stripProviderPrefixIfBothProvided(
	cliProvider: string | undefined,
	provider: string,
	cliModel: string,
	pattern: string,
): string {
	if (!cliProvider) return pattern;
	const prefix = `${provider}/`;
	if (cliModel.toLowerCase().startsWith(prefix.toLowerCase())) {
		return cliModel.substring(prefix.length);
	}
	return pattern;
}

export function resolveAuthenticatedRawIdFallback(
	cliModel: string,
	model: Model<Api>,
	availableModels: Model<Api>[],
	modelRegistry: ModelRegistry,
): Model<Api> | undefined {
	const rawExactMatches = availableModels.filter(
		(m) => m.id.toLowerCase() === cliModel.toLowerCase() && !modelsAreEqual(m, model),
	);
	if (rawExactMatches.length === 0 || modelRegistry.hasConfiguredAuth(model)) {
		return undefined;
	}
	const authenticatedRawMatches = rawExactMatches.filter((m) => modelRegistry.hasConfiguredAuth(m));
	return authenticatedRawMatches.length === 1 ? authenticatedRawMatches[0] : undefined;
}

export function tryInferredProviderFallback(
	cliModel: string,
	availableModels: Model<Api>[],
): ParsedModelResult | undefined {
	const exact = tryExactCliModelMatch(cliModel, availableModels);
	if (exact) {
		return { model: exact, thinkingLevel: undefined, warning: undefined };
	}
	return parseModelPattern(cliModel, availableModels, { allowInvalidThinkingLevelFallback: false });
}

export function parseFallbackThinkingFromPattern(
	pattern: string,
	cliThinking: ThinkingLevel | undefined,
): { fallbackPattern: string; fallbackThinking: ThinkingLevel | undefined } {
	if (cliThinking) {
		return { fallbackPattern: pattern, fallbackThinking: undefined };
	}
	const lastColon = pattern.lastIndexOf(":");
	if (lastColon === -1) {
		return { fallbackPattern: pattern, fallbackThinking: undefined };
	}
	const suffix = pattern.substring(lastColon + 1);
	if (!isValidThinkingLevel(suffix)) {
		return { fallbackPattern: pattern, fallbackThinking: undefined };
	}
	return { fallbackPattern: pattern.substring(0, lastColon), fallbackThinking: suffix };
}

export function buildProviderFallbackResult(
	provider: string,
	pattern: string,
	availableModels: Model<Api>[],
	cliThinking: ThinkingLevel | undefined,
	warning: string | undefined,
): { model: Model<Api>; thinkingLevel?: ThinkingLevel; warning: string } | undefined {
	const { fallbackPattern, fallbackThinking } = parseFallbackThinkingFromPattern(pattern, cliThinking);
	const fallbackModel = buildFallbackModel(provider, fallbackPattern, availableModels);
	if (!fallbackModel) return undefined;

	const requestedThinking = cliThinking ?? fallbackThinking;
	const model =
		requestedThinking && requestedThinking !== "off" ? { ...fallbackModel, reasoning: true } : fallbackModel;
	const fallbackWarning = warning
		? `${warning} Model "${fallbackPattern}" not found for provider "${provider}". Using custom model id.`
		: `Model "${fallbackPattern}" not found for provider "${provider}". Using custom model id.`;
	return { model, thinkingLevel: fallbackThinking, warning: fallbackWarning };
}
