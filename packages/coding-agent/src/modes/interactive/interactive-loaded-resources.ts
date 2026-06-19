/**
 * Startup loaded-resources UI (reduces showLoadedResources cognitive complexity).
 */

import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import type { AgentSession } from "../../core/agent-session.ts";
import type { ResourceDiagnostic } from "../../core/resource-loader.ts";
import type { SourceInfo } from "../../core/source-info.ts";
import type { SettingsManager } from "../../core/settings-manager.ts";
import {
	buildScopeGroups,
	formatContextPath,
	formatDiagnostics,
	formatDisplayPath,
	formatExtensionDisplayPath,
	formatScopeGroups,
	getBuiltInCommandConflictDiagnostics,
	getCompactExtensionLabels,
	getCompactPathLabel,
	getShortPath,
} from "./interactive-resource-display.ts";
import { theme, type ThemeColor } from "./theme/theme.ts";

export interface ExpandableTextLike {
	new (
		getCollapsedText: () => string,
		getExpandedText: () => string,
		expanded: boolean,
		paddingX: number,
		paddingY: number,
	): { setExpanded(expanded: boolean): void };
}

export interface ShowLoadedResourcesParams {
	chatContainer: Container;
	session: AgentSession;
	settingsManager: SettingsManager;
	cwd: string;
	options: { verbose?: boolean };
	toolOutputExpanded: boolean;
	getStartupExpansionState: () => boolean;
	ExpandableText: ExpandableTextLike;
	extensionsOverride?: Array<{ path: string; sourceInfo?: SourceInfo }>;
	force?: boolean;
	showDiagnosticsWhenQuiet?: boolean;
}

function collectSourceInfos(
	extensions: Array<{ path: string; sourceInfo?: SourceInfo }>,
	skills: Array<{ filePath: string; sourceInfo?: SourceInfo }>,
	prompts: Array<{ filePath: string; sourceInfo?: SourceInfo }>,
	themes: Array<{ sourcePath?: string; sourceInfo?: SourceInfo }>,
): Map<string, SourceInfo> {
	const sourceInfos = new Map<string, SourceInfo>();
	for (const extension of extensions) {
		if (extension.sourceInfo) {
			sourceInfos.set(extension.path, extension.sourceInfo);
		}
	}
	for (const skill of skills) {
		if (skill.sourceInfo) {
			sourceInfos.set(skill.filePath, skill.sourceInfo);
		}
	}
	for (const prompt of prompts) {
		if (prompt.sourceInfo) {
			sourceInfos.set(prompt.filePath, prompt.sourceInfo);
		}
	}
	for (const loadedTheme of themes) {
		if (loadedTheme.sourcePath && loadedTheme.sourceInfo) {
			sourceInfos.set(loadedTheme.sourcePath, loadedTheme.sourceInfo);
		}
	}
	return sourceInfos;
}

