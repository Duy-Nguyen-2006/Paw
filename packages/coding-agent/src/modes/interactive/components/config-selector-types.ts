/**
 * Shared config-selector types (reduces config-selector.ts complexity).
 */

import type { PathMetadata } from "../../../core/package-manager.ts";

export type ResourceType = "extensions" | "skills" | "prompts" | "themes";

export interface ResourceItem {
	path: string;
	enabled: boolean;
	metadata: PathMetadata;
	resourceType: ResourceType;
	displayName: string;
	groupKey: string;
	subgroupKey: string;
}

export interface ResourceSubgroup {
	type: ResourceType;
	label: string;
	items: ResourceItem[];
}

export interface ResourceGroup {
	key: string;
	label: string;
	scope: "user" | "project" | "temporary";
	origin: "package" | "top-level";
	source: string;
	subgroups: ResourceSubgroup[];
}

export type FlatEntry =
	| { type: "group"; group: ResourceGroup }
	| { type: "subgroup"; subgroup: ResourceSubgroup; group: ResourceGroup }
	| { type: "item"; item: ResourceItem };
