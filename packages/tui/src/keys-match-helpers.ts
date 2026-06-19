/**
 * Key matching helpers extracted from matchesKey() to reduce cognitive complexity (S3776).
 */

const MODIFIERS = {
	shift: 1,
	alt: 2,
	ctrl: 4,
	super: 8,
} as const;

const CODEPOINTS = {
	escape: 27,
	tab: 9,
	enter: 13,
	space: 32,
	backspace: 127,
	kpEnter: 57414,
} as const;

const ARROW_CODEPOINTS = {
	up: -1,
	down: -2,
	right: -3,
	left: -4,
} as const;

const FUNCTIONAL_CODEPOINTS = {
	delete: -10,
	insert: -11,
	pageUp: -12,
	pageDown: -13,
	home: -14,
	end: -15,
} as const;

type LegacyModifierKey = "up" | "down" | "left" | "right" | "clear" | "insert" | "delete" | "pageUp" | "pageDown" | "home" | "end";

export type KeyMatchDeps = {
	kittyProtocolActive: boolean;
	matchesKittySequence: (data: string, expectedCodepoint: number, expectedModifier: number) => boolean;
	matchesModifyOtherKeys: (data: string, expectedKeycode: number, expectedModifier: number) => boolean;
	matchesLegacySequence: (data: string, sequences: readonly string[]) => boolean;
	matchesLegacyModifierSequence: (data: string, key: LegacyModifierKey, modifier: number) => boolean;
	matchesRawBackspace: (data: string, expectedModifier: number) => boolean;
	legacyKeySequences: {
		insert: readonly string[];
		delete: readonly string[];
		clear: readonly string[];
		home: readonly string[];
		end: readonly string[];
		pageUp: readonly string[];
		pageDown: readonly string[];
		up: readonly string[];
		down: readonly string[];
		left: readonly string[];
		right: readonly string[];
	};
};

export function matchEscapeKey(data: string, modifier: number, deps: KeyMatchDeps): boolean {
	if (modifier !== 0) return false;
	return (
		data === "\x1b" ||
		deps.matchesKittySequence(data, CODEPOINTS.escape, 0) ||
		deps.matchesModifyOtherKeys(data, CODEPOINTS.escape, 0)
	);
}

export function matchSpaceKey(data: string, modifier: number, deps: KeyMatchDeps): boolean {
	if (!deps.kittyProtocolActive) {
		if (modifier === MODIFIERS.ctrl && data === "\x00") return true;
		if (modifier === MODIFIERS.alt && data === "\x1b ") return true;
	}
	if (modifier === 0) {
		return (
			data === " " ||
			deps.matchesKittySequence(data, CODEPOINTS.space, 0) ||
			deps.matchesModifyOtherKeys(data, CODEPOINTS.space, 0)
		);
	}
	return (
		deps.matchesKittySequence(data, CODEPOINTS.space, modifier) ||
		deps.matchesModifyOtherKeys(data, CODEPOINTS.space, modifier)
	);
}

export function matchEnterKey(data: string, modifier: number, deps: KeyMatchDeps): boolean {
	if (modifier === MODIFIERS.shift) {
		if (
			deps.matchesKittySequence(data, CODEPOINTS.enter, MODIFIERS.shift) ||
			deps.matchesKittySequence(data, CODEPOINTS.kpEnter, MODIFIERS.shift)
		) {
			return true;
		}
		if (deps.matchesModifyOtherKeys(data, CODEPOINTS.enter, MODIFIERS.shift)) return true;
		if (deps.kittyProtocolActive) return data === "\x1b\r" || data === "\n";
		return false;
	}
	if (modifier === MODIFIERS.alt) {
		if (
			deps.matchesKittySequence(data, CODEPOINTS.enter, MODIFIERS.alt) ||
			deps.matchesKittySequence(data, CODEPOINTS.kpEnter, MODIFIERS.alt)
		) {
			return true;
		}
		if (deps.matchesModifyOtherKeys(data, CODEPOINTS.enter, MODIFIERS.alt)) return true;
		if (!deps.kittyProtocolActive) return data === "\x1b\r";
		return false;
	}
	if (modifier === 0) {
		return (
			data === "\r" ||
			(!deps.kittyProtocolActive && data === "\n") ||
			data === "\x1bOM" ||
			deps.matchesKittySequence(data, CODEPOINTS.enter, 0) ||
			deps.matchesKittySequence(data, CODEPOINTS.kpEnter, 0)
		);
	}
	return (
		deps.matchesKittySequence(data, CODEPOINTS.enter, modifier) ||
		deps.matchesKittySequence(data, CODEPOINTS.kpEnter, modifier) ||
		deps.matchesModifyOtherKeys(data, CODEPOINTS.enter, modifier)
	);
}

