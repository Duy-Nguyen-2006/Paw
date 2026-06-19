import type { Token, Tokens } from "marked";
import {
	appendSpacingAfterBlock,
	buildHeadingStyleFn,
	renderBlockquoteLines,
	renderCodeBlockLines,
	shouldAddBlockSpacing,
	type InlineStyleContext,
} from "./markdown-render-helpers.ts";
import type { MarkdownTheme } from "./markdown.ts";
import type { RenderTokenFn } from "./markdown-render-helpers.ts";

export function renderBlockToken(
	token: Token,
	width: number,
	nextTokenType: string | undefined,
	styleContext: InlineStyleContext | undefined,
	theme: MarkdownTheme,
	getStylePrefix: (styleFn: (text: string) => string) => string,
	renderToken: RenderTokenFn,
	renderInlineTokens: (tokens: Token[], styleContext?: InlineStyleContext) => string,
	applyDefaultStyle: (text: string) => string,
): string[] {
	const lines: string[] = [];

	switch (token.type) {
		case "heading": {
			const headingLevel = token.depth;
			const headingPrefix = `${"#".repeat(headingLevel)} `;
			const headingStyleFn = buildHeadingStyleFn(headingLevel, theme);
			const headingStyleContext: InlineStyleContext = {
				applyText: headingStyleFn,
				stylePrefix: getStylePrefix(headingStyleFn),
			};
			const headingText = renderInlineTokens(token.tokens || [], headingStyleContext);
			const styledHeading = headingLevel >= 3 ? headingStyleFn(headingPrefix) + headingText : headingText;
			lines.push(styledHeading);
			appendSpacingAfterBlock(lines, nextTokenType);
			break;
		}

		case "paragraph": {
			const paragraphText = renderInlineTokens(token.tokens || [], styleContext);
			lines.push(paragraphText);
			if (shouldAddBlockSpacing(nextTokenType, ["list", "space"])) {
				lines.push("");
			}
			break;
		}

		case "text":
			lines.push(renderInlineTokens([token], styleContext));
			break;

		case "code": {
			lines.push(...renderCodeBlockLines(token as Tokens.Code, theme));
			appendSpacingAfterBlock(lines, nextTokenType);
			break;
		}

		case "hr":
			lines.push(theme.hr("─".repeat(Math.min(width, 80))));
			appendSpacingAfterBlock(lines, nextTokenType);
			break;

		case "html":
			if ("raw" in token && typeof token.raw === "string") {
				lines.push(applyDefaultStyle(token.raw.trim()));
			}
			break;

		case "space":
			lines.push("");
			break;

		case "blockquote":
			lines.push(
				...renderBlockquoteLines(
					token as Tokens.Blockquote,
					width,
					nextTokenType,
					theme,
					getStylePrefix,
					renderToken,
				),
			);
			break;

		default:
			if ("text" in token && typeof token.text === "string") {
				lines.push(token.text);
			}
	}

	return lines;
}