function appendListingSections(params: ShowLoadedResourcesParams, sourceInfos: Map<string, SourceInfo>): void {
	const {
		chatContainer,
		session,
		cwd,
		getStartupExpansionState,
		ExpandableText,
	} = params;

	const sectionHeader = (name: string, color: ThemeColor = "mdHeading") => theme.fg(color, `[${name}]`);
	const formatCompactList = (items: string[], listOptions?: { sort?: boolean }): string => {
		const labels = items.map((item) => item.trim()).filter((item) => item.length > 0);
		if (listOptions?.sort !== false) {
			labels.sort((a, b) => a.localeCompare(b));
		}
		return theme.fg("dim", `  ${labels.join(", ")}`);
	};
	const addLoadedSection = (
		name: string,
		collapsedBody: string,
		expandedBody = collapsedBody,
		color: ThemeColor = "mdHeading",
	): void => {
		const section = new ExpandableText(
			() => `${sectionHeader(name, color)}\n${collapsedBody}`,
			() => `${sectionHeader(name, color)}\n${expandedBody}`,
			getStartupExpansionState(),
			0,
			0,
		);
		chatContainer.addChild(section);
		chatContainer.addChild(new Spacer(1));
	};

	const skillsResult = session.resourceLoader.getSkills();
	const themesResult = session.resourceLoader.getThemes();
	const extensions =
		params.extensionsOverride ??
		session.resourceLoader.getExtensions().extensions.map((extension) => ({
			path: extension.path,
			sourceInfo: extension.sourceInfo,
		}));

	const contextFiles = session.resourceLoader.getAgentsFiles().agentsFiles;
	if (contextFiles.length > 0) {
		chatContainer.addChild(new Spacer(1));
		const contextList = contextFiles.map((f) => theme.fg("dim", `  ${formatDisplayPath(f.path)}`)).join("\n");
		const contextCompactList = formatCompactList(
			contextFiles.map((contextFile) => formatContextPath(cwd, contextFile.path)),
			{ sort: false },
		);
		addLoadedSection("Context", contextCompactList, contextList);
	}

	const skills = skillsResult.skills;
	if (skills.length > 0) {
		const groups = buildScopeGroups(skills.map((skill) => ({ path: skill.filePath, sourceInfo: skill.sourceInfo })));
		const skillList = formatScopeGroups(groups, {
			formatPath: (item) => formatDisplayPath(item.path),
			formatPackagePath: (item) => getShortPath(item.path, item.sourceInfo),
		});
		const skillCompactList = formatCompactList(skills.map((skill) => skill.name));
		addLoadedSection("Skills", skillCompactList, skillList);
	}

	const templates = session.promptTemplates;
	if (templates.length > 0) {
		const groups = buildScopeGroups(
			templates.map((template) => ({ path: template.filePath, sourceInfo: template.sourceInfo })),
		);
		const templateByPath = new Map(templates.map((t) => [t.filePath, t]));
		const templateList = formatScopeGroups(groups, {
			formatPath: (item) => {
				const template = templateByPath.get(item.path);
				return template ? `/${template.name}` : formatDisplayPath(item.path);
			},
			formatPackagePath: (item) => {
				const template = templateByPath.get(item.path);
				return template ? `/${template.name}` : formatDisplayPath(item.path);
			},
		});
		const promptCompactList = formatCompactList(templates.map((template) => `/${template.name}`));
		addLoadedSection("Prompts", promptCompactList, templateList);
	}

	if (extensions.length > 0) {
		const groups = buildScopeGroups(extensions);
		const extList = formatScopeGroups(groups, {
			formatPath: (item) => formatExtensionDisplayPath(item.path),
			formatPackagePath: (item) => formatExtensionDisplayPath(getShortPath(item.path, item.sourceInfo)),
		});
		const extensionCompactList = formatCompactList(getCompactExtensionLabels(extensions));
		addLoadedSection("Extensions", extensionCompactList, extList, "mdHeading");
	}

	const loadedThemes = themesResult.themes;
	const customThemes = loadedThemes.filter((t) => t.sourcePath);
	if (customThemes.length > 0) {
		const groups = buildScopeGroups(
			customThemes.map((loadedTheme) => ({
				path: loadedTheme.sourcePath!,
				sourceInfo: loadedTheme.sourceInfo,
			})),
		);
		const themeList = formatScopeGroups(groups, {
			formatPath: (item) => formatDisplayPath(item.path),
			formatPackagePath: (item) => getShortPath(item.path, item.sourceInfo),
		});
		const themeCompactList = formatCompactList(
			customThemes.map(
				(loadedTheme) => loadedTheme.name ?? getCompactPathLabel(loadedTheme.sourcePath!, loadedTheme.sourceInfo),
			),
		);
		addLoadedSection("Themes", themeCompactList, themeList);
	}
}

function appendDiagnosticsSections(params: ShowLoadedResourcesParams, sourceInfos: Map<string, SourceInfo>): void {
	const { chatContainer, session } = params;
	const skillsResult = session.resourceLoader.getSkills();
	const promptsResult = session.resourceLoader.getPrompts();
	const themesResult = session.resourceLoader.getThemes();

	const appendDiagnosticBlock = (title: string, diagnostics: readonly ResourceDiagnostic[]): void => {
		if (diagnostics.length === 0) return;
		const warningLines = formatDiagnostics(diagnostics, sourceInfos);
		chatContainer.addChild(new Text(`${theme.fg("warning", title)}\n${warningLines}`, 0, 0));
		chatContainer.addChild(new Spacer(1));
	};

	appendDiagnosticBlock("[Skill conflicts]", skillsResult.diagnostics);
	appendDiagnosticBlock("[Prompt conflicts]", promptsResult.diagnostics);

	const extensionDiagnostics: ResourceDiagnostic[] = [];
	const extensionErrors = session.resourceLoader.getExtensions().errors;
	for (const error of extensionErrors) {
		extensionDiagnostics.push({ type: "error", message: error.error, path: error.path });
	}
	extensionDiagnostics.push(...session.extensionRunner.getCommandDiagnostics());
	extensionDiagnostics.push(...getBuiltInCommandConflictDiagnostics(session.extensionRunner));
	extensionDiagnostics.push(...session.extensionRunner.getShortcutDiagnostics());
	appendDiagnosticBlock("[Extension issues]", extensionDiagnostics);

	appendDiagnosticBlock("[Theme conflicts]", themesResult.diagnostics);
}

export function showLoadedResourcesInChat(params: ShowLoadedResourcesParams): void {
	const showListing =
		params.force || params.options.verbose || !params.settingsManager.getQuietStartup();
	const showDiagnostics = showListing || params.showDiagnosticsWhenQuiet === true;
	if (!showListing && !showDiagnostics) {
		return;
	}

	const skillsResult = params.session.resourceLoader.getSkills();
	const promptsResult = params.session.resourceLoader.getPrompts();
	const themesResult = params.session.resourceLoader.getThemes();
	const extensions =
		params.extensionsOverride ??
		params.session.resourceLoader.getExtensions().extensions.map((extension) => ({
			path: extension.path,
			sourceInfo: extension.sourceInfo,
		}));
	const sourceInfos = collectSourceInfos(
		extensions,
		skillsResult.skills,
		promptsResult.prompts,
		themesResult.themes,
	);

	if (showListing) {
		appendListingSections(params, sourceInfos);
	}
	if (showDiagnostics) {
		appendDiagnosticsSections(params, sourceInfos);
	}
}