export function matchBackspaceKey(data: string, modifier: number, deps: KeyMatchDeps): boolean {
	if (modifier === MODIFIERS.alt) {
		if (data === "\x1b\x7f" || data === "\x1b\b") return true;
		return (
			deps.matchesKittySequence(data, CODEPOINTS.backspace, MODIFIERS.alt) ||
			deps.matchesModifyOtherKeys(data, CODEPOINTS.backspace, MODIFIERS.alt)
		);
	}
	if (modifier === MODIFIERS.ctrl) {
		if (deps.matchesRawBackspace(data, MODIFIERS.ctrl)) return true;
		return (
			deps.matchesKittySequence(data, CODEPOINTS.backspace, MODIFIERS.ctrl) ||
			deps.matchesModifyOtherKeys(data, CODEPOINTS.backspace, MODIFIERS.ctrl)
		);
	}
	if (modifier === 0) {
		return (
			deps.matchesRawBackspace(data, 0) ||
			deps.matchesKittySequence(data, CODEPOINTS.backspace, 0) ||
			deps.matchesModifyOtherKeys(data, CODEPOINTS.backspace, 0)
		);
	}
	return (
		deps.matchesKittySequence(data, CODEPOINTS.backspace, modifier) ||
		deps.matchesModifyOtherKeys(data, CODEPOINTS.backspace, modifier)
	);
}

export function matchFunctionalLegacyKey(
	data: string,
	modifier: number,
	functionalCodepoint: number,
	legacyKey: LegacyModifierKey,
	deps: KeyMatchDeps,
): boolean {
	if (modifier === 0) {
		return (
			deps.matchesLegacySequence(data, deps.legacyKeySequences[legacyKey]) ||
			deps.matchesKittySequence(data, functionalCodepoint, 0)
		);
	}
	if (deps.matchesLegacyModifierSequence(data, legacyKey, modifier)) return true;
	return deps.matchesKittySequence(data, functionalCodepoint, modifier);
}

export function matchArrowKey(
	data: string,
	modifier: number,
	direction: "up" | "down" | "left" | "right",
	deps: KeyMatchDeps,
	legacyAltData?: string,
	legacyCtrlData?: string,
): boolean {
	const arrowCp = ARROW_CODEPOINTS[direction];
	const legacyKey = direction;
	if (modifier === MODIFIERS.alt) {
		if (legacyAltData && data === legacyAltData) return true;
		return deps.matchesKittySequence(data, arrowCp, MODIFIERS.alt);
	}
	if (modifier === MODIFIERS.ctrl && legacyCtrlData) {
		if (data === legacyCtrlData) return true;
		if (deps.matchesLegacyModifierSequence(data, legacyKey, MODIFIERS.ctrl)) return true;
		return deps.matchesKittySequence(data, arrowCp, MODIFIERS.ctrl);
	}
	if (modifier === 0) {
		return (
			deps.matchesLegacySequence(data, deps.legacyKeySequences[legacyKey]) ||
			deps.matchesKittySequence(data, arrowCp, 0)
		);
	}
	if (deps.matchesLegacyModifierSequence(data, legacyKey, modifier)) return true;
	return deps.matchesKittySequence(data, arrowCp, modifier);
}

export function matchLeftArrowKey(data: string, modifier: number, deps: KeyMatchDeps): boolean {
	if (modifier === MODIFIERS.alt) {
		return (
			data === "\x1b[1;3D" ||
			(!deps.kittyProtocolActive && data === "\x1bB") ||
			data === "\x1bb" ||
			deps.matchesKittySequence(data, ARROW_CODEPOINTS.left, MODIFIERS.alt)
		);
	}
	return matchArrowKey(data, modifier, "left", deps, undefined, "\x1b[1;5D");
}

export function matchRightArrowKey(data: string, modifier: number, deps: KeyMatchDeps): boolean {
	if (modifier === MODIFIERS.alt) {
		return (
			data === "\x1b[1;3C" ||
			(!deps.kittyProtocolActive && data === "\x1bF") ||
			data === "\x1bf" ||
			deps.matchesKittySequence(data, ARROW_CODEPOINTS.right, MODIFIERS.alt)
		);
	}
	return matchArrowKey(data, modifier, "right", deps, undefined, "\x1b[1;5C");
}

export { FUNCTIONAL_CODEPOINTS };
