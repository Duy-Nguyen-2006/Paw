/**
 * Self-update helpers for package CLI (extracted from package-manager-cli.ts for S3776).
 */

import { Markdown, type MarkdownTheme } from "@earendil-works/pi-tui";
import chalk from "chalk";
import {
	APP_NAME,
	detectInstallMethod,
	getPackageDir,
	getSelfUpdateCommand,
	getSelfUpdateUnavailableInstruction,
	PACKAGE_NAME,
	type SelfUpdateCommand,
	VERSION,
} from "./config.ts";
import { spawnProcess } from "./utils/child-process.ts";
import { getLatestPiRelease, isNewerPackageVersion } from "./utils/version-check.ts";
import {
	cleanupWindowsSelfUpdateQuarantine,
	quarantineWindowsNativeDependencies,
} from "./utils/windows-self-update.ts";
import type { UpdateTarget } from "./package-manager-cli-parse.ts";
import { updateTargetIncludesSelf } from "./package-manager-cli-parse.ts";

const SELF_UPDATE_NOTE_MARKDOWN_THEME: MarkdownTheme = {
	heading: (text) => chalk.bold(chalk.yellow(text)),
	link: (text) => chalk.cyan(text),
	linkUrl: (text) => chalk.dim(text),
	code: (text) => chalk.yellow(text),
	codeBlock: (text) => chalk.dim(text),
	codeBlockBorder: (text) => chalk.dim(text),
	quote: (text) => chalk.dim(text),
	quoteBorder: (text) => chalk.dim(text),
	hr: (text) => chalk.dim(text),
	listBullet: (text) => chalk.yellow(text),
	bold: (text) => chalk.bold(text),
	italic: (text) => chalk.italic(text),
	strikethrough: (text) => chalk.strikethrough(text),
	underline: (text) => chalk.underline(text),
};

export function printSelfUpdateUnavailable(npmCommand?: string[], updatePackageName = PACKAGE_NAME): void {
	console.error(`error: ${APP_NAME} cannot self-update this installation.`);
	console.error(getSelfUpdateUnavailableInstruction(PACKAGE_NAME, npmCommand, updatePackageName));

	const entrypoint = process.argv[1];
	if (entrypoint) {
		console.error("");
		console.error(`Location of pi executable: ${entrypoint}`);
	}
}

export function printSelfUpdateFallback(command: SelfUpdateCommand): void {
	console.error(chalk.dim(`If this keeps failing, run this command yourself: ${command.display}`));
}

export function printSelfUpdateNote(note: string): void {
	const trimmedNote = note.trim();
	if (!trimmedNote) {
		return;
	}

	console.log();
	console.log(chalk.bold(chalk.yellow("Update note")));
	try {
		const width = Math.max(20, process.stdout.columns ?? 80);
		const renderedLines = new Markdown(trimmedNote, 0, 0, SELF_UPDATE_NOTE_MARKDOWN_THEME)
			.render(width)
			.map((line) => line.trimEnd());
		console.log(renderedLines.join("\n"));
	} catch {
		console.log(trimmedNote);
	}
	console.log();
}

interface SelfUpdatePlan {
	packageName: string;
	shouldRun: boolean;
	note?: string;
}

export async function getSelfUpdatePlan(force: boolean): Promise<SelfUpdatePlan> {
	if (force) {
		return { packageName: PACKAGE_NAME, shouldRun: true };
	}

	try {
		const latestRelease = await getLatestPiRelease(VERSION);
		const packageName = latestRelease?.packageName ?? PACKAGE_NAME;
		if (!latestRelease || packageName !== PACKAGE_NAME || isNewerPackageVersion(latestRelease.version, VERSION)) {
			return { packageName, shouldRun: true, ...(latestRelease?.note ? { note: latestRelease.note } : {}) };
		}
	} catch {
		return { packageName: PACKAGE_NAME, shouldRun: true };
	}

	console.log(chalk.green(`${APP_NAME} is already up to date (v${VERSION})`));
	return { packageName: PACKAGE_NAME, shouldRun: false };
}

export async function runSelfUpdate(command: SelfUpdateCommand): Promise<void> {
	console.log(chalk.dim(`Updating ${APP_NAME} with ${command.display}...`));
	for (const step of command.steps ?? [command]) {
		await new Promise<void>((resolve, reject) => {
			const child = spawnProcess(step.command, step.args, {
				stdio: "inherit",
			});
			child.on("error", (error) => {
				reject(error);
			});
			child.on("close", (code, signal) => {
				if (code === 0) {
					resolve();
				} else if (signal) {
					reject(new Error(`${step.display} terminated by signal ${signal}`));
				} else {
					reject(new Error(`${step.display} exited with code ${code ?? "unknown"}`));
				}
			});
		});
	}
}

export function prepareWindowsNpmSelfUpdate(): void {
	if (process.platform !== "win32") {
		return;
	}

	const packageDir = getPackageDir();
	cleanupWindowsSelfUpdateQuarantine(packageDir);
	quarantineWindowsNativeDependencies(packageDir);
}

export async function runSelfUpdateIfNeeded(
	target: UpdateTarget,
	force: boolean,
	selfUpdateNpmCommand: string[] | undefined,
): Promise<boolean> {
	if (!updateTargetIncludesSelf(target)) {
		return true;
	}

	const selfUpdatePlan = await getSelfUpdatePlan(force);
	if (!selfUpdatePlan.shouldRun) {
		return true;
	}

	const installMethod = detectInstallMethod();
	if (process.platform === "win32" && installMethod !== "npm" && installMethod !== "pnpm") {
		console.error(chalk.red(`${APP_NAME} self-update on Windows is only supported for npm and pnpm installs.`));
		console.error(chalk.dim(`Detected install method: ${installMethod}. Update ${APP_NAME} manually.`));
		process.exitCode = 1;
		return false;
	}

	const selfUpdateCommand = getSelfUpdateCommand(PACKAGE_NAME, selfUpdateNpmCommand, selfUpdatePlan.packageName);
	if (!selfUpdateCommand) {
		printSelfUpdateUnavailable(selfUpdateNpmCommand, selfUpdatePlan.packageName);
		process.exitCode = 1;
		return false;
	}

	if (selfUpdatePlan.note) {
		printSelfUpdateNote(selfUpdatePlan.note);
	}

	try {
		if (installMethod === "npm") {
			prepareWindowsNpmSelfUpdate();
		}
		await runSelfUpdate(selfUpdateCommand);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : "Unknown package command error";
		console.error(chalk.red(`Error: ${message}`));
		printSelfUpdateFallback(selfUpdateCommand);
		process.exitCode = 1;
		return false;
	}

	console.log(chalk.green(`Updated ${APP_NAME}`));
	return true;
}
