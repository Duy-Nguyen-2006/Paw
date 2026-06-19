import { isImageLine } from "../terminal-image.ts";
import { applyBackgroundToLine, visibleWidth, wrapTextWithAnsi } from "../utils.ts";
import type { DefaultTextStyle } from "./markdown.ts";

export function wrapRenderedContentLines(renderedLines: string[], contentWidth: number): string[] {
	const wrappedLines: string[] = [];
	for (const line of renderedLines) {
		if (isImageLine(line)) {
			wrappedLines.push(line);
		} else {
			for (const wrappedLine of wrapTextWithAnsi(line, contentWidth)) {
				wrappedLines.push(wrappedLine);
			}
		}
	}
	return wrappedLines;
}

export function applyHorizontalPaddingAndBackground(
	wrappedLines: string[],
	width: number,
	paddingX: number,
	defaultTextStyle: DefaultTextStyle | undefined,
): string[] {
	const leftMargin = " ".repeat(paddingX);
	const rightMargin = " ".repeat(paddingX);
	const bgFn = defaultTextStyle?.bgColor;
	const contentLines: string[] = [];

	for (const line of wrappedLines) {
		if (isImageLine(line)) {
			contentLines.push(line);
			continue;
		}

		const lineWithMargins = leftMargin + line + rightMargin;

		if (bgFn) {
			contentLines.push(applyBackgroundToLine(lineWithMargins, width, bgFn));
		} else {
			const visibleLen = visibleWidth(lineWithMargins);
			const paddingNeeded = Math.max(0, width - visibleLen);
			contentLines.push(lineWithMargins + " ".repeat(paddingNeeded));
		}
	}
	return contentLines;
}

export function buildVerticalPaddingLines(
	width: number,
	paddingY: number,
	defaultTextStyle: DefaultTextStyle | undefined,
): string[] {
	const emptyLine = " ".repeat(width);
	const bgFn = defaultTextStyle?.bgColor;
	const emptyLines: string[] = [];
	for (let i = 0; i < paddingY; i++) {
		const line = bgFn ? applyBackgroundToLine(emptyLine, width, bgFn) : emptyLine;
		emptyLines.push(line);
	}
	return emptyLines;
}
