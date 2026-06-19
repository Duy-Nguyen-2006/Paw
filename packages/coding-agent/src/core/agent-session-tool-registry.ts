/**
 * Tool definition registry rebuild helpers (reduces AgentSession._refreshToolRegistry S3776).
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ExtensionRunner, RegisteredTool, ToolDefinition } from "./extensions/index.ts";
import { wrapRegisteredTools } from "./extensions/index.ts";
import { createSyntheticSourceInfo, type SourceInfo } from "./source-info.ts";

export interface ToolDefinitionEntry {
	definition: ToolDefinition;
	sourceInfo: SourceInfo;
}

export interface ToolPromptMaps {
	snippets: Map<string, string>;
	guidelines: Map<string, string[]>;
}

export interface RefreshToolRegistryInput {
	baseToolDefinitions: Map<string, ToolDefinition>;
	customTools: ToolDefinition[];
	registeredTools: RegisteredTool[];
	allowedToolNames?: Set<string>;
	excludedToolNames?: Set<string>;
	normalizePromptSnippet: (text: string | undefined) => string | undefined;
	normalizePromptGuidelines: (guidelines: string[] | undefined) => string[];
	extensionRunner: ExtensionRunner;
}

export interface RefreshToolRegistryResult {
	definitionRegistry: Map<string, ToolDefinitionEntry>;
	toolRegistry: Map<string, AgentTool>;
	promptMaps: ToolPromptMaps;
	nextActiveToolNames: string[];
}

export function isToolAllowed(
	name: string,
	allowedToolNames: Set<string> | undefined,
	excludedToolNames: Set<string> | undefined,
): boolean {
	return (!allowedToolNames || allowedToolNames.has(name)) && !excludedToolNames?.has(name);
}

function buildCustomToolEntries(
	registeredTools: RegisteredTool[],
	customTools: ToolDefinition[],
	isAllowed: (name: string) => boolean,
): RegisteredTool[] {
	return [
		...registeredTools,
		...customTools.map((definition) => ({
			definition,
			sourceInfo: createSyntheticSourceInfo(`<sdk:${definition.name}>`, { source: "sdk" }),
		})),
	].filter((tool) => isAllowed(tool.definition.name));
}

function buildDefinitionRegistry(
	baseToolDefinitions: Map<string, ToolDefinition>,
	allCustomTools: RegisteredTool[],
	isAllowed: (name: string) => boolean,
): Map<string, ToolDefinitionEntry> {
	const definitionRegistry = new Map<string, ToolDefinitionEntry>(
		Array.from(baseToolDefinitions.entries())
			.filter(([name]) => isAllowed(name))
			.map(([name, definition]) => [
				name,
				{
					definition,
					sourceInfo: createSyntheticSourceInfo(`<builtin:${name}>`, { source: "builtin" }),
				},
			]),
	);
	for (const tool of allCustomTools) {
		definitionRegistry.set(tool.definition.name, {
			definition: tool.definition,
			sourceInfo: tool.sourceInfo,
		});
	}
	return definitionRegistry;
}

function buildPromptMaps(
	definitionRegistry: Map<string, ToolDefinitionEntry>,
	normalizePromptSnippet: (text: string | undefined) => string | undefined,
	normalizePromptGuidelines: (guidelines: string[] | undefined) => string[],
): ToolPromptMaps {
	const snippets = new Map(
		Array.from(definitionRegistry.values())
			.map(({ definition }) => {
				const snippet = normalizePromptSnippet(definition.promptSnippet);
				return snippet ? ([definition.name, snippet] as const) : undefined;
			})
			.filter((entry): entry is readonly [string, string] => entry !== undefined),
	);
	const guidelines = new Map(
		Array.from(definitionRegistry.values())
			.map(({ definition }) => {
				const normalized = normalizePromptGuidelines(definition.promptGuidelines);
				return normalized.length > 0 ? ([definition.name, normalized] as const) : undefined;
			})
			.filter((entry): entry is readonly [string, string[]] => entry !== undefined),
	);
	return { snippets, guidelines };
}

function buildAgentToolRegistry(
	baseToolDefinitions: Map<string, ToolDefinition>,
	allCustomTools: RegisteredTool[],
	isAllowed: (name: string) => boolean,
	runner: ExtensionRunner,
): Map<string, AgentTool> {
	const wrappedExtensionTools = wrapRegisteredTools(allCustomTools, runner);
	const wrappedBuiltInTools = wrapRegisteredTools(
		Array.from(baseToolDefinitions.values())
			.filter((definition) => isAllowed(definition.name))
			.map((definition) => ({
				definition,
				sourceInfo: createSyntheticSourceInfo(`<builtin:${definition.name}>`, { source: "builtin" }),
			})),
		runner,
	);

	const toolRegistry = new Map(wrappedBuiltInTools.map((tool) => [tool.name, tool]));
	for (const tool of wrappedExtensionTools as AgentTool[]) {
		toolRegistry.set(tool.name, tool);
	}
	return toolRegistry;
}

export function resolveNextActiveToolNames(options: {
	requestedActiveToolNames: string[] | undefined;
	previousActiveToolNames: string[];
	previousRegistryNames: Set<string>;
	allowedToolNames?: Set<string>;
	includeAllExtensionTools?: boolean;
	toolRegistry: Map<string, AgentTool>;
	wrappedExtensionTools: AgentTool[];
	isAllowed: (name: string) => boolean;
}): string[] {
	const nextActiveToolNames = (
		options.requestedActiveToolNames ? [...options.requestedActiveToolNames] : [...options.previousActiveToolNames]
	).filter((name) => options.isAllowed(name));

	if (options.allowedToolNames) {
		for (const toolName of options.toolRegistry.keys()) {
			if (options.allowedToolNames.has(toolName)) {
				nextActiveToolNames.push(toolName);
			}
		}
	} else if (options.includeAllExtensionTools) {
		for (const tool of options.wrappedExtensionTools) {
			nextActiveToolNames.push(tool.name);
		}
	} else if (!options.requestedActiveToolNames) {
		for (const toolName of options.toolRegistry.keys()) {
			if (!options.previousRegistryNames.has(toolName)) {
				nextActiveToolNames.push(toolName);
			}
		}
	}

	return [...new Set(nextActiveToolNames)];
}

export function rebuildToolRegistryStateWithActiveNames(
	input: RefreshToolRegistryInput,
	options: {
		activeToolNames?: string[];
		previousActiveToolNames: string[];
		previousRegistryNames: Set<string>;
		includeAllExtensionTools?: boolean;
	},
): RefreshToolRegistryResult {
	const isAllowed = (name: string) => isToolAllowed(name, input.allowedToolNames, input.excludedToolNames);

	const allCustomTools = buildCustomToolEntries(input.registeredTools, input.customTools, isAllowed);
	const definitionRegistry = buildDefinitionRegistry(input.baseToolDefinitions, allCustomTools, isAllowed);
	const promptMaps = buildPromptMaps(
		definitionRegistry,
		input.normalizePromptSnippet,
		input.normalizePromptGuidelines,
	);
	const wrappedExtensionTools = wrapRegisteredTools(allCustomTools, input.extensionRunner) as AgentTool[];
	const toolRegistry = buildAgentToolRegistry(
		input.baseToolDefinitions,
		allCustomTools,
		isAllowed,
		input.extensionRunner,
	);

	const nextActiveToolNames = resolveNextActiveToolNames({
		requestedActiveToolNames: options.activeToolNames,
		previousActiveToolNames: options.previousActiveToolNames,
		previousRegistryNames: options.previousRegistryNames,
		allowedToolNames: input.allowedToolNames,
		includeAllExtensionTools: options.includeAllExtensionTools,
		toolRegistry,
		wrappedExtensionTools,
		isAllowed,
	});

	return { definitionRegistry, toolRegistry, promptMaps, nextActiveToolNames };
}
