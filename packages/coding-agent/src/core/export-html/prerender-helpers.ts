/**
 * Custom tool pre-render for HTML export (extracted from export-html/index.ts for S3776).
 */

import type { SessionEntry } from "../session-manager.ts";

export interface ToolHtmlRenderer {
	renderCall(toolCallId: string, toolName: string, args: unknown): string | undefined;
	renderResult(
		toolCallId: string,
		toolName: string,
		result: Array<{ type: string; text?: string; data?: string; mimeType?: string }>,
		details: unknown,
		isError: boolean,
	): { collapsed?: string; expanded?: string } | undefined;
}

/** Tools rendered directly by the HTML template (not pre-rendered via TUI→ANSI→HTML pipeline) */
export const TEMPLATE_RENDERED_TOOLS = new Set(["bash", "read", "write", "edit", "ls"]);

/** Pre-rendered HTML for a custom tool call and result */
export interface RenderedToolHtml {
	callHtml?: string;
	resultHtmlCollapsed?: string;
	resultHtmlExpanded?: string;
}

function collectToolCallRenders(
	msg: Extract<SessionEntry, { type: "message" }>["message"],
	toolRenderer: ToolHtmlRenderer,
	renderedTools: Record<string, RenderedToolHtml>,
): void {
	if (msg.role !== "assistant" || !Array.isArray(msg.content)) return;
	for (const block of msg.content) {
		if (block.type !== "toolCall" || TEMPLATE_RENDERED_TOOLS.has(block.name)) continue;
		const callHtml = toolRenderer.renderCall(block.id, block.name, block.arguments);
		if (callHtml) {
			renderedTools[block.id] = { callHtml };
		}
	}
}

function collectToolResultRenders(
	msg: Extract<SessionEntry, { type: "message" }>["message"],
	toolRenderer: ToolHtmlRenderer,
	renderedTools: Record<string, RenderedToolHtml>,
): void {
	if (msg.role !== "toolResult" || !msg.toolCallId) return;
	const toolName = msg.toolName || "";
	const existing = renderedTools[msg.toolCallId];
	if (!existing && TEMPLATE_RENDERED_TOOLS.has(toolName)) return;
	const rendered = toolRenderer.renderResult(msg.toolCallId, toolName, msg.content, msg.details, msg.isError || false);
	if (!rendered) return;
	renderedTools[msg.toolCallId] = {
		...existing,
		resultHtmlCollapsed: rendered.collapsed,
		resultHtmlExpanded: rendered.expanded,
	};
}

/**
 * Pre-render custom tools to HTML using their TUI renderers.
 */
export function preRenderCustomTools(
	entries: SessionEntry[],
	toolRenderer: ToolHtmlRenderer,
): Record<string, RenderedToolHtml> {
	const renderedTools: Record<string, RenderedToolHtml> = {};
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		collectToolCallRenders(entry.message, toolRenderer, renderedTools);
		collectToolResultRenders(entry.message, toolRenderer, renderedTools);
	}
	return renderedTools;
}
