/**
 * Extension event emission loops (extracted from ExtensionRunner for S3776).
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { BuildSystemPromptOptions } from "../system-prompt.ts";
import { extensionErrorFromUnknown } from "./runner-errors.ts";
import type {
	BeforeAgentStartCombinedResult,
	RunnerEmitEvent,
	SessionBeforeEvent,
	SessionBeforeEventResult,
} from "./runner-types.ts";
import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	BeforeProviderRequestEvent,
	ContextEvent,
	ContextEventResult,
	Extension,
	ExtensionContext,
	ExtensionError,
	InputEvent,
	InputEventResult,
	InputSource,
	MessageEndEvent,
	MessageEndEventResult,
	ResourcesDiscoverEvent,
	ResourcesDiscoverResult,
	ToolCallEvent,
	ToolCallEventResult,
	ToolResultEvent,
	ToolResultEventResult,
	UserBashEvent,
	UserBashEventResult,
} from "./types.ts";

export type EmitErrorFn = (error: ExtensionError) => void;

/**
 * Dispatch helper for emitting events from higher-level helpers. The function
 * may be async and should match the runner.emit signature in spirit.
 */
export type EmitDispatchFn<TEvent> = (event: TEvent) => Promise<unknown>;

export function isSessionBeforeEvent(event: RunnerEmitEvent): event is SessionBeforeEvent {
	return (
		event.type === "session_before_switch" ||
		event.type === "session_before_fork" ||
		event.type === "session_before_compact" ||
		event.type === "session_before_tree"
	);
}

export async function processSessionBeforeHandlersForExtension<TEvent extends RunnerEmitEvent>(
	event: TEvent,
	ctx: ExtensionContext,
	ext: Extension,
	handlers: Array<(event: TEvent, ctx: ExtensionContext) => Promise<unknown>>,
	currentResult: SessionBeforeEventResult | undefined,
	emitError: EmitErrorFn,
): Promise<SessionBeforeEventResult | undefined> {
	const isBeforeEvent = isSessionBeforeEvent(event);
	let result = currentResult;

	for (const handler of handlers) {
		let handlerResult: unknown;
		try {
			handlerResult = await handler(event, ctx);
		} catch (err) {
			emitError(extensionErrorFromUnknown(ext.path, event.type, err));
			continue;
		}

		if (!isBeforeEvent || !handlerResult) continue;
		result = handlerResult as SessionBeforeEventResult;
		if (result.cancel) break;
	}

	return result;
}

export async function runMessageEndHandlersForExtension(
	event: MessageEndEvent,
	ctx: ExtensionContext,
	ext: Extension,
	currentMessage: AgentMessage,
	emitError: EmitErrorFn,
): Promise<{ message: AgentMessage; modified: boolean }> {
	const handlers = ext.handlers.get("message_end");
	if (!handlers?.length) {
		return { message: currentMessage, modified: false };
	}
	let message = currentMessage;
	let modified = false;
	for (const handler of handlers) {
		try {
			const currentEvent: MessageEndEvent = { ...event, message };
			const handlerResult = (await handler(currentEvent, ctx)) as MessageEndEventResult | undefined;
			if (!handlerResult?.message) {
				continue;
			}
			if (handlerResult.message.role !== message.role) {
				emitError({
					extensionPath: ext.path,
					event: "message_end",
					error: "message_end handlers must return a message with the same role",
				});
				continue;
			}
			message = handlerResult.message;
			modified = true;
		} catch (err) {
			emitError(extensionErrorFromUnknown(ext.path, "message_end", err));
		}
	}
	return { message, modified };
}

function applyToolResultPatch(currentEvent: ToolResultEvent, handlerResult: ToolResultEventResult): boolean {
	let modified = false;
	if (handlerResult.content !== undefined) {
		currentEvent.content = handlerResult.content;
		modified = true;
	}
	if (handlerResult.details !== undefined) {
		currentEvent.details = handlerResult.details;
		modified = true;
	}
	if (handlerResult.isError !== undefined) {
		currentEvent.isError = handlerResult.isError;
		modified = true;
	}
	return modified;
}

