/**
 * Agent session event dispatch for interactive mode (reduces handleEvent S3776).
 */

import type { AgentSessionEvent } from "../../core/agent-session.ts";

export interface InteractiveAgentEventHandlers {
	onAgentStart(): void;
	onQueueUpdate(): void;
	onSessionInfoChanged(): void;
	onThinkingLevelChanged(): void;
	onMessageStart(event: Extract<AgentSessionEvent, { type: "message_start" }>): void;
	onMessageUpdate(event: Extract<AgentSessionEvent, { type: "message_update" }>): void;
	onMessageEnd(event: Extract<AgentSessionEvent, { type: "message_end" }>): void;
	onToolExecutionUpdate(event: Extract<AgentSessionEvent, { type: "tool_execution_update" }>): void;
	onToolExecutionEnd(event: Extract<AgentSessionEvent, { type: "tool_execution_end" }>): void;
	onToolExecutionStart(event: Extract<AgentSessionEvent, { type: "tool_execution_start" }>): void;
	onAgentEnd(): Promise<void>;
	onCompactionStart(event: Extract<AgentSessionEvent, { type: "compaction_start" }>): void;
	onCompactionEnd(event: Extract<AgentSessionEvent, { type: "compaction_end" }>): void;
	onAutoRetryStart(event: Extract<AgentSessionEvent, { type: "auto_retry_start" }>): void;
	onAutoRetryEnd(event: Extract<AgentSessionEvent, { type: "auto_retry_end" }>): void;
}

export async function dispatchInteractiveAgentEvent(
	event: AgentSessionEvent,
	handlers: InteractiveAgentEventHandlers,
): Promise<void> {
	switch (event.type) {
		case "agent_start":
			handlers.onAgentStart();
			break;
		case "queue_update":
			handlers.onQueueUpdate();
			break;
		case "session_info_changed":
			handlers.onSessionInfoChanged();
			break;
		case "thinking_level_changed":
			handlers.onThinkingLevelChanged();
			break;
		case "message_start":
			handlers.onMessageStart(event);
			break;
		case "message_update":
			handlers.onMessageUpdate(event);
			break;
		case "message_end":
			handlers.onMessageEnd(event);
			break;
		case "tool_execution_start":
			handlers.onToolExecutionStart(event);
			break;
		case "tool_execution_update":
			handlers.onToolExecutionUpdate(event);
			break;
		case "tool_execution_end":
			handlers.onToolExecutionEnd(event);
			break;
		case "agent_end":
			await handlers.onAgentEnd();
			break;
		case "compaction_start":
			handlers.onCompactionStart(event);
			break;
		case "compaction_end":
			handlers.onCompactionEnd(event);
			break;
		case "auto_retry_start":
			handlers.onAutoRetryStart(event);
			break;
		case "auto_retry_end":
			handlers.onAutoRetryEnd(event);
			break;
	}
}
