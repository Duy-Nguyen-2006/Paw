import type { Component } from "./tui.ts";

export type OverlayFocusRestorePolicy = "clear" | "preserve";

export type OverlayBlockedFocusResume =
	| { status: "restore-overlay" }
	| { status: "focus-target"; target: Component | null };

/** Minimal overlay fields needed for focus-restore logic (full stack entry may include options, hidden, focusOrder). */
export type OverlayFocusEntry = {
	component: Component;
	preFocus: Component | null;
};

export type EligibleOverlayFocusRestoreState<O extends OverlayFocusEntry = OverlayFocusEntry> = {
	status: "eligible";
	overlay: O;
};
export type BlockedOverlayFocusRestoreState<O extends OverlayFocusEntry = OverlayFocusEntry> = {
	status: "blocked";
	overlay: O;
	blockedBy: Component;
	resume: OverlayBlockedFocusResume;
};
export type ActiveOverlayFocusRestoreState<O extends OverlayFocusEntry = OverlayFocusEntry> =
	| EligibleOverlayFocusRestoreState<O>
	| BlockedOverlayFocusRestoreState<O>;
export type OverlayFocusRestoreState<O extends OverlayFocusEntry = OverlayFocusEntry> =
	| { status: "inactive" }
	| ActiveOverlayFocusRestoreState<O>;

export function resolveNextFocusForNonOverlayTarget<O extends OverlayFocusEntry>({
	nextFocus,
	nextFocusIsOverlay,
	previousFocus,
	previousFocusedOverlay,
	restoreState,
	isOverlayFocusAncestor,
	isComponentMounted,
	resolveBlockedResume,
}: {
	nextFocus: Component | null;
	nextFocusIsOverlay: boolean;
	previousFocus: Component | null;
	previousFocusedOverlay: O | undefined;
	restoreState: OverlayFocusRestoreState<O>;
	isOverlayFocusAncestor: (entry: O, component: Component) => boolean;
	isComponentMounted: (component: Component) => boolean;
	resolveBlockedResume: (state: BlockedOverlayFocusRestoreState<O>) => Component | null;
}): { nextFocus: Component | null; overlayFocusRestore: OverlayFocusRestoreState<O> | "unchanged" } {
	if (!nextFocus || nextFocusIsOverlay) {
		return { nextFocus, overlayFocusRestore: "unchanged" };
	}
	if (restoreState.status === "blocked" && restoreState.blockedBy === previousFocus) {
		if (restoreState.resume.status === "focus-target" || !isComponentMounted(restoreState.blockedBy)) {
			return { nextFocus: resolveBlockedResume(restoreState), overlayFocusRestore: "unchanged" };
		}
		return {
			nextFocus,
			overlayFocusRestore: {
				status: "blocked",
				overlay: restoreState.overlay,
				blockedBy: nextFocus,
				resume: restoreState.resume,
			},
		};
	}
	if (
		previousFocusedOverlay &&
		restoreState.status !== "inactive" &&
		restoreState.overlay === previousFocusedOverlay &&
		!isOverlayFocusAncestor(previousFocusedOverlay, nextFocus)
	) {
		return {
			nextFocus,
			overlayFocusRestore: {
				status: "blocked",
				overlay: previousFocusedOverlay,
				blockedBy: nextFocus,
				resume: { status: "restore-overlay" },
			},
		};
	}
	return { nextFocus, overlayFocusRestore: "unchanged" };
}

export function resolveNextFocusWhenClearing<O extends OverlayFocusEntry>({
	nextFocus,
	previousFocus,
	restoreState,
	overlayFocusRestorePolicy,
	resolveBlockedResume,
}: {
	nextFocus: Component | null;
	previousFocus: Component | null;
	restoreState: OverlayFocusRestoreState<O>;
	overlayFocusRestorePolicy: OverlayFocusRestorePolicy;
	resolveBlockedResume: (state: BlockedOverlayFocusRestoreState<O>) => Component | null;
}): { nextFocus: Component | null; clearRestore: boolean } {
	if (nextFocus !== null) {
		return { nextFocus, clearRestore: false };
	}
	if (restoreState.status === "blocked" && restoreState.blockedBy === previousFocus) {
		return { nextFocus: resolveBlockedResume(restoreState), clearRestore: false };
	}
	return { nextFocus: null, clearRestore: overlayFocusRestorePolicy === "clear" };
}
