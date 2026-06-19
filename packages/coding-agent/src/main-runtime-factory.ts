/**
 * Agent session runtime factory wiring for main() (reduces main() cognitive complexity).
 */

import type { Args } from "./cli/args.ts";
import { createProjectTrustContext } from "./cli/project-trust.ts";
import type { CreateAgentSessionRuntimeFactory } from "./core/agent-session-runtime.ts";
import {
	type AgentSessionRuntimeDiagnostic,
	type AgentSessionServices,
	createAgentSessionFromServices,
	createAgentSessionServices,
} from "./core/agent-session-services.ts";
import type { AuthStorage } from "./core/auth-storage.ts";
import type { ExtensionFactory } from "./core/extensions/types.ts";
import type { ModelRegistry } from "./core/model-registry.ts";
import { resolveModelScope, type ScopedModel } from "./core/model-resolver.ts";
import type { AppMode } from "./core/project-trust.ts";
import { resolveProjectTrusted } from "./core/project-trust.ts";
import type { ResourceLoader } from "./core/resource-loader.ts";
import type { CreateAgentSessionOptions } from "./core/sdk.ts";
import type { SettingsManager } from "./core/settings-manager.ts";
import { hasTrustRequiringProjectResources, type ProjectTrustStore } from "./core/trust-manager.ts";

export interface RuntimeFactoryContext {
	parsed: Args;
	trustStore: ProjectTrustStore;
	trustPromptMode: AppMode;
	appMode: AppMode;
	projectTrustByCwd: Map<string, boolean>;
	resolvedExtensionPaths: string[];
	resolvedSkillPaths: string[];
	resolvedPromptTemplatePaths: string[];
	resolvedThemePaths: string[];
	authStorage: AuthStorage;
	startupSettingsManager: SettingsManager;
	extensionFactories: ExtensionFactory[] | undefined;
	buildSessionOptions: (
		parsed: Args,
		scopedModels: ScopedModel[],
		hasExistingSession: boolean,
		modelRegistry: ModelRegistry,
		settingsManager: SettingsManager,
	) => {
		options: CreateAgentSessionOptions;
		cliThinkingFromModel: boolean;
		diagnostics: AgentSessionRuntimeDiagnostic[];
	};
}

export function buildSessionDiagnostics(
	services: AgentSessionServices,
	settingsManager: SettingsManager,
	resourceLoader: ResourceLoader,
	projectTrustDiagnostics: AgentSessionRuntimeDiagnostic[],
	collectSettingsDiagnostics: (sm: SettingsManager, context: string) => AgentSessionRuntimeDiagnostic[],
): AgentSessionRuntimeDiagnostic[] {
	return [
		...projectTrustDiagnostics,
		...services.diagnostics,
		...collectSettingsDiagnostics(settingsManager, "runtime creation"),
		...resourceLoader.getExtensions().errors.map(({ path, error }: { path: string; error: unknown }) => ({
			type: "error" as const,
			message: `Failed to load extension "${path}": ${String(error)}`,
		})),
	];
}

export function applyRuntimeApiKey(
	parsed: Args,
	sessionOptions: CreateAgentSessionOptions,
	authStorage: AuthStorage,
	diagnostics: AgentSessionRuntimeDiagnostic[],
): void {
	if (parsed.apiKey === undefined) return;
	if (!sessionOptions.model) {
		diagnostics.push({
			type: "error",
			message: "--api-key requires a model to be specified via --model, --provider/--model, or --models",
		});
		return;
	}
	authStorage.setRuntimeApiKey(sessionOptions.model.provider, parsed.apiKey);
}

export function applyCliThinkingOverride(
	created: Awaited<ReturnType<typeof createAgentSessionFromServices>>,
	parsed: Args,
	cliThinkingFromModel: boolean,
): void {
	const cliThinkingOverride = parsed.thinking !== undefined || cliThinkingFromModel;
	if (created.session.model && cliThinkingOverride) {
		created.session.setThinkingLevel(created.session.thinkingLevel);
	}
}

