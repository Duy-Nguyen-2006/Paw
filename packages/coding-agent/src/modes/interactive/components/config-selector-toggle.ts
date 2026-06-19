/**
 * Resource enable/disable persistence (reduces ResourceList.toggle* complexity).
 */

import { dirname, join, relative } from "node:path";
import { CONFIG_DIR_NAME } from "../../../config.ts";
import type { PackageSource, SettingsManager } from "../../../core/settings-manager.ts";

export type ConfigResourceType = "extensions" | "skills" | "prompts" | "themes";

export interface ConfigToggleResourceItem {
	path: string;
	resourceType: ConfigResourceType;
	metadata: {
		origin: "package" | "top-level";
		scope: string;
		source: string;
		baseDir?: string;
	};
}

const RESOURCE_ARRAY_KEYS = ["extensions", "skills", "prompts", "themes"] as const;

function stripPatternPrefix(p: string): string {
	return p.startsWith("!") || p.startsWith("+") || p.startsWith("-") ? p.slice(1) : p;
}

function applyEnableDisablePatterns(current: string[], pattern: string, enabled: boolean): string[] {
	const updated = current.filter((p) => stripPatternPrefix(p) !== pattern);
	updated.push(enabled ? `+${pattern}` : `-${pattern}`);
	return updated;
}

function persistTopLevelPaths(
	settingsManager: SettingsManager,
	scope: "user" | "project",
	arrayKey: ConfigResourceType,
	updated: string[],
): void {
	if (scope === "project") {
		if (arrayKey === "extensions") settingsManager.setProjectExtensionPaths(updated);
		else if (arrayKey === "skills") settingsManager.setProjectSkillPaths(updated);
		else if (arrayKey === "prompts") settingsManager.setProjectPromptTemplatePaths(updated);
		else settingsManager.setProjectThemePaths(updated);
		return;
	}
	if (arrayKey === "extensions") settingsManager.setExtensionPaths(updated);
	else if (arrayKey === "skills") settingsManager.setSkillPaths(updated);
	else if (arrayKey === "prompts") settingsManager.setPromptTemplatePaths(updated);
	else settingsManager.setThemePaths(updated);
}

export function getTopLevelResourceBaseDir(cwd: string, agentDir: string, scope: "user" | "project"): string {
	return scope === "project" ? join(cwd, CONFIG_DIR_NAME) : agentDir;
}

export function getTopLevelResourcePattern(
	item: ConfigToggleResourceItem,
	cwd: string,
	agentDir: string,
): string {
	const scope = item.metadata.scope as "user" | "project";
	const baseDir = item.metadata.baseDir ?? getTopLevelResourceBaseDir(cwd, agentDir, scope);
	return relative(baseDir, item.path);
}

export function getPackageResourcePattern(item: ConfigToggleResourceItem): string {
	const baseDir = item.metadata.baseDir ?? dirname(item.path);
	return relative(baseDir, item.path);
}

export function toggleTopLevelResourceInSettings(
	settingsManager: SettingsManager,
	item: ConfigToggleResourceItem,
	enabled: boolean,
	cwd: string,
	agentDir: string,
): void {
	const scope = item.metadata.scope as "user" | "project";
	const settings =
		scope === "project" ? settingsManager.getProjectSettings() : settingsManager.getGlobalSettings();
	const arrayKey = item.resourceType;
	const current = settings[arrayKey] ?? [];
	const pattern = getTopLevelResourcePattern(item, cwd, agentDir);
	const updated = applyEnableDisablePatterns(current, pattern, enabled);
	persistTopLevelPaths(settingsManager, scope, arrayKey, updated);
}

export function togglePackageResourceInSettings(
	settingsManager: SettingsManager,
	item: ConfigToggleResourceItem,
	enabled: boolean,
): void {
	const scope = item.metadata.scope as "user" | "project";
	const settings =
		scope === "project" ? settingsManager.getProjectSettings() : settingsManager.getGlobalSettings();

	const packages = [...(settings.packages ?? [])] as PackageSource[];
	const pkgIndex = packages.findIndex((pkg) => {
		const source = typeof pkg === "string" ? pkg : pkg.source;
		return source === item.metadata.source;
	});
	if (pkgIndex === -1) return;

	let pkg = packages[pkgIndex];
	if (typeof pkg === "string") {
		pkg = { source: pkg };
		packages[pkgIndex] = pkg;
	}

	const arrayKey = item.resourceType;
	const current = pkg[arrayKey] ?? [];
	const pattern = getPackageResourcePattern(item);
	const updated = applyEnableDisablePatterns(current, pattern, enabled);

	(pkg as Record<string, unknown>)[arrayKey] = updated.length > 0 ? updated : undefined;

	const hasFilters = RESOURCE_ARRAY_KEYS.some((k) => (pkg as Record<string, unknown>)[k] !== undefined);
	if (!hasFilters) {
		packages[pkgIndex] = (pkg as { source: string }).source;
	}

	if (scope === "project") {
		settingsManager.setProjectPackages(packages);
	} else {
		settingsManager.setPackages(packages);
	}
}

export function toggleConfigResource(
	settingsManager: SettingsManager,
	item: ConfigToggleResourceItem,
	enabled: boolean,
	cwd: string,
	agentDir: string,
): void {
	if (item.metadata.origin === "top-level") {
		toggleTopLevelResourceInSettings(settingsManager, item, enabled, cwd, agentDir);
	} else {
		togglePackageResourceInSettings(settingsManager, item, enabled);
	}
}
