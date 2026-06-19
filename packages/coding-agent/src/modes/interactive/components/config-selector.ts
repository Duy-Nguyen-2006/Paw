/**
 * TUI component for managing package resources (enable/disable)
 */

import { homedir } from "node:os";
import { basename, dirname } from "node:path";
import {
	type Component,
	Container,
	type Focusable,
	Input,
	Spacer,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { ResolvedPaths, ResolvedResource } from "../../../core/package-manager.ts";
import type { SettingsManager } from "../../../core/settings-manager.ts";
import { theme } from "../theme/theme.ts";
import {
	dispatchConfigSelectorKey,
	findNextItemIndex,
	findPrevItemIndex,
	pageDownToItem,
	pageUpToItem,
} from "./config-selector-input.ts";
import {
	collectContainingConfigAncestors,
	collectMatchingConfigItems,
	normalizeConfigQuery,
} from "./config-selector-search.ts";
import { toggleConfigResource } from "./config-selector-toggle.ts";
import type {
	FlatEntry,
	ResourceGroup,
	ResourceItem,
	ResourceSubgroup,
	ResourceType,
} from "./config-selector-types.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { rawKeyHint } from "./keybinding-hints.ts";

export type { FlatEntry, ResourceGroup, ResourceItem, ResourceSubgroup, ResourceType };

const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
	extensions: "Extensions",
	skills: "Skills",
	prompts: "Prompts",
	themes: "Themes",
};

function formatBaseDir(baseDir: string): string {
	const homeDir = homedir();
	let displayPath: string;

	if (baseDir === homeDir) {
		displayPath = "~";
	} else if (baseDir.startsWith(homeDir)) {
		// Replace home prefix with ~, normalize separators for display
		const rest = baseDir.slice(homeDir.length);
		displayPath = `~${rest.replaceAll("\\", "/")}`;
	} else {
		displayPath = baseDir.replaceAll("\\", "/");
	}

	return displayPath.endsWith("/") ? displayPath : `${displayPath}/`;
}

function getGroupLabel(metadata: ResolvedResource["metadata"]): string {
	if (metadata.origin === "package") {
		return `${metadata.source} (${metadata.scope})`;
	}
	// Top-level resources
	if (metadata.source === "auto") {
		if (metadata.baseDir) {
			return metadata.scope === "user"
				? `User (${formatBaseDir(metadata.baseDir)})`
				: `Project (${formatBaseDir(metadata.baseDir)})`;
		}
		return metadata.scope === "user" ? "User (~/.pi/agent/)" : "Project (.pi/)";
	}
	return metadata.scope === "user" ? "User settings" : "Project settings";
}

function buildItemDisplayName(path: string, resourceType: ResourceType): string {
	const fileName = basename(path);
	const parentFolder = basename(dirname(path));
	if (resourceType === "extensions" && parentFolder !== "extensions") {
		return `${parentFolder}/${fileName}`;
	}
	if (resourceType === "skills" && fileName === "SKILL.md") {
		return parentFolder;
	}
	return fileName;
}

function addToGroup(
	groupMap: Map<string, ResourceGroup>,
	resources: ResolvedResource[],
	resourceType: ResourceType,
): void {
	for (const res of resources) {
		const { path, enabled, metadata } = res;
		const groupKey = `${metadata.origin}:${metadata.scope}:${metadata.source}:${metadata.baseDir ?? ""}`;

		let group = groupMap.get(groupKey);
		if (!group) {
			group = {
				key: groupKey,
				label: getGroupLabel(metadata),
				scope: metadata.scope,
				origin: metadata.origin,
				source: metadata.source,
				subgroups: [],
			};
			groupMap.set(groupKey, group);
		}

		let subgroup = group.subgroups.find((sg) => sg.type === resourceType);
		if (!subgroup) {
			subgroup = {
				type: resourceType,
				label: RESOURCE_TYPE_LABELS[resourceType],
				items: [],
			};
			group.subgroups.push(subgroup);
		}

		subgroup.items.push({
			path,
			enabled,
			metadata,
			resourceType,
			displayName: buildItemDisplayName(path, resourceType),
			groupKey,
			subgroupKey: `${groupKey}:${resourceType}`,
		});
	}
}

/** Sort groups: packages first, then top-level; user before project; then by source. */
function sortResourceGroups(groups: ResourceGroup[]): ResourceGroup[] {
	groups.sort((a, b) => {
		if (a.origin !== b.origin) {
			return a.origin === "package" ? -1 : 1;
		}
		if (a.scope !== b.scope) {
			return a.scope === "user" ? -1 : 1;
		}
		return a.source.localeCompare(b.source);
	});
	return groups;
}