export async function emitToolResultAcrossExtensions(
	extensions: Extension[],
	ctx: ExtensionContext,
	event: ToolResultEvent,
	emitError: EmitErrorFn,
): Promise<ToolResultEventResult | undefined> {
	const currentEvent: ToolResultEvent = { ...event };
	let modified = false;

	for (const ext of extensions) {
		const handlers = ext.handlers.get("tool_result");
		if (!handlers?.length) continue;

		for (const handler of handlers) {
			try {
				const handlerResult = (await handler(currentEvent, ctx)) as ToolResultEventResult | undefined;
				if (!handlerResult) continue;
				if (applyToolResultPatch(currentEvent, handlerResult)) {
					modified = true;
				}
			} catch (err) {
				emitError(extensionErrorFromUnknown(ext.path, "tool_result", err));
			}
		}
	}

	if (!modified) {
		return undefined;
	}

	return {
		content: currentEvent.content,
		details: currentEvent.details,
		isError: currentEvent.isError,
	};
}

export async function emitToolCallAcrossExtensions(
	extensions: Extension[],
	ctx: ExtensionContext,
	event: ToolCallEvent,
): Promise<ToolCallEventResult | undefined> {
	let result: ToolCallEventResult | undefined;

	for (const ext of extensions) {
		const handlers = ext.handlers.get("tool_call");
		if (!handlers?.length) continue;

		for (const handler of handlers) {
			const handlerResult = await handler(event, ctx);
			if (!handlerResult) continue;
			result = handlerResult;
			if (result.block) {
				return result;
			}
		}
	}

	return result;
}

export async function emitUserBashAcrossExtensions(
	extensions: Extension[],
	ctx: ExtensionContext,
	event: UserBashEvent,
	emitError: EmitErrorFn,
): Promise<UserBashEventResult | undefined> {
	for (const ext of extensions) {
		const handlers = ext.handlers.get("user_bash");
		if (!handlers?.length) continue;

		for (const handler of handlers) {
			try {
				const handlerResult = await handler(event, ctx);
				if (handlerResult) {
					return handlerResult;
				}
			} catch (err) {
				emitError(extensionErrorFromUnknown(ext.path, "user_bash", err));
			}
		}
	}

	return undefined;
}

export async function emitContextAcrossExtensions(
	extensions: Extension[],
	ctx: ExtensionContext,
	messages: AgentMessage[],
	emitError: EmitErrorFn,
): Promise<AgentMessage[]> {
	let currentMessages = structuredClone(messages);

	for (const ext of extensions) {
		const handlers = ext.handlers.get("context");
		if (!handlers?.length) continue;

		for (const handler of handlers) {
			try {
				const contextEvent: ContextEvent = { type: "context", messages: currentMessages };
				const handlerResult = await handler(contextEvent, ctx);
				if (handlerResult && (handlerResult as ContextEventResult).messages) {
					currentMessages = (handlerResult as ContextEventResult).messages!;
				}
			} catch (err) {
				emitError(extensionErrorFromUnknown(ext.path, "context", err));
			}
		}
	}

	return currentMessages;
}

export async function emitBeforeProviderRequestAcrossExtensions(
	extensions: Extension[],
	ctx: ExtensionContext,
	payload: unknown,
	emitError: EmitErrorFn,
): Promise<unknown> {
	let currentPayload = payload;

	for (const ext of extensions) {
		const handlers = ext.handlers.get("before_provider_request");
		if (!handlers?.length) continue;

		for (const handler of handlers) {
			try {
				const providerEvent: BeforeProviderRequestEvent = {
					type: "before_provider_request",
					payload: currentPayload,
				};
				const handlerResult = await handler(providerEvent, ctx);
				if (handlerResult !== undefined) {
					currentPayload = handlerResult;
				}
			} catch (err) {
				emitError(extensionErrorFromUnknown(ext.path, "before_provider_request", err));
			}
		}
	}

	return currentPayload;
}

