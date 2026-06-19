/**
 * Model selector input dispatch helpers (reduces ModelSelectorComponent.handleInput S3776).
 *
 * The dispatch returns which high-level action should run; the caller is
 * responsible for mutating component state (selectedIndex, updateList) so the
 * helpers stay pure and side-effect free.
 */

import { getKeybindings } from "@earendil-works/pi-tui";

export type ModelSelectorAction =
	| { type: "noop" }
	| { type: "toggle-scope" }
	| { type: "move-selection"; nextIndex: number }
	| { type: "select-current" }
	| { type: "cancel" }
	| { type: "forward-to-search" };

export interface ModelSelectorInputState {
	selectedIndex: number;
	filteredCount: number;
	scopedCount: number;
}

/**
 * Wrap-around arithmetic for list navigation.
 */
function wrapIndex(current: number, total: number, direction: 1 | -1): number {
	if (total === 0) return current;
	if (direction === -1) {
		return current === 0 ? total - 1 : current - 1;
	}
	return current === total - 1 ? 0 : current + 1;
}

/**
 * Map a key event to a high-level action. Pure: never mutates state.
 */
export function dispatchModelSelectorKey(keyData: string, state: ModelSelectorInputState): ModelSelectorAction {
	const kb = getKeybindings();

	if (kb.matches(keyData, "tui.input.tab")) {
		return { type: state.scopedCount > 0 ? "toggle-scope" : "noop" };
	}

	if (kb.matches(keyData, "tui.select.up")) {
		return { type: "move-selection", nextIndex: wrapIndex(state.selectedIndex, state.filteredCount, -1) };
	}

	if (kb.matches(keyData, "tui.select.down")) {
		return { type: "move-selection", nextIndex: wrapIndex(state.selectedIndex, state.filteredCount, 1) };
	}

	if (kb.matches(keyData, "tui.select.confirm")) {
		return { type: "select-current" };
	}

	if (kb.matches(keyData, "tui.select.cancel")) {
		return { type: "cancel" };
	}

	return { type: "forward-to-search" };
}