/** Sort subgroups and items inside each group using deterministic order. */
function sortResourceGroupContents(groups: ResourceGroup[]): void {
	const typeOrder: Record<ResourceType, number> = { extensions: 0, skills: 1, prompts: 2, themes: 3 };
	for (const group of groups) {
		group.subgroups.sort((a, b) => typeOrder[a.type] - typeOrder[b.type]);
		for (const subgroup of group.subgroups) {
			subgroup.items.sort((a, b) => a.displayName.localeCompare(b.displayName));
		}
	}
}

function buildGroups(resolved: ResolvedPaths): ResourceGroup[] {
	const groupMap = new Map<string, ResourceGroup>();
	addToGroup(groupMap, resolved.extensions, "extensions");
	addToGroup(groupMap, resolved.skills, "skills");
	addToGroup(groupMap, resolved.prompts, "prompts");
	addToGroup(groupMap, resolved.themes, "themes");

	const groups = sortResourceGroups(Array.from(groupMap.values()));
	sortResourceGroupContents(groups);
	return groups;
}

class ConfigSelectorHeader implements Component {
	invalidate(): void {
		// No-op: header state is immutable
	}

	render(width: number): string[] {
		const title = theme.bold("Resource Configuration");
		const sep = theme.fg("muted", " · ");
		const hint = rawKeyHint("space", "toggle") + sep + rawKeyHint("esc", "close");
		const hintWidth = visibleWidth(hint);
		const titleWidth = visibleWidth(title);
		const spacing = Math.max(1, width - titleWidth - hintWidth);

		return [
			truncateToWidth(`${title}${" ".repeat(spacing)}${hint}`, width, ""),
			theme.fg("muted", "Type to filter resources"),
		];
	}
}

class ResourceList implements Component, Focusable {
	private groups: ResourceGroup[];
	private flatItems: FlatEntry[] = [];
	private filteredItems: FlatEntry[] = [];
	private selectedIndex = 0;
	private searchInput: Input;
	private maxVisible: number;
	private settingsManager: SettingsManager;
	private cwd: string;
	private agentDir: string;

	public onCancel?: () => void;
	public onExit?: () => void;
	public onToggle?: (item: ResourceItem, newEnabled: boolean) => void;

	private _focused = false;
	get focused(): boolean {
		return this._focused;
	}
	set focused(value: boolean) {
		this._focused = value;
		this.searchInput.focused = value;
	}

	constructor(
		groups: ResourceGroup[],
		settingsManager: SettingsManager,
		cwd: string,
		agentDir: string,
		terminalHeight?: number,
	) {
		this.groups = groups;
		this.settingsManager = settingsManager;
		this.cwd = cwd;
		this.agentDir = agentDir;
		this.searchInput = new Input();
		// 8 lines of chrome: top spacer + top border + spacer + header (2 lines) + spacer + bottom spacer + bottom border
		const chrome = 8;
		this.maxVisible = Math.max(5, (terminalHeight ?? 24) - chrome);
		this.buildFlatList();
		this.filteredItems = [...this.flatItems];
	}

	private buildFlatList(): void {
		this.flatItems = [];
		for (const group of this.groups) {
			this.flatItems.push({ type: "group", group });
			for (const subgroup of group.subgroups) {
				this.flatItems.push({ type: "subgroup", subgroup, group });
				for (const item of subgroup.items) {
					this.flatItems.push({ type: "item", item });
				}
			}
		}
		// Start selection on first item (not header)
		this.selectedIndex = this.flatItems.findIndex((e) => e.type === "item");
		if (this.selectedIndex < 0) this.selectedIndex = 0;
	}

	private findNextItem(fromIndex: number, direction: 1 | -1): number {
		const search = direction === 1 ? findNextItemIndex : findPrevItemIndex;
		const start = fromIndex + direction;
		return search(this.filteredItems, start);
	}

	private filterItems(query: string): void {
		const normalized = normalizeConfigQuery(query);
		if (!normalized) {
			this.filteredItems = [...this.flatItems];
			this.selectFirstItem();
			return;
		}

		const matchingItems = collectMatchingConfigItems(this.flatItems, normalized);
		const ancestors = collectContainingConfigAncestors(this.groups, matchingItems);

		this.filteredItems = this.flatItems.filter((entry) => {
			if (entry.type === "group") return ancestors.matchingGroups.has(entry.group);
			if (entry.type === "subgroup") return ancestors.matchingSubgroups.has(entry.subgroup);
			return matchingItems.has(entry.item);
		});

		this.selectFirstItem();
	}

	private selectFirstItem(): void {
		const firstItemIndex = this.filteredItems.findIndex((e) => e.type === "item");
		this.selectedIndex = firstItemIndex >= 0 ? firstItemIndex : 0;
	}

	updateItem(item: ResourceItem, enabled: boolean): void {
		item.enabled = enabled;
		// Update in groups too
		for (const group of this.groups) {
			for (const subgroup of group.subgroups) {
				const found = subgroup.items.find((i) => i.path === item.path && i.resourceType === item.resourceType);
				if (found) {
					found.enabled = enabled;
					return;
				}
			}
		}
	}

