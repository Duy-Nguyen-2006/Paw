/**
 * Extension runner - executes extensions and manages their lifecycle.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent, Model } from "@earendil-works/pi-ai";
import type { KeyId } from "@earendil-works/pi-tui";
import type { ResourceDiagnostic } from "../diagnostics.ts";
import type { KeybindingsConfig } from "../keybindings.ts";
import type { ModelRegistry } from "../model-registry.ts";
import type { SessionManager } from "../session-manager.ts";
import type { BuildSystemPromptOptions } from "../system-prompt.ts";
import {
	applyExtensionActions,
	flushPendingProviderRegistrations,
	wireLiveProviderRegistration,
} from "./runner-bind.ts";
import { resolveRegisteredCommands } from "./runner-commands.ts";
import { buildExtensionCommandContext, buildExtensionContext, type ExtensionContextHost } from "./runner-context.ts";
import {
	emitBeforeAgentStartAcrossExtensions,
	emitBeforeProviderRequestAcrossExtensions,
	emitContextAcrossExtensions,
	emitInputAcrossExtensions,
	emitResourcesDiscoverAcrossExtensions,
	emitToolCallAcrossExtensions,
	emitToolResultAcrossExtensions,
	emitUserBashAcrossExtensions,
	processSessionBeforeHandlersForExtension,
	runMessageEndHandlersForExtension,
} from "./runner-emit-helpers.ts";
import { noOpUIContext } from "./runner-noop-ui.ts";
import { collectExtensionShortcuts } from "./runner-shortcuts.ts";
import type {
	BeforeAgentStartCombinedResult,
	RunnerEmitEvent,
	RunnerEmitResult,
	SessionBeforeEventResult,
} from "./runner-types.ts";
import type {
	CompactOptions,
	ContextUsage,
	Extension,
	ExtensionActions,
	ExtensionCommandContextActions,
	ExtensionContextActions,
	ExtensionError,
	ExtensionFlag,
	ExtensionMode,
	ExtensionRuntime,
	ExtensionShortcut,
	ExtensionUIContext,
	InputEventResult,
	InputSource,
	LoadExtensionsResult,
	MessageEndEvent,
	MessageRenderer,
	ProjectTrustContext,
	ProjectTrustEvent,
	ProjectTrustEventResult,
	ProviderConfig,
	RegisteredTool,
	ReplacedSessionContext,
	ResolvedCommand,
	ResourcesDiscoverEvent,
	SessionShutdownEvent,
	ToolCallEvent,
	ToolCallEventResult,
	ToolResultEvent,
	ToolResultEventResult,
	UserBashEvent,
	UserBashEventResult,
} from "./types.ts";

export type ExtensionErrorListener = (error: ExtensionError) => void;

export type NewSessionHandler = (options?: {
	parentSession?: string;
	setup?: (sessionManager: SessionManager) => Promise<void>;
	withSession?: (ctx: ReplacedSessionContext) => Promise<void>;
}) => Promise<{ cancelled: boolean }>;

export type ForkHandler = (
	entryId: string,
	options?: { position?: "before" | "at"; withSession?: (ctx: ReplacedSessionContext) => Promise<void> },
) => Promise<{ cancelled: boolean }>;

export type NavigateTreeHandler = (
	targetId: string,
	options?: { summarize?: boolean; customInstructions?: string; replaceInstructions?: boolean; label?: string },
) => Promise<{ cancelled: boolean }>;

export type SwitchSessionHandler = (
	sessionPath: string,
	options?: { withSession?: (ctx: ReplacedSessionContext) => Promise<void> },
) => Promise<{ cancelled: boolean }>;

export type ReloadHandler = () => Promise<void>;

export type ShutdownHandler = () => void;

export async function emitSessionShutdownEvent(
	extensionRunner: ExtensionRunner,
	event: SessionShutdownEvent,
): Promise<boolean> {
	if (extensionRunner.hasHandlers("session_shutdown")) {
		await extensionRunner.emit(event);
		return true;
	}
	return false;
}

export async function emitProjectTrustEvent(
	extensionsResult: LoadExtensionsResult,
	event: ProjectTrustEvent,
	ctx: ProjectTrustContext,
): Promise<{ result?: ProjectTrustEventResult; errors: ExtensionError[] }> {
	const errors: ExtensionError[] = [];
	for (const ext of extensionsResult.extensions) {
		const handlers = ext.handlers.get("project_trust");
		if (!handlers || handlers.length === 0) continue;

		for (const handler of handlers) {
			try {
				const handlerResult = (await handler(event, ctx)) as ProjectTrustEventResult;
				if (handlerResult.trusted === "undecided") {
					continue;
				}
				return { result: handlerResult, errors };
			} catch (error) {
				errors.push({
					extensionPath: ext.path,
					event: event.type,
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
				});
			}
		}
	}
	return { errors };
}

export class ExtensionRunner {
	private extensions: Extension[];
	private runtime: ExtensionRuntime;
	private uiContext: ExtensionUIContext;
	private mode: ExtensionMode = "print";
	private cwd: string;
	private sessionManager: SessionManager;
	private modelRegistry: ModelRegistry;
	private readonly errorListeners: Set<ExtensionErrorListener> = new Set();
	private getModel: () => Model<any> | undefined = () => undefined;
	private isIdleFn: () => boolean = () => true;
	private isProjectTrustedFn: () => boolean = () => true;
	private getSignalFn: () => AbortSignal | undefined = () => undefined;
	private waitForIdleFn: () => Promise<void> = async () => {};
	private abortFn: () => void = () => {};
	private hasPendingMessagesFn: () => boolean = () => false;
	private getContextUsageFn: () => ContextUsage | undefined = () => undefined;
	private compactFn: (options?: CompactOptions) => void = () => {};
	private getSystemPromptFn: () => string = () => "";
	private getSystemPromptOptionsFn: () => BuildSystemPromptOptions = () => ({ cwd: this.cwd });
	private newSessionHandler: NewSessionHandler = async () => ({ cancelled: false });
	private forkHandler: ForkHandler = async () => ({ cancelled: false });
	private navigateTreeHandler: NavigateTreeHandler = async () => ({ cancelled: false });
	private switchSessionHandler: SwitchSessionHandler = async () => ({ cancelled: false });
	private reloadHandler: ReloadHandler = async () => {};
	private shutdownHandler: ShutdownHandler = () => {};
	private shortcutDiagnostics: ResourceDiagnostic[] = [];
	private commandDiagnostics: ResourceDiagnostic[] = [];
	private staleMessage: string | undefined;

	constructor(
		extensions: Extension[],
		runtime: ExtensionRuntime,
		cwd: string,
		sessionManager: SessionManager,
		modelRegistry: ModelRegistry,
	) {
		this.extensions = extensions;
		this.runtime = runtime;
		this.uiContext = noOpUIContext;
		this.cwd = cwd;
		this.sessionManager = sessionManager;
		this.modelRegistry = modelRegistry;
	}

	bindCore(
		actions: ExtensionActions,
		contextActions: ExtensionContextActions,
		providerActions?: {
			registerProvider?: (name: string, config: ProviderConfig) => void;
			unregisterProvider?: (name: string) => void;
		},
	): void {
		applyExtensionActions(this.runtime, actions);
		this.getModel = contextActions.getModel;
		this.isIdleFn = contextActions.isIdle;
		this.isProjectTrustedFn = contextActions.isProjectTrusted;
		this.getSignalFn = contextActions.getSignal;
		this.abortFn = contextActions.abort;
		this.hasPendingMessagesFn = contextActions.hasPendingMessages;
		this.shutdownHandler = contextActions.shutdown;
		this.getContextUsageFn = contextActions.getContextUsage;
		this.compactFn = contextActions.compact;
		this.getSystemPromptFn = contextActions.getSystemPrompt;
		this.getSystemPromptOptionsFn = contextActions.getSystemPromptOptions ?? (() => ({ cwd: this.cwd }));

		flushPendingProviderRegistrations(this.runtime, this.modelRegistry, providerActions, (error) =>
			this.emitError(error),
		);
		wireLiveProviderRegistration(this.runtime, this.modelRegistry, providerActions);
	}

	bindCommandContext(actions?: ExtensionCommandContextActions): void {
		if (actions) {
			this.waitForIdleFn = actions.waitForIdle;
			this.newSessionHandler = actions.newSession;
			this.forkHandler = actions.fork;
			this.navigateTreeHandler = actions.navigateTree;
			this.switchSessionHandler = actions.switchSession;
			this.reloadHandler = actions.reload;
			return;
		}

		this.waitForIdleFn = async () => {};
		this.newSessionHandler = async () => ({ cancelled: false });
		this.forkHandler = async () => ({ cancelled: false });
		this.navigateTreeHandler = async () => ({ cancelled: false });
		this.switchSessionHandler = async () => ({ cancelled: false });
		this.reloadHandler = async () => {};
	}

	setUIContext(uiContext?: ExtensionUIContext, mode: ExtensionMode = "print"): void {
		this.uiContext = uiContext ?? noOpUIContext;
		this.mode = mode;
	}

	getUIContext(): ExtensionUIContext {
		return this.uiContext;
	}

	hasUI(): boolean {
		return this.uiContext !== noOpUIContext;
	}

	getExtensionPaths(): string[] {
		return this.extensions.map((e) => e.path);
	}

	getAllRegisteredTools(): RegisteredTool[] {
		const toolsByName = new Map<string, RegisteredTool>();
		for (const ext of this.extensions) {
			for (const tool of ext.tools.values()) {
				if (!toolsByName.has(tool.definition.name)) {
					toolsByName.set(tool.definition.name, tool);
				}
			}
		}
		return Array.from(toolsByName.values());
	}

	getToolDefinition(toolName: string): RegisteredTool["definition"] | undefined {
		for (const ext of this.extensions) {
			const tool = ext.tools.get(toolName);
			if (tool) {
				return tool.definition;
			}
		}
		return undefined;
	}

	getFlags(): Map<string, ExtensionFlag> {
		const allFlags = new Map<string, ExtensionFlag>();
		for (const ext of this.extensions) {
			for (const [name, flag] of ext.flags) {
				if (!allFlags.has(name)) {
					allFlags.set(name, flag);
				}
			}
		}
		return allFlags;
	}

	setFlagValue(name: string, value: boolean | string): void {
		this.runtime.flagValues.set(name, value);
	}

	getFlagValues(): Map<string, boolean | string> {
		return new Map(this.runtime.flagValues);
	}

	getShortcuts(resolvedKeybindings: KeybindingsConfig): Map<KeyId, ExtensionShortcut> {
		this.shortcutDiagnostics = [];
		return collectExtensionShortcuts(this.extensions, resolvedKeybindings, (message, extensionPath) => {
			this.shortcutDiagnostics.push({ type: "warning", message, path: extensionPath });
			if (!this.hasUI()) {
				console.warn(message);
			}
		});
	}

	getShortcutDiagnostics(): ResourceDiagnostic[] {
		return this.shortcutDiagnostics;
	}

	invalidate(
		message = "This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload(). For newSession, fork, and switchSession, move post-replacement work into withSession and use the ctx passed to withSession. For reload, do not use the old ctx after await ctx.reload().",
	): void {
		if (!this.staleMessage) {
			this.staleMessage = message;
			this.runtime.invalidate(message);
		}
	}

	assertActive(): void {
		if (this.staleMessage) {
			throw new Error(this.staleMessage);
		}
	}

	onError(listener: ExtensionErrorListener): () => void {
		this.errorListeners.add(listener);
		return () => this.errorListeners.delete(listener);
	}

	emitError(error: ExtensionError): void {
		for (const listener of this.errorListeners) {
			listener(error);
		}
	}

	hasHandlers(eventType: string): boolean {
		for (const ext of this.extensions) {
			const handlers = ext.handlers.get(eventType);
			if (handlers && handlers.length > 0) {
				return true;
			}
		}
		return false;
	}

	getMessageRenderer(customType: string): MessageRenderer | undefined {
		for (const ext of this.extensions) {
			const renderer = ext.messageRenderers.get(customType);
			if (renderer) {
				return renderer;
			}
		}
		return undefined;
	}

	getRegisteredCommands(): ResolvedCommand[] {
		this.commandDiagnostics = [];
		return resolveRegisteredCommands(this.extensions);
	}

	getCommandDiagnostics(): ResourceDiagnostic[] {
		return this.commandDiagnostics;
	}

	getCommand(name: string): ResolvedCommand | undefined {
		return this.resolveRegisteredCommands().find((command) => command.invocationName === name);
	}

	private resolveRegisteredCommands(): ResolvedCommand[] {
		return resolveRegisteredCommands(this.extensions);
	}

	shutdown(): void {
		this.shutdownHandler();
	}

	private getContextHost(): ExtensionContextHost {
		const runner = this;
		return {
			assertActive: () => runner.assertActive(),
			get uiContext() {
				return runner.uiContext;
			},
			get mode() {
				return runner.mode;
			},
			get cwd() {
				return runner.cwd;
			},
			get sessionManager() {
				return runner.sessionManager;
			},
			get modelRegistry() {
				return runner.modelRegistry;
			},
			getModel: () => runner.getModel(),
			isIdleFn: () => runner.isIdleFn(),
			isProjectTrustedFn: () => runner.isProjectTrustedFn(),
			getSignalFn: () => runner.getSignalFn(),
			abortFn: () => runner.abortFn(),
			hasPendingMessagesFn: () => runner.hasPendingMessagesFn(),
			shutdownHandler: () => runner.shutdownHandler(),
			getContextUsageFn: () => runner.getContextUsageFn(),
			compactFn: (options) => runner.compactFn(options),
			getSystemPromptFn: () => runner.getSystemPromptFn(),
			getSystemPromptOptionsFn: () => runner.getSystemPromptOptionsFn(),
			waitForIdleFn: () => runner.waitForIdleFn(),
			get newSessionHandler() {
				return runner.newSessionHandler;
			},
			get forkHandler() {
				return runner.forkHandler;
			},
			get navigateTreeHandler() {
				return runner.navigateTreeHandler;
			},
			get switchSessionHandler() {
				return runner.switchSessionHandler;
			},
			get reloadHandler() {
				return runner.reloadHandler;
			},
			hasUI: () => runner.hasUI(),
		};
	}

	createContext() {
		return buildExtensionContext(this.getContextHost());
	}

	createCommandContext() {
		return buildExtensionCommandContext(this.getContextHost());
	}

	async emit<TEvent extends RunnerEmitEvent>(event: TEvent): Promise<RunnerEmitResult<TEvent>> {
		const ctx = this.createContext();
		let result: SessionBeforeEventResult | undefined;

		for (const ext of this.extensions) {
			const handlers = ext.handlers.get(event.type);
			if (!handlers?.length) continue;

			result = await processSessionBeforeHandlersForExtension(event, ctx, ext, handlers, result, (error) =>
				this.emitError(error),
			);
			if (result?.cancel) {
				return result as RunnerEmitResult<TEvent>;
			}
		}

		return result as RunnerEmitResult<TEvent>;
	}

	async emitMessageEnd(event: MessageEndEvent): Promise<AgentMessage | undefined> {
		const ctx = this.createContext();
		let currentMessage = event.message;
		let modified = false;

		for (const ext of this.extensions) {
			const result = await runMessageEndHandlersForExtension(event, ctx, ext, currentMessage, (error) =>
				this.emitError(error),
			);
			currentMessage = result.message;
			if (result.modified) {
				modified = true;
			}
		}

		return modified ? currentMessage : undefined;
	}

	async emitToolResult(event: ToolResultEvent): Promise<ToolResultEventResult | undefined> {
		return emitToolResultAcrossExtensions(this.extensions, this.createContext(), event, (error) =>
			this.emitError(error),
		);
	}

	async emitToolCall(event: ToolCallEvent): Promise<ToolCallEventResult | undefined> {
		return emitToolCallAcrossExtensions(this.extensions, this.createContext(), event);
	}

	async emitUserBash(event: UserBashEvent): Promise<UserBashEventResult | undefined> {
		return emitUserBashAcrossExtensions(this.extensions, this.createContext(), event, (error) =>
			this.emitError(error),
		);
	}

	async emitContext(messages: AgentMessage[]): Promise<AgentMessage[]> {
		return emitContextAcrossExtensions(this.extensions, this.createContext(), messages, (error) =>
			this.emitError(error),
		);
	}

	async emitBeforeProviderRequest(payload: unknown): Promise<unknown> {
		return emitBeforeProviderRequestAcrossExtensions(this.extensions, this.createContext(), payload, (error) =>
			this.emitError(error),
		);
	}

	async emitBeforeAgentStart(
		prompt: string,
		images: ImageContent[] | undefined,
		systemPrompt: string,
		systemPromptOptions: BuildSystemPromptOptions,
	): Promise<BeforeAgentStartCombinedResult | undefined> {
		const systemPromptState = { value: systemPrompt };
		const ctx = Object.defineProperties({}, Object.getOwnPropertyDescriptors(this.createContext())) as ReturnType<
			ExtensionRunner["createContext"]
		>;
		ctx.getSystemPrompt = () => {
			this.assertActive();
			return systemPromptState.value;
		};
		return emitBeforeAgentStartAcrossExtensions(
			this.extensions,
			ctx,
			prompt,
			images,
			systemPromptState,
			systemPromptOptions,
			(error) => this.emitError(error),
		);
	}

	async emitResourcesDiscover(
		cwd: string,
		reason: ResourcesDiscoverEvent["reason"],
	): Promise<{
		skillPaths: Array<{ path: string; extensionPath: string }>;
		promptPaths: Array<{ path: string; extensionPath: string }>;
		themePaths: Array<{ path: string; extensionPath: string }>;
	}> {
		return emitResourcesDiscoverAcrossExtensions(this.extensions, this.createContext(), cwd, reason, (error) =>
			this.emitError(error),
		);
	}

	async emitInput(
		text: string,
		images: ImageContent[] | undefined,
		source: InputSource,
		streamingBehavior?: "steer" | "followUp",
	): Promise<InputEventResult> {
		return emitInputAcrossExtensions(
			this.extensions,
			this.createContext(),
			text,
			images,
			source,
			streamingBehavior,
			(error) => this.emitError(error),
		);
	}
}
