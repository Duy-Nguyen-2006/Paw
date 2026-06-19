/**
 * Binds extension runtime actions and provider registration after load.
 */

import type { ModelRegistry } from "../model-registry.ts";
import type { BuildSystemPromptOptions } from "../system-prompt.ts";
import type {
	ExtensionActions,
	ExtensionContextActions,
	ExtensionError,
	ExtensionRuntime,
	ProviderConfig,
} from "./types.ts";

export interface ProviderBindActions {
	registerProvider?: (name: string, config: ProviderConfig) => void;
	unregisterProvider?: (name: string) => void;
}

export function applyExtensionActions(runtime: ExtensionRuntime, actions: ExtensionActions): void {
	runtime.sendMessage = actions.sendMessage;
	runtime.sendUserMessage = actions.sendUserMessage;
	runtime.appendEntry = actions.appendEntry;
	runtime.setSessionName = actions.setSessionName;
	runtime.getSessionName = actions.getSessionName;
	runtime.setLabel = actions.setLabel;
	runtime.getActiveTools = actions.getActiveTools;
	runtime.getAllTools = actions.getAllTools;
	runtime.setActiveTools = actions.setActiveTools;
	runtime.refreshTools = actions.refreshTools;
	runtime.getCommands = actions.getCommands;
	runtime.setModel = actions.setModel;
	runtime.getThinkingLevel = actions.getThinkingLevel;
	runtime.setThinkingLevel = actions.setThinkingLevel;
}

export function flushPendingProviderRegistrations(
	runtime: ExtensionRuntime,
	modelRegistry: ModelRegistry,
	providerActions: ProviderBindActions | undefined,
	emitError: (error: ExtensionError) => void,
): void {
	for (const { name, config, extensionPath } of runtime.pendingProviderRegistrations) {
		try {
			if (providerActions?.registerProvider) {
				providerActions.registerProvider(name, config);
			} else {
				modelRegistry.registerProvider(name, config);
			}
		} catch (err) {
			emitError({
				extensionPath,
				event: "register_provider",
				error: err instanceof Error ? err.message : String(err),
				stack: err instanceof Error ? err.stack : undefined,
			});
		}
	}
	runtime.pendingProviderRegistrations = [];
}

export function wireLiveProviderRegistration(
	runtime: ExtensionRuntime,
	modelRegistry: ModelRegistry,
	providerActions: ProviderBindActions | undefined,
): void {
	runtime.registerProvider = (name, config) => {
		if (providerActions?.registerProvider) {
			providerActions.registerProvider(name, config);
			return;
		}
		modelRegistry.registerProvider(name, config);
	};
	runtime.unregisterProvider = (name) => {
		if (providerActions?.unregisterProvider) {
			providerActions.unregisterProvider(name);
			return;
		}
		modelRegistry.unregisterProvider(name);
	};
}

export function defaultSystemPromptOptions(cwd: string): BuildSystemPromptOptions {
	return { cwd };
}

export type ContextActionBindings = Pick<
	ExtensionContextActions,
	| "getModel"
	| "isIdle"
	| "isProjectTrusted"
	| "getSignal"
	| "abort"
	| "hasPendingMessages"
	| "shutdown"
	| "getContextUsage"
	| "compact"
	| "getSystemPrompt"
> & {
	getSystemPromptOptions?: () => BuildSystemPromptOptions;
};
