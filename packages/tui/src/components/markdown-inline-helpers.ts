import type { Token } from "marked";
import type { InlineStyleContext } from "./markdown-render-helpers.ts";
import type { MarkdownTheme } from "./markdown.ts";

export type RenderInlineTokensFn = (tokens: Token[], styleContext?: InlineStyleContext) => string;

export function renderSingleInlineToken(
	token: Token,
	resolvedStyleContext: InlineStyleContext,
	theme: MarkdownTheme,
	renderInlineTokens: RenderInlineTokensFn,
): string {
	const { applyText, stylePrefix } = resolvedStyleContext;
	const applyTextWithNewlines = (text: string): string => {
		const segments: string[] = text.split("\n");
		return segments.map((segment: string) => applyText(segment)).join("\n");
	};

	switch (token.type) {
		case "text":
			if (token.tokens && token.tokens.length > 0) {
				return renderInlineTokens(token.tokens, resolvedStyleContext);
			}
			return applyTextWithNewlines(token.text);

		case "paragraph":
			return renderInlineTokens(token.tokens || [], resolvedStyleContext);

		case "strong": {
			const boldContent = renderInlineTokens(token.tokens || [], resolvedStyleContext);
			return theme.bold(boldContent) + stylePrefix;
		}

		case "em": {
			const italicContent = renderInlineTokens(token.tokens || [], resolvedStyleContext);
			return theme.italic(italicContent) + stylePrefix;
		}

		case "codespan":
			return theme.code(token.text) + stylePrefix;

		case "br":
			return "\n";

		case "del": {
			const delContent = renderInlineTokens(token.tokens || [], resolvedStyleContext);
			return theme.strikethrough(delContent) + stylePrefix;
		}

		case "html":
			if ("raw" in token && typeof token.raw === "string") {
				return applyTextWithNewlines(token.raw);
			}
			return "";

		default:
			if ("text" in token && typeof token.text === "string") {
				return applyTextWithNewlines(token.text);
			}
			return "";
	}
}

export function stripTrailingStylePrefixes(result: string, stylePrefix: string): string {
	let trimmed = result;
	while (stylePrefix && trimmed.endsWith(stylePrefix)) {
		trimmed = trimmed.slice(0, -stylePrefix.length);
	}
	return trimmed;
}
