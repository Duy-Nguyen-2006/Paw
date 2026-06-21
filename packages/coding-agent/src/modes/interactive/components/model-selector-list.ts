/**
 * Model selector list rendering (reduces ModelSelectorComponent.updateList complexity).
 */

import type { Api, Model } from "@earendil-works/pi-ai";
import { modelsAreEqual } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.ts";

export interface ModelListItem {
	provider: string;
	id: string;
	model: Model<Api>;
}

export function formatModelSelectorLine(
	item: ModelListItem,
	isSelected: boolean,
	currentModel: Model<Api> | undefined,
): string {
	const isCurrent = modelsAreEqual(currentModel, item.model);
	if (isSelected) {
		const prefix = theme.fg("accent", "→ ");
		const modelText = `${item.id}`;
		const providerBadge = theme.fg("muted", `[${item.provider}]`);
		const checkmark = isCurrent ? theme.fg("success", " ✓") : "";
		return `${prefix + theme.fg("accent", modelText)} ${providerBadge}${checkmark}`;
	}
	const modelText = `  ${item.id}`;
	const providerBadge = theme.fg("muted", `[${item.provider}]`);
	const checkmark = isCurrent ? theme.fg("success", " ✓") : "";
	return `${modelText} ${providerBadge}${checkmark}`;
}

export function computeModelListVisibleRange(
	selectedIndex: number,
	totalCount: number,
	maxVisible = 10,
): { startIndex: number; endIndex: number } {
	const startIndex = Math.max(0, Math.min(selectedIndex - Math.floor(maxVisible / 2), totalCount - maxVisible));
	const endIndex = Math.min(startIndex + maxVisible, totalCount);
	return { startIndex, endIndex };
}

export function renderModelListFooter(
	errorMessage: string | undefined,
	filteredModels: ModelListItem[],
	selectedIndex: number,
	startIndex: number,
	endIndex: number,
): Text[] {
	const lines: Text[] = [];
	if (errorMessage) {
		for (const line of errorMessage.split("\n")) {
			lines.push(new Text(theme.fg("error", line), 0, 0));
		}
		return lines;
	}
	if (filteredModels.length === 0) {
		lines.push(new Text(theme.fg("muted", "  No matching models"), 0, 0));
		return lines;
	}
	if (startIndex > 0 || endIndex < filteredModels.length) {
		lines.push(new Text(theme.fg("muted", `  (${selectedIndex + 1}/${filteredModels.length})`), 0, 0));
	}
	const selected = filteredModels[selectedIndex];
	if (selected) {
		lines.push(new Text(theme.fg("muted", `  Model Name: ${selected.model.name}`), 0, 0));
	}
	return lines;
}
