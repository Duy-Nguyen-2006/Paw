/**
 * Model selector list rendering helpers (reduces ModelSelectorComponent.updateList S3776).
 */

import type { Model } from "@earendil-works/pi-ai";
import { type Container, Spacer, Text } from "@earendil-works/pi-tui";

import { theme } from "../theme/theme.ts";
import { computeModelListVisibleRange, formatModelSelectorLine, type ModelListItem } from "./model-selector-list.ts";

/**
 * Render visible model lines into the list container.
 */
export function renderModelListRows(
	listContainer: Container,
	filtered: ReadonlyArray<ModelListItem>,
	selectedIndex: number,
	currentModel: Model<any> | undefined,
): { startIndex: number; endIndex: number } {
	const { startIndex, endIndex } = computeModelListVisibleRange(selectedIndex, filtered.length);
	for (let i = startIndex; i < endIndex; i++) {
		const item = filtered[i];
		if (!item) continue;
		const line = formatModelSelectorLine(item, i === selectedIndex, currentModel);
		listContainer.addChild(new Text(line, 0, 0));
	}
	return { startIndex, endIndex };
}

/**
 * Add a scroll indicator line when the visible range doesn't cover the entire list.
 */
export function renderModelListScrollIndicator(
	listContainer: Container,
	filteredCount: number,
	selectedIndex: number,
	startIndex: number,
	endIndex: number,
): void {
	if (startIndex > 0 || endIndex < filteredCount) {
		const scrollInfo = theme.fg("muted", `  (${selectedIndex + 1}/${filteredCount})`);
		listContainer.addChild(new Text(scrollInfo, 0, 0));
	}
}

/**
 * Render an error message into the list container.
 */
export function renderModelListError(listContainer: Container, errorMessage: string): void {
	for (const line of errorMessage.split("\n")) {
		listContainer.addChild(new Text(theme.fg("error", line), 0, 0));
	}
}

/**
 * Render the "no results" placeholder.
 */
export function renderModelListEmpty(listContainer: Container): void {
	listContainer.addChild(new Text(theme.fg("muted", "  No matching models"), 0, 0));
}

/**
 * Render the currently selected model's name in a footer block.
 */
export function renderModelListSelectedFooter(
	listContainer: Container,
	filtered: ReadonlyArray<ModelListItem>,
	selectedIndex: number,
): void {
	const selected = filtered[selectedIndex];
	if (!selected) return;
	listContainer.addChild(new Spacer(1));
	listContainer.addChild(new Text(theme.fg("muted", `  Model Name: ${selected.model.name}`), 0, 0));
}
