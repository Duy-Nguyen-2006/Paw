/**
 * Tab key matching (S3776).
 */

const MODIFIERS = { shift: 1 } as const;

const CODEPOINTS = { tab: 9 } as const;

export type TabKeyMatchDeps = {
	matchesKittySequence: (data: string, expectedCodepoint: number, expectedModifier: number) => boolean;
	matchesModifyOtherKeys: (data: string, expectedKeycode: number, expectedModifier: number) => boolean;
};

export function matchTabKey(data: string, modifier: number, deps: TabKeyMatchDeps): boolean {
	if (modifier === MODIFIERS.shift) {
		return (
			data === "\x1b[Z" ||
			deps.matchesKittySequence(data, CODEPOINTS.tab, MODIFIERS.shift) ||
			deps.matchesModifyOtherKeys(data, CODEPOINTS.tab, MODIFIERS.shift)
		);
	}
	if (modifier === 0) {
		return data === "\t" || deps.matchesKittySequence(data, CODEPOINTS.tab, 0);
	}
	return (
		deps.matchesKittySequence(data, CODEPOINTS.tab, modifier) ||
		deps.matchesModifyOtherKeys(data, CODEPOINTS.tab, modifier)
	);
}
