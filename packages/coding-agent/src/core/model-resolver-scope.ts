/**
 * Model scope pattern resolution (extracted from model-resolver.ts for S3776).
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { type Api, type Model, modelsAreEqual } from "@earendil-works/pi-ai";
import chalk from "chalk";
import { minimatch } from "minimatch";
import { isValidThinkingLevel } from "../cli/args.ts";
import type { ModelRegistry } from "./model-registry.ts";
import { parseModelPattern, type ScopedModel } from "./model-resolver.ts";

export function resolveGlobScopedModels(
	pattern: string,
	availableModels: Model<Api>[],
	scopedModels: ScopedModel[],
): void {
	const colonIdx = pattern.lastIndexOf(":");
	let globPattern = pattern;
	let thinkingLevel: ThinkingLevel | undefined;

	if (colonIdx !== -1) {
		const suffix = pattern.substring(colonIdx + 1);
		if (isValidThinkingLevel(suffix)) {
			thinkingLevel = suffix;
			globPattern = pattern.substring(0, colonIdx);
		}
	}

	const matchingModels = availableModels.filter((m) => {
		const fullId = `${m.provider}/${m.id}`;
		return minimatch(fullId, globPattern, { nocase: true }) || minimatch(m.id, globPattern, { nocase: true });
	});

	if (matchingModels.length === 0) {
		console.warn(chalk.yellow(`Warning: No models match pattern "${pattern}"`));
		return;
	}

	for (const model of matchingModels) {
		if (!scopedModels.find((sm) => modelsAreEqual(sm.model, model))) {
			scopedModels.push({ model, thinkingLevel });
		}
	}
}

export function resolvePlainScopedModel(
	pattern: string,
	availableModels: Model<Api>[],
	scopedModels: ScopedModel[],
): void {
	const { model, thinkingLevel, warning } = parseModelPattern(pattern, availableModels);

	if (warning) {
		console.warn(chalk.yellow(`Warning: ${warning}`));
	}

	if (!model) {
		console.warn(chalk.yellow(`Warning: No models match pattern "${pattern}"`));
		return;
	}

	if (!scopedModels.find((sm) => modelsAreEqual(sm.model, model))) {
		scopedModels.push({ model, thinkingLevel });
	}
}

export function resolveModelScopeFromPatterns(patterns: string[], modelRegistry: ModelRegistry): ScopedModel[] {
	const availableModels = modelRegistry.getAvailable();
	const scopedModels: ScopedModel[] = [];

	for (const pattern of patterns) {
		if (pattern.includes("*") || pattern.includes("?") || pattern.includes("[")) {
			resolveGlobScopedModels(pattern, availableModels, scopedModels);
			continue;
		}
		resolvePlainScopedModel(pattern, availableModels, scopedModels);
	}

	return scopedModels;
}
