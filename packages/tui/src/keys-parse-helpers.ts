/**
 * Key identifier parsing and printable key matching (S3776 helpers).
 */

const MODIFIERS = {
	shift: 1,
	alt: 2,
	ctrl: 4,
	super: 8,
} as const;

const LOCK_MASK = 64 + 128;

export function parseKeyId(
	keyId: string,
): { key: string; ctrl: boolean; shift: boolean; alt: boolean; super: boolean } | null {
	const parts = keyId.toLowerCase().split("+");
	const key = parts[parts.length - 1];
	if (!key) return null;
	return {
		key,
		ctrl: parts.includes("ctrl"),
		shift: parts.includes("shift"),
		alt: parts.includes("alt"),
		super: parts.includes("super"),
	};
}

export function buildModifierBitmask(parsed: {
	ctrl: boolean;
	shift: boolean;
	alt: boolean;
	super: boolean;
}): number {
	let modifier = 0;
	if (parsed.shift) modifier |= MODIFIERS.shift;
	if (parsed.alt) modifier |= MODIFIERS.alt;
	if (parsed.ctrl) modifier |= MODIFIERS.ctrl;
	if (parsed.super) modifier |= MODIFIERS.super;
	return modifier;
}

export function rawCtrlChar(key: string): string | null {
	const char = key.toLowerCase();
	const code = char.codePointAt(0)!;
	if ((code >= 97 && code <= 122) || char === "[" || char === "\\" || char === "]" || char === "_") {
		return String.fromCodePoint(code & 0x1f);
	}
	if (char === "-") {
		return String.fromCodePoint(31);
	}
	return null;
}

export function isDigitKey(key: string): boolean {
	return key >= "0" && key <= "9";
}

export type PrintableKeyMatchDeps = {
	kittyProtocolActive: boolean;
	matchesKittySequence: (data: string, expectedCodepoint: number, expectedModifier: number) => boolean;
	matchesPrintableModifyOtherKeys: (data: string, expectedKeycode: number, expectedModifier: number) => boolean;
};

export function matchPrintableKeyWithModifiers(
	data: string,
	key: string,
	modifier: number,
	deps: PrintableKeyMatchDeps,
): boolean {
	const codepoint = key.codePointAt(0)!;
	const rawCtrl = rawCtrlChar(key);
	const isLetter = key >= "a" && key <= "z";
	const isDigit = isDigitKey(key);

	if (modifier === MODIFIERS.ctrl + MODIFIERS.alt && !deps.kittyProtocolActive && rawCtrl) {
		if (data === `\x1b${rawCtrl}`) return true;
	}

	if (modifier === MODIFIERS.alt && !deps.kittyProtocolActive && (isLetter || isDigit)) {
		if (data === `\x1b${key}`) return true;
	}

	if (modifier === MODIFIERS.ctrl) {
		if (rawCtrl && data === rawCtrl) return true;
		return (
			deps.matchesKittySequence(data, codepoint, MODIFIERS.ctrl) ||
			deps.matchesPrintableModifyOtherKeys(data, codepoint, MODIFIERS.ctrl)
		);
	}

	if (modifier === MODIFIERS.shift + MODIFIERS.ctrl) {
		return (
			deps.matchesKittySequence(data, codepoint, MODIFIERS.shift + MODIFIERS.ctrl) ||
			deps.matchesPrintableModifyOtherKeys(data, codepoint, MODIFIERS.shift + MODIFIERS.ctrl)
		);
	}

	if (modifier === MODIFIERS.shift) {
		if (isLetter && data === key.toUpperCase()) return true;
		return (
			deps.matchesKittySequence(data, codepoint, MODIFIERS.shift) ||
			deps.matchesPrintableModifyOtherKeys(data, codepoint, MODIFIERS.shift)
		);
	}

	if (modifier !== 0) {
		return (
			deps.matchesKittySequence(data, codepoint, modifier) ||
			deps.matchesPrintableModifyOtherKeys(data, codepoint, modifier)
		);
	}

	return data === key || deps.matchesKittySequence(data, codepoint, 0);
}

export { MODIFIERS, LOCK_MASK };
