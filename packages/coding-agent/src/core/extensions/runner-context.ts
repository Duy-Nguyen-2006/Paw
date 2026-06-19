/**
 * Extension and command context factories for event handlers.
 */

import type { Model } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "../model-registry.ts";
import type { SessionManager } from "../session-manager.ts";
import type { BuildSystemPromptOptions } from "../system-prompt.ts";
import type {
	CompactOptions,
	ContextUsage,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionMode,
	ExtensionUIContext,
	ForkHandler,
	NavigateTreeHandler,
	NewSessionHandler,
	ReloadHandler,
	ShutdownHandler,
	SwitchSessionHandler,
} from "./types.ts";

export interface ExtensionContextHost {
	assertActive(): void;
	uiContext: ExtensionUIContext;
	mode: ExtensionMode;
	cwd: string;
	sessionManager: SessionManager;
	modelRegistry: ModelRegistry;
	getModel(): Model<any> | undefined;
	isIdleFn(): boolean;
	isProjectTrustedFn(): boolean;
	getSignalFn(): AbortSignal | undefined;
	abortFn(): void;
	hasPendingMessagesFn(): boolean;
	shutdownHandler(): void;
	getContextUsageFn(): ContextUsage | undefined;
	compactFn(options?: CompactOptions): void;
	getSystemPromptFn(): string;
	getSystemPromptOptionsFn(): BuildSystemPromptOptions;
	waitForIdleFn(): Promise<void>;
	newSessionHandler: NewSessionHandler;
	forkHandler: ForkHandler;
	navigateTreeHandler: NavigateTreeHandler;
	switchSessionHandler: SwitchSessionHandler;
	reloadHandler: ReloadHandler;
	hasUI(): boolean;
}

export function buildExtensionContext(host: ExtensionContextHost): ExtensionContext {
	const getModel = host.getModel.bind(host);
	return {
		get ui() {
			host.assertActive();
			return host.uiContext;
		},
		get mode() {
			host.assertActive();
			return host.mode;
		},
		get hasUI() {
			host.assertActive();
			return host.hasUI();
		},
		get cwd() {
			host.assertActive();
			return host.cwd;
		},
		get sessionManager() {
			host.assertActive();
			return host.sessionManager;
		},
		get modelRegistry() {
			host.assertActive();
			return host.modelRegistry;
		},
		get model() {
			host.assertActive();
			return getModel();
		},
		isIdle: () => {
			host.assertActive();
			return host.isIdleFn();
		},
		isProjectTrusted: () => {
			host.assertActive();
			return host.isProjectTrustedFn();
		},
		get signal() {
			host.assertActive();
			return host.getSignalFn();
		},
		abort: () => {
			host.assertActive();
			host.abortFn();
		},
		hasPendingMessages: () => {
			host.assertActive();
			return host.hasPendingMessagesFn();
		},
		shutdown: () => {
			host.assertActive();
			host.shutdownHandler();
		},
		getContextUsage: () => {
			host.assertActive();
			return host.getContextUsageFn();
		},
		compact: (options) => {
			host.assertActive();
			host.compactFn(options);
		},
		getSystemPrompt: () => {
			host.assertActive();
			return host.getSystemPromptFn();
		},
	};
}

export function buildExtensionCommandContext(host: ExtensionContextHost): ExtensionCommandContext {
	const context = Object.defineProperties(
		{},
		Object.getOwnPropertyDescriptors(buildExtensionContext(host)),
	) as ExtensionCommandContext;
	context.getSystemPromptOptions = () => {
		host.assertActive();
		return host.getSystemPromptOptionsFn();
	};
	context.waitForIdle = () => {
		host.assertActive();
		return host.waitForIdleFn();
	};
	context.newSession = (options) => {
		host.assertActive();
		return host.newSessionHandler(options);
	};
	context.fork = (entryId, options) => {
		host.assertActive();
		return host.forkHandler(entryId, options);
	};
	context.navigateTree = (targetId, options) => {
		host.assertActive();
		return host.navigateTreeHandler(targetId, options);
	};
	context.switchSession = (sessionPath, options) => {
		host.assertActive();
		return host.switchSessionHandler(sessionPath, options);
	};
	context.reload = () => {
		host.assertActive();
		return host.reloadHandler();
	};
	return context;
}
