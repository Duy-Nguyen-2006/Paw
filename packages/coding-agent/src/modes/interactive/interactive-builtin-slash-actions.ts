/**
 * Builtin slash command table for interactive mode (reduces buildBuiltinSlashActions S3776).
 */

import type { SlashCommandAction } from "./interactive-slash-dispatch.ts";

export interface BuiltinSlashActionDeps {
	showSettingsSelector: () => void;
	handleShareCommand: () => Promise<void>;
	handleCopyCommand: () => Promise<void>;
	handleSessionCommand: () => void;
	handleChangelogCommand: () => void;
	handleHotkeysCommand: () => void;
	showUserMessageSelector: () => void;
	showTreeSelector: (initialSelectedId?: string) => void;
	showTrustSelector: () => void;
	showOAuthSelector: (mode: "login" | "logout") => void;
	handleDebugCommand: () => void;
	handleArminSaysHi: () => void;
	handleDementedDelves: () => void;
	showSessionSelector: () => void;
	showModelsSelector: () => Promise<void>;
	handleCloneCommand: () => Promise<void>;
	handleClearCommand: () => Promise<void>;
	handleReloadCommand: () => Promise<void>;
	shutdown: () => Promise<void>;
	handleModelCommand: (searchTerm?: string) => Promise<void>;
	handleExportCommand: (text: string) => Promise<void>;
	handleImportCommand: (text: string) => Promise<void>;
	handleNameCommand: (text: string) => void;
	handleCompactCommand: (customInstructions?: string) => Promise<void>;
}

export function buildInteractiveBuiltinSlashActions(deps: BuiltinSlashActionDeps): {
	exact: Record<string, SlashCommandAction>;
	prefix: Array<{ prefix: string; action: SlashCommandAction }>;
} {
	const exact: Record<string, SlashCommandAction> = {
		"/settings": { kind: "sync", run: () => deps.showSettingsSelector() },
		"/share": { kind: "async", run: () => deps.handleShareCommand() },
		"/copy": { kind: "async", run: () => deps.handleCopyCommand() },
		"/session": { kind: "sync", run: () => deps.handleSessionCommand() },
		"/changelog": { kind: "sync", run: () => deps.handleChangelogCommand() },
		"/hotkeys": { kind: "sync", run: () => deps.handleHotkeysCommand() },
		"/fork": { kind: "sync", run: () => deps.showUserMessageSelector() },
		"/tree": { kind: "sync", run: () => deps.showTreeSelector() },
		"/trust": { kind: "sync", run: () => deps.showTrustSelector() },
		"/login": { kind: "sync", run: () => deps.showOAuthSelector("login") },
		"/logout": { kind: "sync", run: () => deps.showOAuthSelector("logout") },
		"/debug": { kind: "sync", run: () => deps.handleDebugCommand() },
		"/arminsayshi": { kind: "sync", run: () => deps.handleArminSaysHi() },
		"/dementedelves": { kind: "sync", run: () => deps.handleDementedDelves() },
		"/resume": { kind: "sync", run: () => deps.showSessionSelector() },
		"/scoped-models": { kind: "async", run: () => deps.showModelsSelector() },
		"/clone": { kind: "async", run: () => deps.handleCloneCommand() },
		"/new": { kind: "async", run: () => deps.handleClearCommand() },
		"/reload": { kind: "async", run: () => deps.handleReloadCommand() },
		"/quit": { kind: "async", run: () => deps.shutdown() },
	};
	const prefix: Array<{ prefix: string; action: SlashCommandAction }> = [
		{
			prefix: "/model",
			action: {
				kind: "prefix",
				prefix: "/model",
				run: (arg) => deps.handleModelCommand(arg || undefined),
			},
		},
		{
			prefix: "/export",
			action: { kind: "asyncWithText", run: (t) => deps.handleExportCommand(t) },
		},
		{
			prefix: "/import",
			action: { kind: "asyncWithText", run: (t) => deps.handleImportCommand(t) },
		},
		{
			prefix: "/name",
			action: { kind: "syncWithText", run: (t) => deps.handleNameCommand(t) },
		},
		{
			prefix: "/compact",
			action: {
				kind: "prefix",
				prefix: "/compact",
				run: (arg) => deps.handleCompactCommand(arg || undefined),
			},
		},
	];
	return { exact, prefix };
}
