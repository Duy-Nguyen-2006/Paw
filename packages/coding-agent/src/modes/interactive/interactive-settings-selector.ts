/**
 * Settings selector configuration and callbacks for interactive mode
 * (reduces showSettingsSelector S3776 cognitive complexity).
 */

import type { Container, EditorComponent, TUI } from "@earendil-works/pi-tui";
import type { AgentSession } from "../../core/agent-session.ts";
import { configureHttpDispatcher, formatHttpIdleTimeoutMs } from "../../core/http-dispatcher.ts";
import type { SettingsManager } from "../../core/settings-manager.ts";
import type { CustomEditor } from "./components/custom-editor.ts";
import type { SettingsCallbacks, SettingsConfig } from "./components/settings-selector.ts";
import { ToolExecutionComponent } from "./components/tool-execution.ts";
import { getAvailableThemes, setTheme } from "./theme/theme.ts";

export interface SettingsSelectorDeps {
	session: AgentSession;
	settingsManager: SettingsManager;
	chatContainer: Container;
	defaultEditor: CustomEditor;
	editor: EditorComponent;
	ui: TUI;
	footer: { setAutoCompactEnabled(enabled: boolean): void; invalidate(): void };
	hideThinkingBlock: boolean;
	setupAutocompleteProvider: () => void;
	showError: (message: string) => void;
	showStatus: (message: string) => void;
	updateEditorBorderColor: () => void;
	onHideThinkingBlockChange: (hidden: boolean) => void;
	onCancel: () => void;
}

export function buildSettingsSelectorConfig(deps: SettingsSelectorDeps): SettingsConfig {
	const { session, settingsManager, hideThinkingBlock } = deps;
	return {
		autoCompact: session.autoCompactionEnabled,
		showImages: settingsManager.getShowImages(),
		imageWidthCells: settingsManager.getImageWidthCells(),
		autoResizeImages: settingsManager.getImageAutoResize(),
		blockImages: settingsManager.getBlockImages(),
		enableSkillCommands: settingsManager.getEnableSkillCommands(),
		steeringMode: session.steeringMode,
		followUpMode: session.followUpMode,
		transport: settingsManager.getTransport(),
		httpIdleTimeoutMs: settingsManager.getHttpIdleTimeoutMs(),
		thinkingLevel: session.thinkingLevel,
		availableThinkingLevels: session.getAvailableThinkingLevels(),
		currentTheme: settingsManager.getTheme() || "dark",
		availableThemes: getAvailableThemes(),
		hideThinkingBlock,
		collapseChangelog: settingsManager.getCollapseChangelog(),
		enableInstallTelemetry: settingsManager.getEnableInstallTelemetry(),
		doubleEscapeAction: settingsManager.getDoubleEscapeAction(),
		treeFilterMode: settingsManager.getTreeFilterMode(),
		showHardwareCursor: settingsManager.getShowHardwareCursor(),
		defaultProjectTrust: settingsManager.getDefaultProjectTrust(),
		editorPaddingX: settingsManager.getEditorPaddingX(),
		autocompleteMaxVisible: settingsManager.getAutocompleteMaxVisible(),
		quietStartup: settingsManager.getQuietStartup(),
		clearOnShrink: settingsManager.getClearOnShrink(),
		showTerminalProgress: settingsManager.getShowTerminalProgress(),
		warnings: settingsManager.getWarnings(),
	};
}

function buildSessionAndFooterCallbacks(
	deps: SettingsSelectorDeps,
): Pick<
	SettingsCallbacks,
	| "onAutoCompactChange"
	| "onSteeringModeChange"
	| "onFollowUpModeChange"
	| "onTransportChange"
	| "onThinkingLevelChange"
> {
	const { session, footer } = deps;
	return {
		onAutoCompactChange: (enabled) => {
			session.setAutoCompactionEnabled(enabled);
			footer.setAutoCompactEnabled(enabled);
		},
		onSteeringModeChange: (mode) => {
			session.setSteeringMode(mode);
		},
		onFollowUpModeChange: (mode) => {
			session.setFollowUpMode(mode);
		},
		onTransportChange: (transport) => {
			deps.settingsManager.setTransport(transport);
			session.agent.transport = transport;
		},
		onThinkingLevelChange: (level) => {
			session.setThinkingLevel(level);
			deps.footer.invalidate();
			deps.updateEditorBorderColor();
		},
	};
}

function buildImageCallbacks(
	deps: SettingsSelectorDeps,
): Pick<
	SettingsCallbacks,
	"onShowImagesChange" | "onImageWidthCellsChange" | "onAutoResizeImagesChange" | "onBlockImagesChange"
> {
	const { settingsManager, chatContainer } = deps;
	return {
		onShowImagesChange: (enabled) => {
			settingsManager.setShowImages(enabled);
			for (const child of chatContainer.children) {
				if (child instanceof ToolExecutionComponent) {
					child.setShowImages(enabled);
				}
			}
		},
		onImageWidthCellsChange: (width) => {
			settingsManager.setImageWidthCells(width);
			for (const child of chatContainer.children) {
				if (child instanceof ToolExecutionComponent) {
					child.setImageWidthCells(width);
				}
			}
		},
		onAutoResizeImagesChange: (enabled) => {
			settingsManager.setImageAutoResize(enabled);
		},
		onBlockImagesChange: (blocked) => {
			settingsManager.setBlockImages(blocked);
		},
	};
}