export async function buildCreateRuntime(
	context: RuntimeFactoryContext,
	collectSettingsDiagnostics: (sm: SettingsManager, context: string) => AgentSessionRuntimeDiagnostic[],
): Promise<CreateAgentSessionRuntimeFactory> {
	return async ({ cwd: runtimeCwd, agentDir, sessionManager, sessionStartEvent, projectTrustContext }) => {
		const isInitialRuntime = sessionStartEvent === undefined;
		const projectTrustDiagnostics: AgentSessionRuntimeDiagnostic[] = [];
		const cachedProjectTrust = context.projectTrustByCwd.get(runtimeCwd);
		const hasTrustRequiringResources = hasTrustRequiringProjectResources(runtimeCwd);
		const shouldResolveProjectTrust =
			context.parsed.projectTrustOverride === undefined &&
			cachedProjectTrust === undefined &&
			hasTrustRequiringResources;
		const projectTrusted = shouldResolveProjectTrust
			? false
			: (cachedProjectTrust ??
				context.parsed.projectTrustOverride ??
				(!hasTrustRequiringResources || context.trustStore.get(runtimeCwd) === true));
		const runtimeSettingsManager = SettingsManager.create(runtimeCwd, agentDir, { projectTrusted });
		const services = await createAgentSessionServices({
			cwd: runtimeCwd,
			agentDir,
			authStorage: context.authStorage,
			settingsManager: runtimeSettingsManager,
			extensionFlagValues: context.parsed.unknownFlags,
			resourceLoaderReloadOptions: shouldResolveProjectTrust
				? {
						resolveProjectTrust: async ({ extensionsResult }) => {
							const trusted = await resolveProjectTrusted({
								cwd: runtimeCwd,
								trustStore: context.trustStore,
								trustOverride: context.parsed.projectTrustOverride,
								defaultProjectTrust: context.startupSettingsManager.getDefaultProjectTrust(),
								extensionsResult,
								projectTrustContext:
									projectTrustContext ??
									createProjectTrustContext({
										cwd: runtimeCwd,
										mode: isInitialRuntime ? context.trustPromptMode : context.appMode,
										settingsManager: context.startupSettingsManager,
										hasUI: isInitialRuntime && context.trustPromptMode === "interactive",
									}),
								onExtensionError: (message) => projectTrustDiagnostics.push({ type: "warning", message }),
							});
							context.projectTrustByCwd.set(runtimeCwd, trusted);
							return trusted;
						},
					}
				: undefined,
			resourceLoaderOptions: {
				additionalExtensionPaths: context.resolvedExtensionPaths,
				additionalSkillPaths: context.resolvedSkillPaths,
				additionalPromptTemplatePaths: context.resolvedPromptTemplatePaths,
				additionalThemePaths: context.resolvedThemePaths,
				noExtensions: context.parsed.noExtensions,
				noSkills: context.parsed.noSkills,
				noPromptTemplates: context.parsed.noPromptTemplates,
				noThemes: context.parsed.noThemes,
				noContextFiles: context.parsed.noContextFiles,
				systemPrompt: context.parsed.systemPrompt,
				appendSystemPrompt: context.parsed.appendSystemPrompt,
				extensionFactories: context.extensionFactories,
			},
		});
		const { settingsManager, modelRegistry, resourceLoader } = services;
		const diagnostics = buildSessionDiagnostics(
			services,
			settingsManager,
			resourceLoader,
			projectTrustDiagnostics,
			collectSettingsDiagnostics,
		);

		const modelPatterns = context.parsed.models ?? settingsManager.getEnabledModels();
		const scopedModels =
			modelPatterns && modelPatterns.length > 0 ? await resolveModelScope(modelPatterns, modelRegistry) : [];
		const {
			options: sessionOptions,
			cliThinkingFromModel,
			diagnostics: sessionOptionDiagnostics,
		} = context.buildSessionOptions(
			context.parsed,
			scopedModels,
			sessionManager.buildSessionContext().messages.length > 0,
			modelRegistry,
			settingsManager,
		);
		diagnostics.push(...sessionOptionDiagnostics);

		applyRuntimeApiKey(context.parsed, sessionOptions, context.authStorage, diagnostics);

		const created = await createAgentSessionFromServices({
			services,
			sessionManager,
			sessionStartEvent,
			model: sessionOptions.model,
			thinkingLevel: sessionOptions.thinkingLevel,
			scopedModels: sessionOptions.scopedModels,
			tools: sessionOptions.tools,
			excludeTools: sessionOptions.excludeTools,
			noTools: sessionOptions.noTools,
			customTools: sessionOptions.customTools,
		});
		applyCliThinkingOverride(created, context.parsed, cliThinkingFromModel);

		return {
			...created,
			services,
			diagnostics,
		};
	};
}
