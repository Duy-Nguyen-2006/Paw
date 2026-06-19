/**
 * Session scope loading (reduces SessionSelectorComponent.loadScope S3776).
 */

import type { SessionInfo, SessionListProgress } from "../../../core/session-manager.ts";

import type { SessionScope } from "./session-selector-types.ts";

export type SessionsLoader = (onProgress?: SessionListProgress) => Promise<SessionInfo[]>;

export type LoadScopeReason = "initial" | "refresh" | "toggle";

/** Stale-check helpers for a loadScope invocation. */
export interface StalenessCheck {
	isStaleScope: () => boolean;
	isStaleSeq: () => boolean;
}

/**
 * Snapshot the loadSeq for the "all" scope and build staleness helpers.
 * `expectedScope` is the scope this load was started for; the current scope
 * is queried via the supplied getter so we can detect a switch mid-load.
 */
export function createAllScopeStaleness(
	expectedScope: SessionScope,
	getCurrentScope: () => SessionScope,
	getCurrentSeq: () => number,
	advanceSeq: () => number,
): { nextSeq: number; check: StalenessCheck } {
	const nextSeq = advanceSeq();
	return {
		nextSeq,
		check: {
			isStaleScope: () => expectedScope !== getCurrentScope(),
			isStaleSeq: () => nextSeq !== getCurrentSeq(),
		},
	};
}

/** Build a progress callback that no-ops when the load becomes stale. */
export function buildProgressCallback(
	check: StalenessCheck,
	onProgress: (loaded: number, total: number) => void,
): (loaded: number, total: number) => void {
	return (loaded, total) => {
		if (check.isStaleScope() || check.isStaleSeq()) return;
		onProgress(loaded, total);
	};
}

/** Pick the right loader for a scope. */
export function selectScopeLoader(
	scope: SessionScope,
	currentLoader: SessionsLoader,
	allLoader: SessionsLoader,
): SessionsLoader {
	return scope === "current" ? currentLoader : allLoader;
}