function buildEditorCallbacks(
	deps: SettingsSelectorDeps,
): Pick<
	SettingsCallbacks,
	"onEditorPaddingXChange" | "onAutocompleteMaxVisibleChange" | "onClearOnShrinkChange" | "onShowHardwareCursorChange"
> {
	const { settingsManager, defaultEditor, editor } = deps;
	return {
		onEditorPaddingXChange: (padding) => {
			settingsManager.setEditorPaddingX(padding);
			defaultEditor.setPaddingX(padding);
			if (editor !== defaultEditor && editor.setPaddingX !== undefined) {
				editor.setPaddingX(padding);
			}
		},
		onAutocompleteMaxVisibleChange: (maxVisible) => {
			settingsManager.setAutocompleteMaxVisible(maxVisible);
			defaultEditor.setAutocompleteMaxVisible(maxVisible);
			if (editor !== defaultEditor && editor.setAutocompleteMaxVisible !== undefined) {
				editor.setAutocompleteMaxVisible(maxVisible);
			}
		},
		onClearOnShrinkChange: (enabled) => {
			settingsManager.setClearOnShrink(enabled);
			deps.ui.setClearOnShrink(enabled);
		},
		onShowHardwareCursorChange: (enabled) => {
			settingsManager.setShowHardwareCursor(enabled);
			deps.ui.setShowHardwareCursor(enabled);
		},
	};
}

function buildThemeCallbacks(deps: SettingsSelectorDeps): Pick<SettingsCallbacks, "onThemeChange" | "onThemePreview"> {
	return {
		onThemeChange: (themeName) => {
			const result = setTheme(themeName, true);
			deps.settingsManager.setTheme(themeName);
			deps.ui.invalidate();
			if (!result.success) {
				deps.showError(`Failed to load theme "${themeName}": ${result.error}\nFell back to dark theme.`);
			}
		},
		onThemePreview: (themeName) => {
			const result = setTheme(themeName, true);
			if (result.success) {
				deps.ui.invalidate();
				deps.ui.requestRender();
			}
		},
	};
}

function buildMiscSettingsCallbacks(
	deps: SettingsSelectorDeps,
): Pick<
	SettingsCallbacks,
	| "onEnableSkillCommandsChange"
	| "onHttpIdleTimeoutMsChange"
	| "onHideThinkingBlockChange"
	| "onCollapseChangelogChange"
	| "onEnableInstallTelemetryChange"
	| "onQuietStartupChange"
	| "onDefaultProjectTrustChange"
	| "onDoubleEscapeActionChange"
	| "onTreeFilterModeChange"
	| "onShowTerminalProgressChange"
	| "onWarningsChange"
> {
	const { settingsManager } = deps;
	return {
		onEnableSkillCommandsChange: (enabled) => {
			settingsManager.setEnableSkillCommands(enabled);
			deps.setupAutocompleteProvider();
		},
		onHttpIdleTimeoutMsChange: (timeoutMs) => {
			settingsManager.setHttpIdleTimeoutMs(timeoutMs);
			configureHttpDispatcher(timeoutMs);
			deps.showStatus(`HTTP idle timeout: ${formatHttpIdleTimeoutMs(timeoutMs)}`);
		},
		onHideThinkingBlockChange: (hidden) => {
			deps.onHideThinkingBlockChange(hidden);
		},
		onCollapseChangelogChange: (collapsed) => {
			settingsManager.setCollapseChangelog(collapsed);
		},
		onEnableInstallTelemetryChange: (enabled) => {
			settingsManager.setEnableInstallTelemetry(enabled);
		},
		onQuietStartupChange: (enabled) => {
			settingsManager.setQuietStartup(enabled);
		},
		onDefaultProjectTrustChange: (defaultProjectTrust) => {
			settingsManager.setDefaultProjectTrust(defaultProjectTrust);
		},
		onDoubleEscapeActionChange: (action) => {
			settingsManager.setDoubleEscapeAction(action);
		},
		onTreeFilterModeChange: (mode) => {
			settingsManager.setTreeFilterMode(mode);
		},
		onShowTerminalProgressChange: (enabled) => {
			settingsManager.setShowTerminalProgress(enabled);
		},
		onWarningsChange: (warnings) => {
			settingsManager.setWarnings(warnings);
		},
	};
}

export function buildSettingsSelectorCallbacks(deps: SettingsSelectorDeps): SettingsCallbacks {
	return {
		...buildSessionAndFooterCallbacks(deps),
		...buildImageCallbacks(deps),
		...buildEditorCallbacks(deps),
		...buildThemeCallbacks(deps),
		...buildMiscSettingsCallbacks(deps),
		onCancel: () => {
			deps.onCancel();
		},
	};
}
