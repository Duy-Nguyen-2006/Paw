import {
	type Component,
	Container,
	type Focusable,
	getKeybindings,
	Input,
	type Keybinding,
	Spacer,
	Text,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { SessionTreeNode } from "../../../core/session-manager.ts";
import { theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { formatKeyText, keyHint } from "./keybinding-hints.ts";
import { getTreeEntryDisplayText } from "./tree-selector-display.ts";
import {
	buildChildGutters,
	buildContainsActiveMap,
	buildTreeLinePrefixChars,
	collectFoldDescendantSkipIds,
	computeChildIndent,
	entryPassesTreeFilterMode,
	extractAssistantToolCalls,
	type FilterMode,
	formatTreeLabelTimestamp,
	type GutterInfo,
	getTreeSearchableText,
	shouldHideToolOnlyAssistant,
	type ToolCallInfo,
	type TreeFlatNode,
} from "./tree-selector-helpers.ts";

export type { FilterMode } from "./tree-selector-helpers.ts";

/** Flattened tree node for navigation */
type FlatNode = TreeFlatNode;

/**
 * Tree list component with selection and ASCII art visualization
 */
class TreeList implements Component {
	private flatNodes: FlatNode[] = [];
	private filteredNodes: FlatNode[] = [];
	private selectedIndex = 0;
	private currentLeafId: string | null;
	private maxVisibleLines: number;
	private filterMode: FilterMode = "default";
	private searchQuery = "";
	private toolCallMap: Map<string, ToolCallInfo> = new Map();
	private multipleRoots = false;
	private showLabelTimestamps = false;
	private activePathIds: Set<string> = new Set();
	private visibleParentMap: Map<string, string | null> = new Map();
	private visibleChildrenMap: Map<string | null, string[]> = new Map();
	private lastSelectedId: string | null = null;
	private foldedNodes: Set<string> = new Set();

	public onSelect?: (entryId: string) => void;
	public onCancel?: () => void;
	public onLabelEdit?: (entryId: string, currentLabel: string | undefined) => void;

	constructor(
		tree: SessionTreeNode[],
		currentLeafId: string | null,
		maxVisibleLines: number,
		initialSelectedId?: string,
		initialFilterMode?: FilterMode,
	) {
		this.currentLeafId = currentLeafId;
		this.maxVisibleLines = maxVisibleLines;
		this.filterMode = initialFilterMode ?? "default";
		this.multipleRoots = tree.length > 1;
		this.flatNodes = this.flattenTree(tree);
		this.buildActivePath();
		this.applyFilter();

		// Start with initialSelectedId if provided, otherwise current leaf
		const targetId = initialSelectedId ?? currentLeafId;
		this.selectedIndex = this.findNearestVisibleIndex(targetId);
		this.lastSelectedId = this.filteredNodes[this.selectedIndex]?.node.entry.id ?? null;
	}

	/**
	 * Find the index of the nearest visible entry, walking up the parent chain if needed.
	 * Returns the index in filteredNodes, or the last index as fallback.
	 */
	private findNearestVisibleIndex(entryId: string | null): number {
		if (this.filteredNodes.length === 0) return 0;

		// Build a map for parent lookup
		const entryMap = new Map<string, FlatNode>();
		for (const flatNode of this.flatNodes) {
			entryMap.set(flatNode.node.entry.id, flatNode);
		}

		// Build a map of visible entry IDs to their indices in filteredNodes
		const visibleIdToIndex = new Map<string, number>(this.filteredNodes.map((node, i) => [node.node.entry.id, i]));

		// Walk from entryId up to root, looking for a visible entry
		let currentId = entryId;
		while (currentId !== null) {
			const index = visibleIdToIndex.get(currentId);
			if (index !== undefined) return index;
			const node = entryMap.get(currentId);
			if (!node) break;
			currentId = node.node.entry.parentId ?? null;
		}

		// Fallback: last visible entry
		return this.filteredNodes.length - 1;
	}

	/** Build the set of entry IDs on the path from root to current leaf */
	private buildActivePath(): void {
		this.activePathIds.clear();
		if (!this.currentLeafId) return;

		// Build a map of id -> entry for parent lookup
		const entryMap = new Map<string, FlatNode>();
		for (const flatNode of this.flatNodes) {
			entryMap.set(flatNode.node.entry.id, flatNode);
		}

		// Walk from leaf to root
		let currentId: string | null = this.currentLeafId;
		while (currentId) {
			this.activePathIds.add(currentId);
			const node = entryMap.get(currentId);
			if (!node) break;
			currentId = node.node.entry.parentId ?? null;
		}
	}

	private flattenTree(roots: SessionTreeNode[]): FlatNode[] {
		const result: FlatNode[] = [];
		this.toolCallMap.clear();

		// Indentation rules:
		// - At indent 0: stay at 0 unless parent has >1 children (then +1)
		// - At indent 1: children always go to indent 2 (visual grouping of subtree)
		// - At indent 2+: stay flat for single-child chains, +1 only if parent branches

		// Stack items: [node, indent, justBranched, showConnector, isLast, gutters, isVirtualRootChild]
		type StackItem = [SessionTreeNode, number, boolean, boolean, boolean, GutterInfo[], boolean];
		const stack: StackItem[] = [];

		const containsActive = buildContainsActiveMap(roots, this.currentLeafId);

		// Add roots in reverse order, prioritizing the one containing the active leaf
		// If multiple roots, treat them as children of a virtual root that branches
		const multipleRoots = roots.length > 1;
		const orderedRoots = [...roots].sort((a, b) => Number(containsActive.get(b)) - Number(containsActive.get(a)));
		for (let i = orderedRoots.length - 1; i >= 0; i--) {
			const isLast = i === orderedRoots.length - 1;
			stack.push([orderedRoots[i], multipleRoots ? 1 : 0, multipleRoots, multipleRoots, isLast, [], multipleRoots]);
		}

		while (stack.length > 0) {
			const [node, indent, justBranched, showConnector, isLast, gutters, isVirtualRootChild] = stack.pop()!;

			extractAssistantToolCalls(node.entry, (id, info) => this.toolCallMap.set(id, info));

			result.push({ node, indent, showConnector, isLast, gutters, isVirtualRootChild });

			const children = node.children;
			const multipleChildren = children.length > 1;

			// Order children so the branch containing the active leaf comes first
			const orderedChildren = (() => {
				const prioritized: SessionTreeNode[] = [];
				const rest: SessionTreeNode[] = [];
				for (const child of children) {
					if (containsActive.get(child)) {
						prioritized.push(child);
					} else {
						rest.push(child);
					}
				}
				return [...prioritized, ...rest];
			})();

			const childIndent = computeChildIndent(indent, multipleChildren, justBranched);
			const childGutters = buildChildGutters(
				gutters,
				showConnector,
				isVirtualRootChild,
				isLast,
				this.multipleRoots,
				indent,
			);

			// Add children in reverse order
			for (let i = orderedChildren.length - 1; i >= 0; i--) {
				const childIsLast = i === orderedChildren.length - 1;
				stack.push([
					orderedChildren[i],
					childIndent,
					multipleChildren,
					multipleChildren,
					childIsLast,
					childGutters,
					false,
				]);
			}
		}

		return result;
	}

	private applyFilter(): void {
		// Update lastSelectedId only when we have a valid selection (non-empty list)
		// This preserves the selection when switching through empty filter results
		if (this.filteredNodes.length > 0) {
			this.lastSelectedId = this.filteredNodes[this.selectedIndex]?.node.entry.id ?? this.lastSelectedId;
		}

		const searchTokens = this.searchQuery.toLowerCase().split(/\s+/).filter(Boolean);

		this.filteredNodes = this.flatNodes.filter((flatNode) => {
			const entry = flatNode.node.entry;
			if (shouldHideToolOnlyAssistant(entry, this.currentLeafId)) {
				return false;
			}
			if (!entryPassesTreeFilterMode(entry, this.filterMode, flatNode.node.label !== undefined)) {
				return false;
			}
			if (searchTokens.length > 0) {
				const nodeText = getTreeSearchableText(flatNode.node).toLowerCase();
				return searchTokens.every((token) => nodeText.includes(token));
			}
			return true;
		});

		if (this.foldedNodes.size > 0) {
			const skipSet = collectFoldDescendantSkipIds(this.flatNodes, this.foldedNodes);
			this.filteredNodes = this.filteredNodes.filter((flatNode) => !skipSet.has(flatNode.node.entry.id));
		}

		// Recalculate visual structure (indent, connectors, gutters) based on visible tree
		this.recalculateVisualStructure();

		// Try to preserve cursor on the same node, or find nearest visible ancestor
		if (this.lastSelectedId) {
			this.selectedIndex = this.findNearestVisibleIndex(this.lastSelectedId);
		} else if (this.selectedIndex >= this.filteredNodes.length) {
			// Clamp index if out of bounds
			this.selectedIndex = Math.max(0, this.filteredNodes.length - 1);
		}

		// Update lastSelectedId to the actual selection (may have changed due to parent walk)
		if (this.filteredNodes.length > 0) {
			this.lastSelectedId = this.filteredNodes[this.selectedIndex]?.node.entry.id ?? this.lastSelectedId;
		}
	}

	/**
	 * Recompute indentation/connectors for the filtered view
	 *
	 * Filtering can hide intermediate entries; descendants attach to the nearest visible ancestor.
	 * Keep indentation semantics aligned with flattenTree() so single-child chains don't drift right.
	 */
	private recalculateVisualStructure(): void {
		if (this.filteredNodes.length === 0) return;

		const visibleIds = new Set(this.filteredNodes.map((n) => n.node.entry.id));

		// Build entry map for efficient parent lookup (using full tree)
		const entryMap = new Map<string, FlatNode>();
		for (const flatNode of this.flatNodes) {
			entryMap.set(flatNode.node.entry.id, flatNode);
		}

		// Find nearest visible ancestor for a node
		const findVisibleAncestor = (nodeId: string): string | null => {
			let currentId = entryMap.get(nodeId)?.node.entry.parentId ?? null;
			while (currentId !== null) {
				if (visibleIds.has(currentId)) {
					return currentId;
				}
				currentId = entryMap.get(currentId)?.node.entry.parentId ?? null;
			}
			return null;
		};

		// Build visible tree structure:
		// - visibleParent: nodeId → nearest visible ancestor (or null for roots)
		// - visibleChildren: parentId → list of visible children (in filteredNodes order)
		const visibleParent = new Map<string, string | null>();
		const visibleChildren = new Map<string | null, string[]>();
		visibleChildren.set(null, []); // root-level nodes

		for (const flatNode of this.filteredNodes) {
			const nodeId = flatNode.node.entry.id;
			const ancestorId = findVisibleAncestor(nodeId);
			visibleParent.set(nodeId, ancestorId);

			if (!visibleChildren.has(ancestorId)) {
				visibleChildren.set(ancestorId, []);
			}
			visibleChildren.get(ancestorId)!.push(nodeId);
		}

		// Update multipleRoots based on visible roots
		const visibleRootIds = visibleChildren.get(null)!;
		this.multipleRoots = visibleRootIds.length > 1;

		// Build a map for quick lookup: nodeId → FlatNode
		const filteredNodeMap = new Map<string, FlatNode>();
		for (const flatNode of this.filteredNodes) {
			filteredNodeMap.set(flatNode.node.entry.id, flatNode);
		}

		// DFS over the visible tree using flattenTree() indentation semantics
		// Stack items: [nodeId, indent, justBranched, showConnector, isLast, gutters, isVirtualRootChild]
		type StackItem = [string, number, boolean, boolean, boolean, GutterInfo[], boolean];
		const stack: StackItem[] = [];

		// Add visible roots in reverse order (to process in forward order via stack)
		for (let i = visibleRootIds.length - 1; i >= 0; i--) {
			const isLast = i === visibleRootIds.length - 1;
			stack.push([
				visibleRootIds[i],
				this.multipleRoots ? 1 : 0,
				this.multipleRoots,
				this.multipleRoots,
				isLast,
				[],
				this.multipleRoots,
			]);
		}

		while (stack.length > 0) {
			const [nodeId, indent, justBranched, showConnector, isLast, gutters, isVirtualRootChild] = stack.pop()!;

			const flatNode = filteredNodeMap.get(nodeId);
			if (!flatNode) continue;

			// Update this node's visual properties
			flatNode.indent = indent;
			flatNode.showConnector = showConnector;
			flatNode.isLast = isLast;
			flatNode.gutters = gutters;
			flatNode.isVirtualRootChild = isVirtualRootChild;

			// Get visible children of this node
			const children = visibleChildren.get(nodeId) || [];
			const multipleChildren = children.length > 1;

			const childIndent = computeChildIndent(indent, multipleChildren, justBranched);
			const childGutters = buildChildGutters(
				gutters,
				showConnector,
				isVirtualRootChild,
				isLast,
				this.multipleRoots,
				indent,
			);

			// Add children in reverse order (to process in forward order via stack)
			for (let i = children.length - 1; i >= 0; i--) {
				const childIsLast = i === children.length - 1;
				stack.push([
					children[i],
					childIndent,
					multipleChildren,
					multipleChildren,
					childIsLast,
					childGutters,
					false,
				]);
			}
		}

		// Store visible tree maps for ancestor/descendant lookups in navigation
		this.visibleParentMap = visibleParent;
		this.visibleChildrenMap = visibleChildren;
	}

	invalidate(): void {
		// No-op: component state is managed directly
	}

	getSearchQuery(): string {
		return this.searchQuery;
	}

	getSelectedNode(): SessionTreeNode | undefined {
		return this.filteredNodes[this.selectedIndex]?.node;
	}

	updateNodeLabel(entryId: string, label: string | undefined, labelTimestamp?: string): void {
		for (const flatNode of this.flatNodes) {
			if (flatNode.node.entry.id === entryId) {
				flatNode.node.label = label;
				flatNode.node.labelTimestamp = label ? (labelTimestamp ?? new Date().toISOString()) : undefined;
				break;
			}
		}
	}

	private getStatusLabels(): string {
		let labels = "";
		switch (this.filterMode) {
			case "no-tools":
				labels += " [no-tools]";
				break;
			case "user-only":
				labels += " [user]";
				break;
			case "labeled-only":
				labels += " [labeled]";
				break;
			case "all":
				labels += " [all]";
				break;
		}
		if (this.showLabelTimestamps) {
			labels += " [+label time]";
		}
		return labels;
	}

	render(width: number): string[] {
		const lines: string[] = [];

		if (this.filteredNodes.length === 0) {
			lines.push(truncateToWidth(theme.fg("muted", "  No entries found"), width));
			lines.push(truncateToWidth(theme.fg("muted", `  (0/0)${this.getStatusLabels()}`), width));
			return lines;
		}

		const startIndex = Math.max(
			0,
			Math.min(
				this.selectedIndex - Math.floor(this.maxVisibleLines / 2),
				this.filteredNodes.length - this.maxVisibleLines,
			),
		);
		const endIndex = Math.min(startIndex + this.maxVisibleLines, this.filteredNodes.length);

		for (let i = startIndex; i < endIndex; i++) {
			const flatNode = this.filteredNodes[i];
			const entry = flatNode.node.entry;
			const isSelected = i === this.selectedIndex;

			// Build line: cursor + prefix + path marker + label + content
			const cursor = isSelected ? theme.fg("accent", "› ") : "  ";

			// If multiple roots, shift display (roots at 0, not 1)
			const displayIndent = this.multipleRoots ? Math.max(0, flatNode.indent - 1) : flatNode.indent;

			// Build prefix with gutters at their correct positions
			// Each gutter has a position (displayIndent where its connector was shown)
			const connector =
				flatNode.showConnector && !flatNode.isVirtualRootChild ? (flatNode.isLast ? "└─ " : "├─ ") : "";
			const connectorPosition = connector ? displayIndent - 1 : -1;

			const isFolded = this.foldedNodes.has(entry.id);
			const foldable = this.isFoldable(entry.id);
			const prefix = buildTreeLinePrefixChars(
				displayIndent,
				flatNode.gutters,
				connector,
				connectorPosition,
				flatNode.isLast,
				isFolded,
				foldable,
			);

			// Fold marker for nodes without connectors (roots)
			const showsFoldInConnector = flatNode.showConnector && !flatNode.isVirtualRootChild;
			const foldMarker = isFolded && !showsFoldInConnector ? theme.fg("accent", "⊞ ") : "";

			// Active path marker - shown right before the entry text
			const isOnActivePath = this.activePathIds.has(entry.id);
			const pathMarker = isOnActivePath ? theme.fg("accent", "• ") : "";

			const label = flatNode.node.label ? theme.fg("warning", `[${flatNode.node.label}] `) : "";
			const labelTimestamp =
				this.showLabelTimestamps && flatNode.node.label && flatNode.node.labelTimestamp
					? theme.fg("muted", `${formatTreeLabelTimestamp(flatNode.node.labelTimestamp)} `)
					: "";
			const content = getTreeEntryDisplayText(flatNode.node, isSelected, this.toolCallMap);

			let line = cursor + theme.fg("dim", prefix) + foldMarker + pathMarker + label + labelTimestamp + content;
			if (isSelected) {
				line = theme.bg("selectedBg", line);
			}
			lines.push(truncateToWidth(line, width));
		}

		lines.push(
			truncateToWidth(
				theme.fg("muted", `  (${this.selectedIndex + 1}/${this.filteredNodes.length})${this.getStatusLabels()}`),
				width,
			),
		);

		return lines;
	}

	handleInput(keyData: string): void {
		const kb = getKeybindings();
		if (kb.matches(keyData, "tui.select.up")) {
			this.selectedIndex = this.selectedIndex === 0 ? this.filteredNodes.length - 1 : this.selectedIndex - 1;
		} else if (kb.matches(keyData, "tui.select.down")) {
			this.selectedIndex = this.selectedIndex === this.filteredNodes.length - 1 ? 0 : this.selectedIndex + 1;
		} else if (kb.matches(keyData, "app.tree.foldOrUp")) {
			this.handleFoldOrUp();
		} else if (kb.matches(keyData, "app.tree.unfoldOrDown")) {
			this.handleUnfoldOrDown();
		} else if (kb.matches(keyData, "tui.editor.cursorLeft") || kb.matches(keyData, "tui.select.pageUp")) {
			// Page up
			this.selectedIndex = Math.max(0, this.selectedIndex - this.maxVisibleLines);
		} else if (kb.matches(keyData, "tui.editor.cursorRight") || kb.matches(keyData, "tui.select.pageDown")) {
			// Page down
			this.selectedIndex = Math.min(this.filteredNodes.length - 1, this.selectedIndex + this.maxVisibleLines);
		} else if (kb.matches(keyData, "tui.select.confirm")) {
			this.handleConfirm();
		} else if (kb.matches(keyData, "tui.select.cancel")) {
			this.handleCancel();
		} else if (kb.matches(keyData, "app.tree.filter.default")) {
			this.setFilterModeAndRefresh("default");
		} else if (kb.matches(keyData, "app.tree.filter.noTools")) {
			this.toggleFilterMode("no-tools");
		} else if (kb.matches(keyData, "app.tree.filter.userOnly")) {
			this.toggleFilterMode("user-only");
		} else if (kb.matches(keyData, "app.tree.filter.labeledOnly")) {
			this.toggleFilterMode("labeled-only");
		} else if (kb.matches(keyData, "app.tree.filter.all")) {
			this.toggleFilterMode("all");
		} else if (kb.matches(keyData, "app.tree.filter.cycleBackward")) {
			this.cycleFilterMode(-1);
		} else if (kb.matches(keyData, "app.tree.filter.cycleForward")) {
			this.cycleFilterMode(1);
		} else if (kb.matches(keyData, "tui.editor.deleteCharBackward")) {
			if (this.searchQuery.length > 0) {
				this.searchQuery = this.searchQuery.slice(0, -1);
				this.foldedNodes.clear();
				this.applyFilter();
			}
		} else if (kb.matches(keyData, "app.tree.editLabel")) {
			this.handleEditLabel();
		} else if (kb.matches(keyData, "app.tree.toggleLabelTimestamp")) {
			this.showLabelTimestamps = !this.showLabelTimestamps;
		} else {
			this.handleSearchKeyInput(keyData);
		}
	}

	/** Fold the current node when foldable, otherwise move the selection up. */
	private handleFoldOrUp(): void {
		const currentId = this.filteredNodes[this.selectedIndex]?.node.entry.id;
		if (currentId && this.isFoldable(currentId) && !this.foldedNodes.has(currentId)) {
			this.foldedNodes.add(currentId);
			this.applyFilter();
		} else {
			this.selectedIndex = this.findBranchSegmentStart("up");
		}
	}

	/** Unfold the current node when folded, otherwise move the selection down. */
	private handleUnfoldOrDown(): void {
		const currentId = this.filteredNodes[this.selectedIndex]?.node.entry.id;
		if (currentId && this.foldedNodes.has(currentId)) {
			this.foldedNodes.delete(currentId);
			this.applyFilter();
		} else {
			this.selectedIndex = this.findBranchSegmentStart("down");
		}
	}

	/** Confirm the current selection and forward it to the registered handler. */
	private handleConfirm(): void {
		const selected = this.filteredNodes[this.selectedIndex];
		if (selected && this.onSelect) {
			this.onSelect(selected.node.entry.id);
		}
	}

	/** Cancel: clear any in-progress search query, otherwise trigger onCancel. */
	private handleCancel(): void {
		if (this.searchQuery) {
			this.searchQuery = "";
			this.foldedNodes.clear();
			this.applyFilter();
		} else {
			this.onCancel?.();
		}
	}

	/** Switch to a fixed filter mode and refresh the visible list. */
	private setFilterModeAndRefresh(mode: FilterMode): void {
		this.filterMode = mode;
		this.foldedNodes.clear();
		this.applyFilter();
	}

	/** Toggle between a target filter mode and the default filter. */
	private toggleFilterMode(target: FilterMode): void {
		this.setFilterModeAndRefresh(this.filterMode === target ? "default" : target);
	}

	/** Cycle through the filter modes by the given step (-1 or +1). */
	private cycleFilterMode(step: -1 | 1): void {
		const modes: FilterMode[] = ["default", "no-tools", "user-only", "labeled-only", "all"];
		const currentIndex = modes.indexOf(this.filterMode);
		const next = (currentIndex + step + modes.length) % modes.length;
		this.setFilterModeAndRefresh(modes[next] ?? "default");
	}

	/** Forward the edit-label request to the registered handler when possible. */
	private handleEditLabel(): void {
		const selected = this.filteredNodes[this.selectedIndex];
		if (selected && this.onLabelEdit) {
			this.onLabelEdit(selected.node.entry.id, selected.node.label);
		}
	}

	/**
	 * Append a non-control character to the search query when it should be
	 * treated as user-typed input.
	 */
	private handleSearchKeyInput(keyData: string): void {
		const hasControlChars = [...keyData].some((ch) => {
			const code = ch.codePointAt(0)!;
			return code < 32 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
		});
		if (!hasControlChars && keyData.length > 0) {
			this.searchQuery += keyData;
			this.foldedNodes.clear();
			this.applyFilter();
		}
	}

	/**
	 * Whether a node can be folded. A node is foldable if it has visible children
	 * and is either a root (no visible parent) or a segment start (visible parent
	 * has multiple visible children).
	 */
	private isFoldable(entryId: string): boolean {
		const children = this.visibleChildrenMap.get(entryId);
		if (!children || children.length === 0) return false;
		const parentId = this.visibleParentMap.get(entryId);
		if (parentId === null || parentId === undefined) return true;
		const siblings = this.visibleChildrenMap.get(parentId);
		return siblings !== undefined && siblings.length > 1;
	}

	/**
	 * Find the index of the next branch segment start in the given direction.
	 * A segment start is the first child of a branch point.
	 *
	 * "up" walks the visible parent chain; "down" walks visible children
	 * (always following the first child).
	 */
	private findBranchSegmentStart(direction: "up" | "down"): number {
		const selectedId = this.filteredNodes[this.selectedIndex]?.node.entry.id;
		if (!selectedId) return this.selectedIndex;

		const indexByEntryId = new Map(this.filteredNodes.map((node, i) => [node.node.entry.id, i]));
		let currentId: string = selectedId;
		if (direction === "down") {
			while (true) {
				const children: string[] = this.visibleChildrenMap.get(currentId) ?? [];
				if (children.length === 0) return indexByEntryId.get(currentId)!;
				if (children.length > 1) return indexByEntryId.get(children[0])!;
				currentId = children[0];
			}
		}

		// direction === "up"
		while (true) {
			const parentId: string | null = this.visibleParentMap.get(currentId) ?? null;
			if (parentId === null) return indexByEntryId.get(currentId)!;
			const children = this.visibleChildrenMap.get(parentId) ?? [];
			if (children.length > 1) {
				const segmentStart = indexByEntryId.get(currentId)!;
				if (segmentStart < this.selectedIndex) {
					return segmentStart;
				}
			}
			currentId = parentId;
		}
	}
}

/** Component that displays the current search query */
class SearchLine implements Component {
	private treeList: TreeList;

	constructor(treeList: TreeList) {
		this.treeList = treeList;
	}

	invalidate(): void {
		// No-op: search state is derived from tree
	}

	render(width: number): string[] {
		const query = this.treeList.getSearchQuery();
		if (query) {
			return [truncateToWidth(`  ${theme.fg("muted", "Type to search:")} ${theme.fg("accent", query)}`, width)];
		}
		return [truncateToWidth(`  ${theme.fg("muted", "Type to search:")}`, width)];
	}

	handleInput(_keyData: string): void {
		// No-op: input handled by parent tree component
	}
}

/** Component that renders tree help as semantic rows with chunk-aware wrapping */
class TreeHelp implements Component {
	invalidate(): void {
		// No-op: help content is static
	}

	render(width: number): string[] {
		const items = TREE_HELP_ITEMS.map(({ keys, label, labelFirst }) => {
			const text = formatHelpKeys(keys);
			if (!text) return label;
			return labelFirst ? `${label} ${text}` : `${text} ${label}`;
		});

		const availableWidth = Math.max(1, width);
		const indent = "  ";
		const separator = " · ";
		const lines: string[] = [];
		let currentLine = "";

		for (const item of items) {
			const candidate = currentLine
				? `${currentLine}${separator}${item}`
				: visibleWidth(`${indent}${item}`) <= availableWidth
					? `${indent}${item}`
					: item;
			if (!currentLine || visibleWidth(candidate) <= availableWidth) {
				currentLine = candidate;
				continue;
			}

			lines.push(...wrapTextWithAnsi(currentLine.trimEnd(), availableWidth));
			currentLine = visibleWidth(`${indent}${item}`) <= availableWidth ? `${indent}${item}` : item;
		}

		if (currentLine) {
			lines.push(...wrapTextWithAnsi(currentLine.trimEnd(), availableWidth));
		}

		return lines.map((line) => theme.fg("muted", line));
	}
}

const TREE_HELP_ITEMS: Array<{ keys: Keybinding[]; label: string; labelFirst?: boolean }> = [
	{ keys: ["tui.select.up", "tui.select.down"], label: "move" },
	{ keys: ["tui.editor.cursorLeft", "tui.editor.cursorRight"], label: "page" },
	{ keys: ["app.tree.foldOrUp", "app.tree.unfoldOrDown"], label: "branch" },
	{ keys: ["app.tree.editLabel"], label: "label" },
	{ keys: ["app.tree.toggleLabelTimestamp"], label: "label time" },
	{
		keys: [
			"app.tree.filter.default",
			"app.tree.filter.noTools",
			"app.tree.filter.userOnly",
			"app.tree.filter.labeledOnly",
			"app.tree.filter.all",
		],
		label: "filters",
		labelFirst: true,
	},
	{ keys: ["app.tree.filter.cycleForward", "app.tree.filter.cycleBackward"], label: "cycle", labelFirst: true },
];

function formatHelpKeys(keybindings: Keybinding[]): string {
	const keys: string[] = [];
	for (const keybinding of keybindings) {
		const key = getKeybindings().getKeys(keybinding)[0];
		if (key !== undefined) keys.push(key);
	}
	if (keys.length === 0) return "";

	return formatKeyText(compactRawKeys(keys))
		.replace(/\bpageUp\b/g, "pgup")
		.replace(/\bpageDown\b/g, "pgdn")
		.replace(/\bup\b/g, "↑")
		.replace(/\bdown\b/g, "↓")
		.replace(/\bleft\b/g, "←")
		.replace(/\bright\b/g, "→");
}

function compactRawKeys(keys: string[]): string {
	if (keys.length === 1) return keys[0]!;

	const parts = keys.map((key) => {
		const separatorIndex = key.lastIndexOf("+");
		return separatorIndex === -1
			? { prefix: "", suffix: key }
			: { prefix: key.slice(0, separatorIndex + 1), suffix: key.slice(separatorIndex + 1) };
	});
	const prefix = parts[0]!.prefix;
	return prefix && parts.every((part) => part.prefix === prefix)
		? `${prefix}${parts.map((part) => part.suffix).join("/")}`
		: keys.join("/");
}

/** Label input component shown when editing a label */
class LabelInput implements Component, Focusable {
	private input: Input;
	private entryId: string;
	public onSubmit?: (entryId: string, label: string | undefined) => void;
	public onCancel?: () => void;

	// Focusable implementation - propagate to input for IME cursor positioning
	private _focused = false;
	get focused(): boolean {
		return this._focused;
	}
	set focused(value: boolean) {
		this._focused = value;
		this.input.focused = value;
	}

	constructor(entryId: string, currentLabel: string | undefined) {
		this.entryId = entryId;
		this.input = new Input();
		if (currentLabel) {
			this.input.setValue(currentLabel);
		}
	}

	invalidate(): void {
		// No-op: label editor state is managed directly
	}

	render(width: number): string[] {
		const lines: string[] = [];
		const indent = "  ";
		const availableWidth = width - indent.length;
		lines.push(truncateToWidth(`${indent}${theme.fg("muted", "Label (empty to remove):")}`, width));
		lines.push(...this.input.render(availableWidth).map((line) => truncateToWidth(`${indent}${line}`, width)));
		lines.push(
			truncateToWidth(
				`${indent}${keyHint("tui.select.confirm", "save")}  ${keyHint("tui.select.cancel", "cancel")}`,
				width,
			),
		);
		return lines;
	}

	handleInput(keyData: string): void {
		const kb = getKeybindings();
		if (kb.matches(keyData, "tui.select.confirm")) {
			const value = this.input.getValue().trim();
			this.onSubmit?.(this.entryId, value || undefined);
		} else if (kb.matches(keyData, "tui.select.cancel")) {
			this.onCancel?.();
		} else {
			this.input.handleInput(keyData);
		}
	}
}

/**
 * Component that renders a session tree selector for navigation
 */
export class TreeSelectorComponent extends Container implements Focusable {
	private treeList: TreeList;
	private labelInput: LabelInput | null = null;
	private labelInputContainer: Container;
	private treeContainer: Container;
	private onLabelChangeCallback?: (entryId: string, label: string | undefined) => void;

	// Focusable implementation - propagate to labelInput when active for IME cursor positioning
	private _focused = false;
	get focused(): boolean {
		return this._focused;
	}
	set focused(value: boolean) {
		this._focused = value;
		// Propagate to labelInput when it's active
		if (this.labelInput) {
			this.labelInput.focused = value;
		}
	}

	constructor(
		tree: SessionTreeNode[],
		currentLeafId: string | null,
		terminalHeight: number,
		onSelect: (entryId: string) => void,
		onCancel: () => void,
		onLabelChange?: (entryId: string, label: string | undefined) => void,
		initialSelectedId?: string,
		initialFilterMode?: FilterMode,
	) {
		super();

		this.onLabelChangeCallback = onLabelChange;
		const maxVisibleLines = Math.max(5, Math.floor(terminalHeight / 2));

		this.treeList = new TreeList(tree, currentLeafId, maxVisibleLines, initialSelectedId, initialFilterMode);
		this.treeList.onSelect = onSelect;
		this.treeList.onCancel = onCancel;
		this.treeList.onLabelEdit = (entryId, currentLabel) => this.showLabelInput(entryId, currentLabel);

		this.treeContainer = new Container();
		this.treeContainer.addChild(this.treeList);

		this.labelInputContainer = new Container();

		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());
		this.addChild(new Text(theme.bold("  Session Tree"), 1, 0));
		this.addChild(new TreeHelp());
		this.addChild(new SearchLine(this.treeList));
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(this.treeContainer);
		this.addChild(this.labelInputContainer);
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());

		if (tree.length === 0) {
			setTimeout(() => onCancel(), 100);
		}
	}

	private showLabelInput(entryId: string, currentLabel: string | undefined): void {
		this.labelInput = new LabelInput(entryId, currentLabel);
		this.labelInput.onSubmit = (id, label) => {
			this.treeList.updateNodeLabel(id, label);
			this.onLabelChangeCallback?.(id, label);
			this.hideLabelInput();
		};
		this.labelInput.onCancel = () => this.hideLabelInput();

		// Propagate current focused state to the new labelInput
		this.labelInput.focused = this._focused;

		this.treeContainer.clear();
		this.labelInputContainer.clear();
		this.labelInputContainer.addChild(this.labelInput);
	}

	private hideLabelInput(): void {
		this.labelInput = null;
		this.labelInputContainer.clear();
		this.treeContainer.clear();
		this.treeContainer.addChild(this.treeList);
	}

	handleInput(keyData: string): void {
		if (this.labelInput) {
			this.labelInput.handleInput(keyData);
		} else {
			this.treeList.handleInput(keyData);
		}
	}

	getTreeList(): TreeList {
		return this.treeList;
	}
}
