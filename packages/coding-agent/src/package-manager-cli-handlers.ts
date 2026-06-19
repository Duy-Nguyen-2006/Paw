/**
 * Handlers for individual package CLI subcommands (extracted from
 * package-manager-cli.ts for S3776).
 *
 * Each handler returns a boolean to indicate whether the command
 * completed (true) or failed (false). The main dispatcher
 * (handlePackageCommand) only needs to convert these into the
 * right process.exitCode and console output.
 */

import chalk from "chalk";
import type { ConfiguredPackage, PackageManager } from "./core/package-manager.ts";
import type { PackageCommandOptions, UpdateTarget } from "./package-manager-cli-parse.ts";
import { updateTargetIncludesExtensions } from "./package-manager-cli-parse.ts";
import { runSelfUpdateIfNeeded } from "./package-manager-cli-self-update.ts";

export type ValidationFailureKind =
	| "invalidOption"
	| "missingOptionValue"
	| "invalidArgument"
	| "conflictingOptions"
	| "missingSource";

export interface ValidationFailure {
	kind: ValidationFailureKind;
	value: string;
}

export function validatePackageCommandOptions(options: PackageCommandOptions): ValidationFailure | undefined {
	if (options.invalidOption) {
		return { kind: "invalidOption", value: options.invalidOption };
	}
	if (options.missingOptionValue) {
		return { kind: "missingOptionValue", value: options.missingOptionValue };
	}
	if (options.invalidArgument) {
		return { kind: "invalidArgument", value: options.invalidArgument };
	}
	if (options.conflictingOptions) {
		return { kind: "conflictingOptions", value: options.conflictingOptions };
	}
	if ((options.command === "install" || options.command === "remove") && !options.source) {
		return { kind: "missingSource", value: options.command };
	}
	return undefined;
}

export function shouldEnforceProjectTrust(options: PackageCommandOptions, isProjectTrusted: boolean): boolean {
	if (isProjectTrusted) return false;
	const writesProjectPackageConfig = (options.command === "install" || options.command === "remove") && options.local;
	return writesProjectPackageConfig;
}

export async function runPackageInstall(
	packageManager: PackageManager,
	source: string,
	local: boolean,
): Promise<boolean> {
	await packageManager.installAndPersist(source, { local });
	console.log(chalk.green(`Installed ${source}`));
	return true;
}

export async function runPackageRemove(
	packageManager: PackageManager,
	source: string,
	local: boolean,
): Promise<boolean> {
	const removed = await packageManager.removeAndPersist(source, { local });
	if (!removed) {
		console.error(chalk.red(`No matching package found for ${source}`));
		return false;
	}
	console.log(chalk.green(`Removed ${source}`));
	return true;
}

export function runPackageList(packageManager: PackageManager): boolean {
	const configuredPackages = packageManager.listConfiguredPackages();
	if (configuredPackages.length === 0) {
		console.log(chalk.dim("No packages installed."));
		return true;
	}

	const userPackages = configuredPackages.filter((pkg) => pkg.scope === "user");
	const projectPackages = configuredPackages.filter((pkg) => pkg.scope === "project");

	if (userPackages.length > 0) {
		console.log(chalk.bold("User packages:"));
		for (const pkg of userPackages) {
			printConfiguredPackage(pkg);
		}
	}

	if (projectPackages.length > 0) {
		if (userPackages.length > 0) console.log();
		console.log(chalk.bold("Project packages:"));
		for (const pkg of projectPackages) {
			printConfiguredPackage(pkg);
		}
	}

	return true;
}

function printConfiguredPackage(pkg: ConfiguredPackage): void {
	const display = pkg.filtered ? `${pkg.source} (filtered)` : pkg.source;
	console.log(`  ${display}`);
	if (pkg.installedPath) {
		console.log(chalk.dim(`    ${pkg.installedPath}`));
	}
}

export async function runPackageUpdate(
	packageManager: PackageManager,
	target: UpdateTarget,
	force: boolean,
	selfUpdateNpmCommand: string[] | undefined,
): Promise<boolean> {
	if (updateTargetIncludesExtensions(target)) {
		const updateSource = target.type === "extensions" ? target.source : undefined;
		await packageManager.update(updateSource);
		if (updateSource) {
			console.log(chalk.green(`Updated ${updateSource}`));
		} else {
			console.log(chalk.green("Updated packages"));
		}
	}
	await runSelfUpdateIfNeeded(target, force, selfUpdateNpmCommand);
	return true;
}