	invalidate(): void {
		// No-op: component state is managed directly
	}

	render(width: number): string[] {
		const lines: string[] = [];

		// Search input
		lines.push(...this.searchInput.render(width), "");

		if (this.filteredItems.length === 0) {
			lines.push(theme.fg("muted", "  No resources found"));
			return lines;
		}

		// Calculate visible range
		const startIndex = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(this.maxVisible / 2), this.filteredItems.length - this.maxVisible),
		);
		const endIndex = Math.min(startIndex + this.maxVisible, this.filteredItems.length);

		for (let i = startIndex; i < endIndex; i++) {
			lines.push(this.renderFilteredEntry(i, width));
		}

		// Scroll indicator
		if (startIndex > 0 || endIndex < this.filteredItems.length) {
			lines.push(this.renderScrollIndicator());
		}

		return lines;
	}

	private renderFilteredEntry(index: number, width: number): string {
		const entry = this.filteredItems[index];
		const isSelected = index === this.selectedIndex;

		if (entry.type === "group") {
			const groupLine = theme.fg("accent", theme.bold(entry.group.label));
			return truncateToWidth(`  ${groupLine}`, width, "");
		}
		if (entry.type === "subgroup") {
			const subgroupLine = theme.fg("muted", entry.subgroup.label);
			return truncateToWidth(`    ${subgroupLine}`, width, "");
		}

		const item = entry.item;
		const cursor = isSelected ? "> " : "  ";
		const checkbox = item.enabled ? theme.fg("success", "[x]") : theme.fg("dim", "[ ]");
		const name = isSelected ? theme.bold(item.displayName) : item.displayName;
		return truncateToWidth(`${cursor}    ${checkbox} ${name}`, width, "...");
	}

	private renderScrollIndicator(): string {
		const itemCount = this.filteredItems.filter((e) => e.type === "item").length;
		const currentItemIndex =
			this.filteredItems.slice(0, this.selectedIndex).filter((e) => e.type === "item").length + 1;
		return theme.fg("dim", `  (${currentItemIndex}/${itemCount})`);
	}

	handleInput(data: string): void {
		const action = dispatchConfigSelectorKey(data, {
			selectedIndex: this.selectedIndex,
			maxVisible: this.maxVisible,
			filteredCount: this.filteredItems.length,
		});

		switch (action.type) {
			case "select-prev": {
				const next = this.findNextItem(this.selectedIndex, -1);
				if (next >= 0) this.selectedIndex = next;
				return;
			}
			case "select-next": {
				const next = this.findNextItem(this.selectedIndex, 1);
				if (next >= 0) this.selectedIndex = next;
				return;
			}
			case "page-up": {
				const target = pageUpToItem(this.filteredItems, action.target);
				if (target >= 0) this.selectedIndex = target;
				return;
			}
			case "page-down": {
				const target = pageDownToItem(this.filteredItems, action.target);
				if (target >= 0) this.selectedIndex = target;
				return;
			}
			case "cancel":
				this.onCancel?.();
				return;
			case "exit":
				this.onExit?.();
				return;
			case "toggle-current": {
				const entry = this.filteredItems[this.selectedIndex];
				if (entry?.type === "item") {
					const newEnabled = !entry.item.enabled;
					this.toggleResource(entry.item, newEnabled);
					this.updateItem(entry.item, newEnabled);
					this.onToggle?.(entry.item, newEnabled);
				}
				return;
			}
			case "forward-to-search": {
				this.searchInput.handleInput(data);
				this.filterItems(this.searchInput.getValue());
				return;
			}
			default:
				return;
		}
	}

	private toggleResource(item: ResourceItem, enabled: boolean): void {
		toggleConfigResource(this.settingsManager, item, enabled, this.cwd, this.agentDir);
	}
}

export class ConfigSelectorComponent extends Container implements Focusable {
	private resourceList: ResourceList;

	private _focused = false;
	get focused(): boolean {
		return this._focused;
	}
	set focused(value: boolean) {
		this._focused = value;
		this.resourceList.focused = value;
	}

	constructor(
		resolvedPaths: ResolvedPaths,
		settingsManager: SettingsManager,
		cwd: string,
		agentDir: string,
		onClose: () => void,
		onExit: () => void,
		requestRender: () => void,
		terminalHeight?: number,
	) {
		super();

		const groups = buildGroups(resolvedPaths);

		// Add header
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new ConfigSelectorHeader());
		this.addChild(new Spacer(1));

		// Resource list
		this.resourceList = new ResourceList(groups, settingsManager, cwd, agentDir, terminalHeight);
		this.resourceList.onCancel = onClose;
		this.resourceList.onExit = onExit;
		this.resourceList.onToggle = () => requestRender();
		this.addChild(this.resourceList);

		// Bottom border
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());
	}

	getResourceList(): ResourceList {
		return this.resourceList;
	}
}
