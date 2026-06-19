/**
 * Config selector filter helpers (reduces ResourceList.filterItems S3776).
 */

import type { ResourceGroup, ResourceItem, ResourceSubgroup } from "./config-selector-types.ts";

export interface ConfigFilterSets {
	matchingItems: Set<ResourceItem>;
	matchingSubgroups: Set<ResourceSubgroup>;
	matchingGroups: Set<ResourceGroup>;
}

/** Lowercase + trim a query for case-insensitive comparison. */
export function normalizeConfigQuery(query: string): string {
	return query.toLowerCase().trim();
}

/** Return true when an item matches the lowercased query across any searchable field. */
export function resourceItemMatches(item: ResourceItem, lowerQuery: string): boolean {
	return (
		item.displayName.toLowerCase().includes(lowerQuery) ||
		item.resourceType.toLowerCase().includes(lowerQuery) ||
		item.path.toLowerCase().includes(lowerQuery)
	);
}

/** Collect the items in the flat list whose fields contain the lowercased query. */
export function collectMatchingConfigItems(
	flatItems: ReadonlyArray<{ type: string; item?: ResourceItem }>,
	lowerQuery: string,
): Set<ResourceItem> {
	const matching = new Set<ResourceItem>();
	for (const entry of flatItems) {
		if (entry.type === "item" && entry.item && resourceItemMatches(entry.item, lowerQuery)) {
			matching.add(entry.item);
		}
	}
	return matching;
}

/** Walk groups/subgroups to find ancestors that contain at least one matching item. */
export function collectContainingConfigAncestors(
	groups: ReadonlyArray<ResourceGroup>,
	matchingItems: Set<ResourceItem>,
): { matchingSubgroups: Set<ResourceSubgroup>; matchingGroups: Set<ResourceGroup> } {
	const matchingSubgroups = new Set<ResourceSubgroup>();
	const matchingGroups = new Set<ResourceGroup>();
	for (const group of groups) {
		for (const subgroup of group.subgroups) {
			for (const item of subgroup.items) {
				if (matchingItems.has(item)) {
					matchingSubgroups.add(subgroup);
					matchingGroups.add(group);
				}
			}
		}
	}
	return { matchingSubgroups, matchingGroups };
}
