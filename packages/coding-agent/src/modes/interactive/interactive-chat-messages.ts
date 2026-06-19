/**
 * Chat message rendering for interactive mode (reduces addMessageToChat S3776).
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import type { Container, EditorComponent, MarkdownTheme, TUI } from "@earendil-works/pi-tui";
import { Spacer } from "@earendil-works/pi-tui";
import type { AgentSession } from "../../core/agent-session.ts";
import { parseSkillBlock } from "../../core/agent-session.ts";
import type { TruncationResult } from "../../core/tools/truncate.ts";
import { AssistantMessageComponent } from "./components/assistant-message.ts";
import { BashExecutionComponent } from "./components/bash-execution.ts";
import { BranchSummaryMessageComponent } from "./components/branch-summary-message.ts";
import { CompactionSummaryMessageComponent } from "./components/compaction-summary-message.ts";
import { CustomMessageComponent } from "./components/custom-message.ts";
import { SkillInvocationMessageComponent } from "./components/skill-invocation-message.ts";
import { UserMessageComponent } from "./components/user-message.ts";

export interface AddMessageToChatDeps {
	chatContainer: Container;
	session: AgentSession;
	editor: EditorComponent;
	toolOutputExpanded: boolean;
	hideThinkingBlock: boolean;
	hiddenThinkingLabel: string;
	getMarkdownTheme: () => MarkdownTheme;
	ui: TUI;
}

export function getUserMessageText(message: Message): string {
	if (message.role !== "user") return "";
	const textBlocks =
		typeof message.content === "string"
			? [{ type: "text", text: message.content }]
			: message.content.filter((c: { type: string }) => c.type === "text");
	return textBlocks.map((c) => (c as { text: string }).text).join("");
}

function addBashExecutionMessageToChat(
	message: Extract<AgentMessage, { role: "bashExecution" }>,
	deps: AddMessageToChatDeps,
): void {
	const component = new BashExecutionComponent(message.command, deps.ui, message.excludeFromContext);
	if (message.output) {
		component.appendOutput(message.output);
	}
	component.setComplete(
		message.exitCode,
		message.cancelled,
		message.truncated ? ({ truncated: true } as TruncationResult) : undefined,
		message.fullOutputPath,
	);
	deps.chatContainer.addChild(component);
}

function addUserMessageToChat(
	message: Extract<AgentMessage, { role: "user" }>,
	deps: AddMessageToChatDeps,
	populateHistory?: boolean,
): void {
	const textContent = getUserMessageText(message);
	if (!textContent) {
		return;
	}
	if (deps.chatContainer.children.length > 0) {
		deps.chatContainer.addChild(new Spacer(1));
	}
	const skillBlock = parseSkillBlock(textContent);
	const markdownTheme = deps.getMarkdownTheme();
	if (skillBlock) {
		const component = new SkillInvocationMessageComponent(skillBlock, markdownTheme);
		component.setExpanded(deps.toolOutputExpanded);
		deps.chatContainer.addChild(component);
		if (skillBlock.userMessage) {
			deps.chatContainer.addChild(new Spacer(1));
			const userComponent = new UserMessageComponent(skillBlock.userMessage, markdownTheme);
			deps.chatContainer.addChild(userComponent);
		}
	} else {
		const userComponent = new UserMessageComponent(textContent, markdownTheme);
		deps.chatContainer.addChild(userComponent);
	}
	if (populateHistory) {
		deps.editor.addToHistory?.(textContent);
	}
}

export function addAgentMessageToChat(
	message: AgentMessage,
	deps: AddMessageToChatDeps,
	options?: { populateHistory?: boolean },
): void {
	switch (message.role) {
		case "bashExecution":
			addBashExecutionMessageToChat(message, deps);
			break;
		case "custom": {
			if (message.display) {
				const renderer = deps.session.extensionRunner.getMessageRenderer(message.customType);
				const component = new CustomMessageComponent(message, renderer, deps.getMarkdownTheme());
				component.setExpanded(deps.toolOutputExpanded);
				deps.chatContainer.addChild(component);
			}
			break;
		}
		case "compactionSummary": {
			deps.chatContainer.addChild(new Spacer(1));
			const component = new CompactionSummaryMessageComponent(message, deps.getMarkdownTheme());
			component.setExpanded(deps.toolOutputExpanded);
			deps.chatContainer.addChild(component);
			break;
		}
		case "branchSummary": {
			deps.chatContainer.addChild(new Spacer(1));
			const component = new BranchSummaryMessageComponent(message, deps.getMarkdownTheme());
			component.setExpanded(deps.toolOutputExpanded);
			deps.chatContainer.addChild(component);
			break;
		}
		case "user":
			addUserMessageToChat(message, deps, options?.populateHistory);
			break;
		case "assistant": {
			const assistantComponent = new AssistantMessageComponent(
				message,
				deps.hideThinkingBlock,
				deps.getMarkdownTheme(),
				deps.hiddenThinkingLabel,
			);
			deps.chatContainer.addChild(assistantComponent);
			break;
		}
		case "toolResult":
			break;
		default: {
			const _exhaustive: never = message;
		}
	}
}