export async function emitBeforeAgentStartAcrossExtensions(
	extensions: Extension[],
	ctx: ExtensionContext,
	prompt: string,
	images: ImageContent[] | undefined,
	systemPromptState: { value: string },
	systemPromptOptions: BuildSystemPromptOptions,
	emitError: EmitErrorFn,
): Promise<BeforeAgentStartCombinedResult | undefined> {
	let currentSystemPrompt = systemPromptState.value;
	const messages: NonNullable<BeforeAgentStartEventResult["message"]>[] = [];
	let systemPromptModified = false;

	for (const ext of extensions) {
		const handlers = ext.handlers.get("before_agent_start");
		if (!handlers?.length) continue;

		for (const handler of handlers) {
			try {
				const agentEvent: BeforeAgentStartEvent = {
					type: "before_agent_start",
					prompt,
					images,
					systemPrompt: currentSystemPrompt,
					systemPromptOptions,
				};
				const handlerResult = await handler(agentEvent, ctx);

				if (handlerResult) {
					const result = handlerResult as BeforeAgentStartEventResult;
					if (result.message) {
						messages.push(result.message);
					}
					if (result.systemPrompt !== undefined) {
						currentSystemPrompt = result.systemPrompt;
						systemPromptState.value = result.systemPrompt;
						systemPromptModified = true;
					}
				}
			} catch (err) {
				emitError(extensionErrorFromUnknown(ext.path, "before_agent_start", err));
			}
		}
	}

	if (messages.length > 0 || systemPromptModified) {
		return {
			messages: messages.length > 0 ? messages : undefined,
			systemPrompt: systemPromptModified ? currentSystemPrompt : undefined,
		};
	}

	return undefined;
}

export async function emitResourcesDiscoverAcrossExtensions(
	extensions: Extension[],
	ctx: ExtensionContext,
	cwd: string,
	reason: ResourcesDiscoverEvent["reason"],
	emitError: EmitErrorFn,
): Promise<{
	skillPaths: Array<{ path: string; extensionPath: string }>;
	promptPaths: Array<{ path: string; extensionPath: string }>;
	themePaths: Array<{ path: string; extensionPath: string }>;
}> {
	const skillPaths: Array<{ path: string; extensionPath: string }> = [];
	const promptPaths: Array<{ path: string; extensionPath: string }> = [];
	const themePaths: Array<{ path: string; extensionPath: string }> = [];

	for (const ext of extensions) {
		const handlers = ext.handlers.get("resources_discover");
		if (!handlers?.length) continue;

		for (const handler of handlers) {
			try {
				const discoverEvent: ResourcesDiscoverEvent = { type: "resources_discover", cwd, reason };
				const handlerResult = await handler(discoverEvent, ctx);
				const result = handlerResult as ResourcesDiscoverResult | undefined;

				if (result?.skillPaths?.length) {
					skillPaths.push(...result.skillPaths.map((path) => ({ path, extensionPath: ext.path })));
				}
				if (result?.promptPaths?.length) {
					promptPaths.push(...result.promptPaths.map((path) => ({ path, extensionPath: ext.path })));
				}
				if (result?.themePaths?.length) {
					themePaths.push(...result.themePaths.map((path) => ({ path, extensionPath: ext.path })));
				}
			} catch (err) {
				emitError(extensionErrorFromUnknown(ext.path, "resources_discover", err));
			}
		}
	}

	return { skillPaths, promptPaths, themePaths };
}

export async function emitInputAcrossExtensions(
	extensions: Extension[],
	ctx: ExtensionContext,
	text: string,
	images: ImageContent[] | undefined,
	source: InputSource,
	streamingBehavior: "steer" | "followUp" | undefined,
	emitError: EmitErrorFn,
): Promise<InputEventResult> {
	let currentText = text;
	let currentImages = images;

	for (const ext of extensions) {
		for (const handler of ext.handlers.get("input") ?? []) {
			try {
				const inputEvent: InputEvent = {
					type: "input",
					text: currentText,
					images: currentImages,
					source,
					streamingBehavior,
				};
				const result = (await handler(inputEvent, ctx)) as InputEventResult | undefined;
				if (result?.action === "handled") return result;
				if (result?.action === "transform") {
					currentText = result.text;
					currentImages = result.images ?? currentImages;
				}
			} catch (err) {
				emitError(extensionErrorFromUnknown(ext.path, "input", err));
			}
		}
	}
	return currentText !== text || currentImages !== images
		? { action: "transform", text: currentText, images: currentImages }
		: { action: "continue" };
}
