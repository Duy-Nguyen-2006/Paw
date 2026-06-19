/**
 * Session list input dispatch (reduces SessionList.handleInput S3776).
 */

import { getKeybindings } from "@earendil-works/pi-tui";
import type { KeybindingsManager } from "../../../core/keybindings.ts";

import type { FlatSessionNode } from "./session-selector-tree.ts";

export type SessionListAction =
	| { type: "noop" }
	| { type: "confirm-delete"; path: string }
	| { type: "cancel-delete" }
	| { type: "toggle-scope" }
	| { type: "toggle-sort" }
	| { type: "toggle-named-filter" }
	| { type: "toggle-path"; nextValue: boolean }
	| { type: "start-delete" }
	| { type: "rename-selected"; path: string }
	| { type: "forward-delete-noninvasive" }
	| { type: "move-up" }
	| { type: "move-down" }
	| { type: "page-up" }
	| { type: "page-down" }
	| { type: "select-current"; path: string }
	| { type: "cancel" }
	| { type: "forward-to-search" };

/** Compute next selected index, clamped to [0, length-1]. */
export function clampedIndex(current: number, length: number, delta: number): number {
	if (length === 0) return 0;
	return Math.max(0, Math.min(length - 1, current + delta));
}

/** Bundle of state for the dispatcher. */
export interface SessionListInputState {
	selectedIndex: number;
	filteredCount: number;
	filteredSessions: ReadonlyArray<FlatSessionNode>;
	showPath: boolean;
	confirmingDeletePath: string | null;
	searchValueLength: number;
	maxVisible: number;
}

/**
 * Map a key event to a high-level action. Pure: never mutates state.
 */
export function dispatchSessionListKey(
	keyData: string,
	state: SessionListInputState,
	deps: { keybindings: KeybindingsManager },
): SessionListAction {
	const kb = getKeybindings();

	// Delete confirmation intercepts every key.
	if (state.confirmingDeletePath !== null) {
		if (kb.matches(keyData, "tui.select.confirm")) {
			return { type: "confirm-delete", path: state.confirmingDeletePath };
		}
		if (kb.matches(keyData, "tui.select.cancel")) {
			return { type: "cancel-delete" };
		}
		return { type: "noop" };
	}

	if (kb.matches(keyData, "tui.input.tab")) {
		return { type: "toggle-scope" };
	}
	if (kb.matches(keyData, "app.session.toggleSort")) {
		return { type: "toggle-sort" };
	}
	if (deps.keybindings.matches(keyData, "app.session.toggleNamedFilter")) {
		return { type: "toggle-named-filter" };
	}
	if (kb.matches(keyData, "app.session.togglePath")) {
		return { type: "toggle-path", nextValue: !state.showPath };
	}
	if (kb.matches(keyData, "app.session.delete")) {
		return { type: "start-delete" };
	}
	if (kb.matches(keyData, "app.session.rename")) {
		const selected = state.filteredSessions[state.selectedIndex];
		return selected ? { type: "rename-selected", path: selected.session.path } : { type: "noop" };
	}
	if (kb.matches(keyData, "app.session.deleteNoninvasive")) {
		if (state.searchValueLength > 0) {
			return { type: "forward-delete-noninvasive" };
		}
		return { type: "start-delete" };
	}

	if (kb.matches(keyData, "tui.select.up")) {
		return { type: "move-up" };
	}
	if (kb.matches(keyData, "tui.select.down")) {
		return { type: "move-down" };
	}
	if (kb.matches(keyData, "tui.select.pageUp")) {
		return { type: "page-up" };
	}
	if (kb.matches(keyData, "tui.select.pageDown")) {
		return { type: "page-down" };
	}
	if (kb.matches(keyData, "tui.select.confirm")) {
		const selected = state.filteredSessions[state.selectedIndex];
		return selected ? { type: "select-current", path: selected.session.path } : { type: "noop" };
	}
	if (kb.matches(keyData, "tui.select.cancel")) {
		return { type: "cancel" };
	}

	return { type: "forward-to-search" };
}
