import type { DefaultTextStyle, MarkdownTheme } from "./markdown.ts";

export function applyDefaultTextStyle(
	text: string,
	defaultTextStyle: DefaultTextStyle | undefined,
	theme: MarkdownTheme,
): string {
	if (!defaultTextStyle) {
		return text;
	}

	let styled = text;

	if (defaultTextStyle.color) {
		styled = defaultTextStyle.color(styled);
	}
	if (defaultTextStyle.bold) {
		styled = theme.bold(styled);
	}
	if (defaultTextStyle.italic) {
		styled = theme.italic(styled);
	}
	if (defaultTextStyle.strikethrough) {
		styled = theme.strikethrough(styled);
	}
	if (defaultTextStyle.underline) {
		styled = theme.underline(styled);
	}

	return styled;
}

export function computeDefaultStylePrefix(
	defaultTextStyle: DefaultTextStyle | undefined,
	theme: MarkdownTheme,
	cachedPrefix: string | undefined,
): { prefix: string; cache: string } {
	if (!defaultTextStyle) {
		return { prefix: "", cache: "" };
	}
	if (cachedPrefix !== undefined) {
		return { prefix: cachedPrefix, cache: cachedPrefix };
	}

	const sentinel = "\u0000";
	let styled = sentinel;

	if (defaultTextStyle.color) {
		styled = defaultTextStyle.color(styled);
	}
	if (defaultTextStyle.bold) {
		styled = theme.bold(styled);
	}
	if (defaultTextStyle.italic) {
		styled = theme.italic(styled);
	}
	if (defaultTextStyle.strikethrough) {
		styled = theme.strikethrough(styled);
	}
	if (defaultTextStyle.underline) {
		styled = theme.underline(styled);
	}

	const sentinelIndex = styled.indexOf(sentinel);
	const prefix = sentinelIndex >= 0 ? styled.slice(0, sentinelIndex) : "";
	return { prefix, cache: prefix };
}

export function getStylePrefixFromFn(styleFn: (text: string) => string): string {
	const sentinel = "\u0000";
	const styled = styleFn(sentinel);
	const sentinelIndex = styled.indexOf(sentinel);
	return sentinelIndex >= 0 ? styled.slice(0, sentinelIndex) : "";
}
