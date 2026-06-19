/**
 * Shared model-selector types (reduces ModelSelectorComponent.ts complexity).
 */

import type { Model } from "@earendil-works/pi-ai";

// Use `any` to align with ModelSelectorComponent's existing Model<any> usage.
// The Model<TApi> generic requires TApi extends Api, so unknown/never are not
// valid substitutions; any is the same wildcard the class already uses.
export interface ModelItem {
	provider: string;
	id: string;
	model: Model<any>;
}

export interface ScopedModelItem {
	model: Model<any>;
	thinkingLevel?: string;
}

export type ModelScope = "all" | "scoped";
