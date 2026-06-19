/**
 * CLI startup / mode helpers (extracted from main.ts for S3776).
 */

import chalk from "chalk";
import type { Args, Mode } from "./cli/args.ts";
import type { AppMode } from "./core/project-trust.ts";
import { exportFromFile } from "./core/export-html/index.ts";

export function isTruthyEnvFlag(value: string | undefined): boolean {
	if (!value) return false;
	return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

export function resolveAppMode(parsed: Args, stdinIsTTY: boolean, stdoutIsTTY: boolean): AppMode {
	if (parsed.mode === "rpc") {
		return "rpc";
	}
	if (parsed.mode === "json") {
		return "json";
	}
	if (parsed.print || !stdinIsTTY || !stdoutIsTTY) {
		return "print";
	}
	return "interactive";
}

export function toPrintOutputMode(appMode: AppMode): Exclude<Mode, "rpc"> {
	return appMode === "json" ? "json" : "text";
}

export function isPlainRuntimeMetadataCommand(parsed: Args): boolean {
	return !parsed.print && parsed.mode === undefined && (parsed.help === true || parsed.listModels !== undefined);
}

export function applyOfflineMode(args: string[]): void {
	const offlineMode = args.includes("--offline") || isTruthyEnvFlag(process.env.PI_OFFLINE);
	if (!offlineMode) return;
	process.env.PI_OFFLINE = "1";
	process.env.PI_SKIP_VERSION_CHECK = "1";
}

export function reportDiagnosticsAndMaybeExit(diagnostics: Array<{ type: "warning" | "error"; message: string }>): boolean {
	for (const d of diagnostics) {
		const color = d.type === "error" ? chalk.red : chalk.yellow;
		console.error(color(`${d.type === "error" ? "Error" : "Warning"}: ${d.message}`));
	}
	if (diagnostics.some((d) => d.type === "error")) {
		process.exit(1);
		return false;
	}
	return true;
}

export async function exportSessionAndExit(exportPath: string, messages: string[]): Promise<void> {
	try {
		const outputPath = messages.length > 0 ? messages[0] : undefined;
		const result = await exportFromFile(exportPath, outputPath);
		console.log(`Exported to: ${result}`);
		process.exit(0);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : "Failed to export session";
		console.error(chalk.red(`Error: ${message}`));
		process.exit(1);
	}
}

export function shouldRunFirstTimeSetupCheck(
	appMode: string,
	parsed: { help?: boolean; listModels?: string | true },
	shouldRunFirstTimeSetup: () => boolean,
): boolean {
	return appMode === "interactive" && !parsed.help && parsed.listModels === undefined && shouldRunFirstTimeSetup();
}
