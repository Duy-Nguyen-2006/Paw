/**
 * Maps core AgentEvent payloads to extension runner emissions (reduces AgentSession._emitExtensionEvent complexity).
 */

import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import type {
	ExtensionRunner,
	MessageEndEvent,
	MessageStartEvent,
	MessageUpdateEvent,
	ToolExecutionEndEvent,
	ToolExecutionStartEvent,
	ToolExecutionUpdateEvent,
	TurnEndEvent,
	TurnStartEvent,
} from "./extensions/index.ts";

export type ReplaceMessageInPlace = (target: AgentMessage, replacement: AgentMessage) => void;

export async function emitAgentEventToExtensions(
	runner: ExtensionRunner,
	event: AgentEvent,
	turnIndex: number,
	replaceMessageInPlace: ReplaceMessageInPlace,
): Promise<number> {
	switch (event.type) {
		case "agent_start":
			await runner.emit({ type: "agent_start" });
			return 0;
		case "agent_end":
			await runner.emit({ type: "agent_end", messages: event.messages });
			return turnIndex;
		case "turn_start": {
			const extensionEvent: TurnStartEvent = {
				type: "turn_start",
				turnIndex,
				timestamp: Date.now(),
			};
			await runner.emit(extensionEvent);
			return turnIndex;
		}
		case "turn_end": {
			const extensionEvent: TurnEndEvent = {
				type: "turn_end",
				turnIndex,
				message: event.message,
				toolResults: event.toolResults,
			};
			await runner.emit(extensionEvent);
			return turnIndex + 1;
		}
		case "message_start": {
			const extensionEvent: MessageStartEvent = {
				type: "message_start",
				message: event.message,
			};
			await runner.emit(extensionEvent);
			return turnIndex;
		}
		case "message_update": {
			const extensionEvent: MessageUpdateEvent = {
				type: "message_update",
				message: event.message,
				assistantMessageEvent: event.assistantMessageEvent,
			};
			await runner.emit(extensionEvent);
			return turnIndex;
		}
		case "message_end": {
			const extensionEvent: MessageEndEvent = {
				type: "message_end",
				message: event.message,
			};
			const replacement = await runner.emitMessageEnd(extensionEvent);
			if (replacement) {
				replaceMessageInPlace(event.message, replacement);
			}
			return turnIndex;
		}
		case "tool_execution_start": {
			const extensionEvent: ToolExecutionStartEvent = {
				type: "tool_execution_start",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				args: event.args,
			};
			await runner.emit(extensionEvent);
			return turnIndex;
		}
		case "tool_execution_update": {
			const extensionEvent: ToolExecutionUpdateEvent = {
				type: "tool_execution_update",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				args: event.args,
				partialResult: event.partialResult,
			};
			await runner.emit(extensionEvent);
			return turnIndex;
		}
		case "tool_execution_end": {
			const extensionEvent: ToolExecutionEndEvent = {
				type: "tool_execution_end",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				result: event.result,
				isError: event.isError,
			};
			await runner.emit(extensionEvent);
			return turnIndex;
		}
		default:
			return turnIndex;
	}
}
