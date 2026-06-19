/**
 * Model selector load/filter helpers (reduces ModelSelectorComponent S3776).
 */

import { type Model, modelsAreEqual } from "@earendil-works/pi-ai";
import { fuzzyFilter } from "@earendil-works/pi-tui";
import type { ModelRegistry } from "../../../core/model-registry.ts";

import type { ModelItem, ScopedModelItem } from "./model-selector-types.ts";

export interface LoadModelsResult {
	allModels: ModelItem[];
	scopedModelItems: ModelItem[];
	activeModels: ModelItem[];
	filteredModels: ModelItem[];
	selectedIndex: number;
	errorMessage?: string;
}

/**
 * Refresh scopedModels against the latest registry entries so metadata is current.
 */
export function refreshScopedModels(
	registry: ModelRegistry,
	scopedModels: ReadonlyArray<ScopedModelItem>,
): ScopedModelItem[] {
	return scopedModels.map((scoped) => {
		const refreshed = registry.find(scoped.model.provider, scoped.model.id);
		return refreshed ? { ...scoped, model: refreshed } : scoped;
	});
}

/**
 * Build the active ModelItem[] for the current scope (scoped vs all).
 */
export function buildActiveModelList(
	scope: "all" | "scoped",
	allModels: ModelItem[],
	scopedModelItems: ModelItem[],
): ModelItem[] {
	return scope === "scoped" ? scopedModelItems : allModels;
}

/**
 * Compute the next selectedIndex so it stays within bounds and prefers the current model.
 */
export function computeModelSelectedIndex(
	items: ModelItem[],
	currentModel: Model<any> | undefined,
	fallbackIndex: number,
): number {
	const currentIndex = items.findIndex((item) => modelsAreEqual(currentModel, item.model));
	if (currentIndex >= 0) return currentIndex;
	return Math.min(fallbackIndex, Math.max(0, items.length - 1));
}

/**
 * Convert available models into ModelItem rows.
 */
export function toModelItems(availableModels: ReadonlyArray<Model<any>>): ModelItem[] {
	return availableModels.map((model) => ({
		provider: model.provider,
		id: model.id,
		model,
	}));
}

/**
 * Sort models with the current model pinned first, then by provider.
 */
export function sortModelsWithCurrentFirst(
	models: ReadonlyArray<ModelItem>,
	currentModel: Model<any> | undefined,
): ModelItem[] {
	const sorted = [...models];
	sorted.sort((a, b) => {
		const aIsCurrent = modelsAreEqual(currentModel, a.model);
		const bIsCurrent = modelsAreEqual(currentModel, b.model);
		if (aIsCurrent && !bIsCurrent) return -1;
		if (!aIsCurrent && bIsCurrent) return 1;
		return a.provider.localeCompare(b.provider);
	});
	return sorted;
}

/**
 * Reset all state arrays on load failure.
 */
export function emptyModelState(): Pick<
	LoadModelsResult,
	"allModels" | "scopedModelItems" | "activeModels" | "filteredModels"
> {
	return {
		allModels: [],
		scopedModelItems: [],
		activeModels: [],
		filteredModels: [],
	};
}

/**
 * Filter active models by the search query, clamping the selection to stay in bounds.
 */
export function applyModelFilter(
	activeModels: ReadonlyArray<ModelItem>,
	query: string,
	selectedIndex: number,
): { filtered: ModelItem[]; selectedIndex: number } {
	const filtered: ModelItem[] = query
		? (fuzzyFilter(
				[...activeModels],
				query,
				({ id, provider }) => `${id} ${provider} ${provider}/${id} ${provider} ${id}`,
			) as ModelItem[])
		: [...activeModels];
	const clamped = Math.min(selectedIndex, Math.max(0, filtered.length - 1));
	return { filtered, selectedIndex: clamped };
}
