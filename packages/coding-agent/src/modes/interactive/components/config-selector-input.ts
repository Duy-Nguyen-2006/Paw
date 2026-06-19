/**
 * Config selector input dispatch (reduces ResourceList.handleInput S3776).
 */

import { getKeybindings, matchesKey } from "@earendil-works/pi-tui";

import type { FlatEntry, ResourceItem } from "./config-selector-types.ts";

export type ConfigSelectorAction =
	| { type: "noop" }
	| { type: "select-prev" }
	| { type: "select-next" }
	| { type: "page-up"; target: number }
	| { type: "page-down"; target: number }
	| { type: "cancel" }
	| { type: "exit" }
	| { type: "toggle-current" }
	| { type: "forward-to-search" };

/** Find the nearest item index at or after `from`, going forward. */
export function findNextItemIndex(filtered: ReadonlyArray<FlatEntry>, from: number): number {
	for (let i = from; i < filtered.length; i++) {
		if (filtered[i]?.type === "item") return i;
	}
	return -1;
}

/** Find the nearest item index at or before `from`, going backward. */
export function findPrevItemIndex(filtered: ReadonlyArray<FlatEntry>, from: number): number {
	for (let i = from; i >= 0; i--) {
		if (filtered[i]?.type === "item") return i;
	}
	return -1;
}

/** Walk forward from `start` to the first "item" entry, or -1 if none. */
export function pageDownToItem(filtered: ReadonlyArray<FlatEntry>, start: number): number {
	const minStart = Math.min(filtered.length - 1, start);
	if (minStart < 0) return -1;
	let target: number | null = minStart >= 0 ? minStart : null;
	while (target !== null && target >= 0) {
		if (filtered[target]?.type === "item") return target;
		target--;
	}
	return -1;
}

/** Walk backward from `start` to the first "item" entry, or -1 if none. */
export function pageUpToItem(filtered: ReadonlyArray<FlatEntry>, start: number): number {
	const maxStart = Math.max(0, start);
	let target: number | null = maxStart;
	while (target !== null && target < filtered.length) {
		if (filtered[target]?.type === "item") return target;
		target++;
	}
	return -1;
}

/**
 * Map a key event to a high-level action. Pure: never mutates state.
 */
export function dispatchConfigSelectorKey(
	keyData: string,
	state: { selectedIndex: number; maxVisible: number; filteredCount: number },
): ConfigSelectorAction {
	const kb = getKeybindings();

	if (kb.matches(keyData, "tui.select.up")) {
		return { type: "select-prev" };
	}
	if (kb.matches(keyData, "tui.select.down")) {
		return { type: "select-next" };
	}
	if (kb.matches(keyData, "tui.select.pageUp")) {
		const target = Math.max(0, state.selectedIndex - state.maxVisible);
		return { type: "page-up", target };
	}
	if (kb.matches(keyData, "tui.select.pageDown")) {
		const target = Math.min(state.filteredCount - 1, state.selectedIndex + state.maxVisible);
		return { type: "page-down", target };
	}
	if (kb.matches(keyData, "tui.select.cancel")) {
		return { type: "cancel" };
	}
	if (matchesKey(keyData, "ctrl+c")) {
		return { type: "exit" };
	}
	if (keyData === " " || kb.matches(keyData, "tui.select.confirm")) {
		return { type: "toggle-current" };
	}
	return { type: "forward-to-search" };
}

/** Whether an item is the "current" item in the flat entry list. */
export function isItemEntry(entry: FlatEntry): entry is { type: "item"; item: ResourceItem } {
	return entry.type === "item";
}
