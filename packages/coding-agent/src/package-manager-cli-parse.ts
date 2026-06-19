/**
 * Package subcommand argv parsing (extracted from package-manager-cli.ts for S3776).
 */

export type PackageCommand = "install" | "remove" | "update" | "list";

export type UpdateTarget = { type: "all" } | { type: "self" } | { type: "extensions"; source?: string };

export interface PackageCommandOptions {
	command: PackageCommand;
	source?: string;
	updateTarget?: UpdateTarget;
	local: boolean;
	force: boolean;
	projectTrustOverride?: boolean;
	help: boolean;
	invalidOption?: string;
	invalidArgument?: string;
	missingOptionValue?: string;
	conflictingOptions?: string;
}

interface PackageFlagState {
	source: string | undefined;
	local: boolean;
	force: boolean;
	projectTrustOverride: boolean | undefined;
	help: boolean;
	invalidOption: string | undefined;
	invalidArgument: string | undefined;
	missingOptionValue: string | undefined;
	conflictingOptions: string | undefined;
	extensionFlagSource: string | undefined;
	selfFlag: boolean;
	extensionsFlag: boolean;
}

function resolvePackageSubcommand(rawCommand: string | undefined): PackageCommand | undefined {
	if (rawCommand === "uninstall") return "remove";
	if (rawCommand === "install" || rawCommand === "remove" || rawCommand === "update" || rawCommand === "list") {
		return rawCommand;
	}
	return undefined;
}

function applySimpleFlag(
	arg: string,
	command: PackageCommand,
	allowedCommands: PackageCommand[],
	flag: "local" | "force" | "selfFlag" | "extensionsFlag",
	state: PackageFlagState,
): boolean {
	if (command === allowedCommands[0]) {
		(state[flag] as boolean) = true;
	} else {
		state.invalidOption = state.invalidOption ?? arg;
	}
	return true;
}

function applyExtensionFlag(
	arg: string,
	rest: string[],
	index: number,
	command: PackageCommand,
	state: PackageFlagState,
): number {
	if (command !== "update") {
		state.invalidOption = state.invalidOption ?? arg;
		return index;
	}
	const value = rest[index + 1];
	if (!value || value.startsWith("-")) {
		state.missingOptionValue = state.missingOptionValue ?? arg;
		return index;
	}
	if (state.extensionFlagSource) {
		state.conflictingOptions = state.conflictingOptions ?? "--extension can only be provided once";
	} else {
		state.extensionFlagSource = value;
	}
	return index + 1;
}

function parsePackageFlags(rest: string[], command: PackageCommand): PackageFlagState {
	const state: PackageFlagState = {
		source: undefined,
		local: false,
		force: false,
		projectTrustOverride: undefined,
		help: false,
		invalidOption: undefined,
		invalidArgument: undefined,
		missingOptionValue: undefined,
		conflictingOptions: undefined,
		extensionFlagSource: undefined,
		selfFlag: false,
		extensionsFlag: false,
	};

	for (let index = 0; index < rest.length; index++) {
		const arg = rest[index];
		if (arg === "-h" || arg === "--help") {
			state.help = true;
			continue;
		}
		if (arg === "-l" || arg === "--local") {
			applySimpleFlag(arg, command, ["install", "remove"], "local", state);
			continue;
		}
		if (arg === "--self") {
			applySimpleFlag(arg, command, ["update"], "selfFlag", state);
			continue;
		}
		if (arg === "--extensions") {
			applySimpleFlag(arg, command, ["update"], "extensionsFlag", state);
			continue;
		}
		if (arg === "--approve" || arg === "-a") {
			state.projectTrustOverride = true;
			continue;
		}
		if (arg === "--no-approve" || arg === "-na") {
			state.projectTrustOverride = false;
			continue;
		}
		if (arg === "--force") {
			applySimpleFlag(arg, command, ["update"], "force", state);
			continue;
		}
		if (arg === "--extension") {
			index = applyExtensionFlag(arg, rest, index, command, state);
			continue;
		}
		if (arg.startsWith("-")) {
			state.invalidOption = state.invalidOption ?? arg;
			continue;
		}
		if (!state.source) state.source = arg;
		else state.invalidArgument = state.invalidArgument ?? arg;
	}

	return state;
}

function resolveUpdateTarget(command: PackageCommand, state: PackageFlagState): UpdateTarget | undefined {
	if (command !== "update") return undefined;

	if (state.extensionFlagSource) {
		if (state.selfFlag || state.extensionsFlag) {
			state.conflictingOptions =
				state.conflictingOptions ?? "--extension cannot be combined with --self or --extensions";
		}
		if (state.source) {
			state.conflictingOptions =
				state.conflictingOptions ?? "--extension cannot be combined with a positional source";
		}
		return { type: "extensions", source: state.extensionFlagSource };
	}

	if (state.source) {
		const sourceIsSelf = state.source === "self" || state.source === "pi";
		if (sourceIsSelf) {
			return state.extensionsFlag ? { type: "all" } : { type: "self" };
		}
		if (state.extensionsFlag || state.selfFlag) {
			state.conflictingOptions =
				state.conflictingOptions ?? "positional update targets cannot be combined with --self or --extensions";
		}
		return { type: "extensions", source: state.source };
	}

	if (state.selfFlag && state.extensionsFlag) return { type: "all" };
	if (state.selfFlag) return { type: "self" };
	if (state.extensionsFlag) return { type: "extensions" };
	return { type: "all" };
}

export function parsePackageCommand(args: string[]): PackageCommandOptions | undefined {
	const [rawCommand, ...rest] = args;
	const command = resolvePackageSubcommand(rawCommand);
	if (!command) {
		return undefined;
	}

	const flagState = parsePackageFlags(rest, command);

	return {
		command,
		source: flagState.source,
		updateTarget: resolveUpdateTarget(command, flagState),
		local: flagState.local,
		force: flagState.force,
		projectTrustOverride: flagState.projectTrustOverride,
		help: flagState.help,
		invalidOption: flagState.invalidOption,
		invalidArgument: flagState.invalidArgument,
		missingOptionValue: flagState.missingOptionValue,
		conflictingOptions: flagState.conflictingOptions,
	};
}

export function updateTargetIncludesSelf(target: UpdateTarget): boolean {
	return target.type === "all" || target.type === "self";
}

export function updateTargetIncludesExtensions(target: UpdateTarget): boolean {
	return target.type === "all" || target.type === "extensions";
}

export function parseProjectTrustOverride(args: readonly string[]): boolean | undefined {
	let trustOverride: boolean | undefined;
	for (const arg of args) {
		if (arg === "--approve" || arg === "-a") {
			trustOverride = true;
		} else if (arg === "--no-approve" || arg === "-na") {
			trustOverride = false;
		}
	}
	return trustOverride;
}
