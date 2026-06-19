/**
 * Tree navigation after user picks an entry (reduces showTreeSelector S3776).
 */

import type { Container, TUI } from "@earendil-works/pi-tui";
import { Loader, Spacer } from "@earendil-works/pi-tui";
import type { AgentSession } from "../../core/agent-session.ts";
import type { SettingsManager } from "../../core/settings-manager.ts";
import type { CustomEditor } from "./components/custom-editor.ts";
import { keyText } from "./components/keybinding-hints.ts";
import { resolveTreeNavigationSummary } from "./interactive-tree-navigation.ts";
import { theme } from "./theme/theme.ts";

export interface RunTreeNavigationDeps {
	session: AgentSession;
	settingsManager: SettingsManager;
	chatContainer: Container;
	statusContainer: Container;
	defaultEditor: CustomEditor;
	ui: TUI;
	editor: { getText(): string; setText(text: string): void };
	showStatus: (message: string) => void;
	showError: (message: string) => void;
	showExtensionSelector: (title: string, options: string[]) => Promise<string | undefined>;
	showExtensionEditor: (title: string) => Promise<string | undefined>;
	showTreeSelector: (initialSelectedId?: string) => void;
	renderInitialMessages: () => void;
	flushCompactionQueue: (opts: { willRetry: boolean }) => Promise<void>;
}

export async function runInteractiveTreeNavigation(entryId: string, deps: RunTreeNavigationDeps): Promise<void> {
	const summary = await resolveTreeNavigationSummary(entryId, {
		getBranchSummarySkipPrompt: () => deps.settingsManager.getBranchSummarySkipPrompt(),
		showSummarySelector: () =>
			deps.showExtensionSelector("Summarize branch?", ["No summary", "Summarize", "Summarize with custom prompt"]),
		showCustomInstructionsEditor: () => deps.showExtensionEditor("Custom summarization instructions"),
		onReturnToTree: (id) => deps.showTreeSelector(id),
	});
	if (summary.cancelledToTree) {
		return;
	}
	const wantsSummary = summary.wantsSummary;
	const customInstructions = summary.customInstructions;

	let summaryLoader: Loader | undefined;
	const originalOnEscape = deps.defaultEditor.onEscape;

	if (wantsSummary) {
		deps.defaultEditor.onEscape = () => {
			deps.session.abortBranchSummary();
		};
		deps.chatContainer.addChild(new Spacer(1));
		summaryLoader = new Loader(
			deps.ui,
			(spinner) => theme.fg("accent", spinner),
			(text) => theme.fg("muted", text),
			`Summarizing branch... (${keyText("app.interrupt")} to cancel)`,
		);
		deps.statusContainer.addChild(summaryLoader);
		deps.ui.requestRender();
	}

	try {
		const result = await deps.session.navigateTree(entryId, {
			summarize: wantsSummary,
			customInstructions,
		});

		if (result.aborted) {
			deps.showStatus("Branch summarization cancelled");
			deps.showTreeSelector(entryId);
			return;
		}
		if (result.cancelled) {
			deps.showStatus("Navigation cancelled");
			return;
		}

		deps.chatContainer.clear();
		deps.renderInitialMessages();
		if (result.editorText && !deps.editor.getText().trim()) {
			deps.editor.setText(result.editorText);
		}
		deps.showStatus("Navigated to selected point");
		await deps.flushCompactionQueue({ willRetry: false });
	} catch (error) {
		deps.showError(error instanceof Error ? error.message : String(error));
	} finally {
		if (summaryLoader) {
			summaryLoader.stop();
			deps.statusContainer.clear();
		}
		deps.defaultEditor.onEscape = originalOnEscape;
	}
}

export function treeNavigationNoOpStatus(entryId: string, realLeafId: string | null): "already-here" | "continue" {
	if (realLeafId !== null && entryId === realLeafId) {
		return "already-here";
	}
	return "continue";
}
