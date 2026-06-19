/**
 * Session context → chat rendering (reduces renderSessionContext S3776).
 */

import type { Message } from "@earendil-works/pi-ai";
import type { TUI } from "@earendil-works/pi-tui";
import type { AgentSession } from "../../core/agent-session.ts";
import type { SessionContext } from "../../core/session-manager.ts";
import type { SettingsManager } from "../../core/settings-manager.ts";
import { ToolExecutionComponent } from "./components/tool-execution.ts";
import { type AddMessageToChatDeps, addAgentMessageToChat } from "./interactive-chat-messages.ts";

export interface RenderSessionContextDeps extends AddMessageToChatDeps {
	session: AgentSession;
	settingsManager: SettingsManager;
	ui: TUI;
	pendingTools: Map<string, ToolExecutionComponent>;
	getRegisteredToolDefinition: (toolName: string) => ReturnType<AgentSession["getToolDefinition"]>;
	getSessionCwd: () => string;
	getRetryAttempt: () => number;
	onUpdateFooter?: () => void;
}

function assistantToolCallErrorMessage(message: Message & { role: "assistant" }, retryAttempt: number): string {
	if (message.stopReason === "aborted") {
		return retryAttempt > 0
			? `Aborted after ${retryAttempt} retry attempt${retryAttempt > 1 ? "s" : ""}`
			: "Operation aborted";
	}
	return message.errorMessage || "Error";
}

export function renderInteractiveSessionContext(
	sessionContext: SessionContext,
	deps: RenderSessionContextDeps,
	options: { updateFooter?: boolean; populateHistory?: boolean } = {},
): void {
	deps.pendingTools.clear();
	const renderedPendingTools = new Map<string, ToolExecutionComponent>();

	if (options.updateFooter) {
		deps.onUpdateFooter?.();
	}

	for (const message of sessionContext.messages) {
		if (message.role === "assistant") {
			addAgentMessageToChat(message, deps, options);
			for (const content of message.content) {
				if (content.type !== "toolCall") {
					continue;
				}
				const component = new ToolExecutionComponent(
					content.name,
					content.id,
					content.arguments,
					{
						showImages: deps.settingsManager.getShowImages(),
						imageWidthCells: deps.settingsManager.getImageWidthCells(),
					},
					deps.getRegisteredToolDefinition(content.name),
					deps.ui,
					deps.getSessionCwd(),
				);
				component.setExpanded(deps.toolOutputExpanded);
				deps.chatContainer.addChild(component);

				if (message.stopReason === "aborted" || message.stopReason === "error") {
					const errorMessage = assistantToolCallErrorMessage(message, deps.getRetryAttempt());
					component.updateResult({ content: [{ type: "text", text: errorMessage }], isError: true });
				} else {
					renderedPendingTools.set(content.id, component);
				}
			}
		} else if (message.role === "toolResult") {
			const component = renderedPendingTools.get(message.toolCallId);
			if (component) {
				component.updateResult(message);
				renderedPendingTools.delete(message.toolCallId);
			}
		} else {
			addAgentMessageToChat(message, deps, options);
		}
	}

	for (const [toolCallId, component] of renderedPendingTools) {
		deps.pendingTools.set(toolCallId, component);
	}
	deps.ui.requestRender();
}
