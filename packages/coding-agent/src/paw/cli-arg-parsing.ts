export type PawCliParsedArgsBase = { kind: "help" } | { kind: "error"; message: string };

export function pawCliArgsShowHelp(args: readonly string[]): boolean {
	return args.some((arg) => arg === "--help" || arg === "-h");
}

export function pawCliParseRequiredSessionId(
	args: readonly string[],
	commandLabel: string,
): PawCliParsedArgsBase | { sessionId: string } {
	if (args.length === 0) {
		return { kind: "error", message: `Missing required session id for "${commandLabel}".` };
	}

	const sessionId = args[0];
	if (sessionId.startsWith("-")) {
		return { kind: "error", message: `Missing required session id for "${commandLabel}".` };
	}

	return { sessionId };
}

export function pawCliReadScalarOptionValue(
	commandLabel: string,
	optionName: string,
	args: readonly string[],
	index: number,
	seenScalarOptions: Set<string>,
): PawCliParsedArgsBase | { value: string; nextIndex: number } {
	if (seenScalarOptions.has(optionName)) {
		return { kind: "error", message: `Duplicate option for "${commandLabel}": ${optionName}` };
	}
	seenScalarOptions.add(optionName);
	if (index + 1 >= args.length) {
		return { kind: "error", message: `Missing value for "${commandLabel}" option: ${optionName}` };
	}

	const value = args[index + 1];
	if (value.trim().length === 0) {
		return {
			kind: "error",
			message: `Option ${optionName} for "${commandLabel}" must be a non-empty string.`,
		};
	}

	return { value, nextIndex: index + 2 };
}

export function pawCliUnknownPositionalArg(commandLabel: string, arg: string): PawCliParsedArgsBase {
	if (arg.startsWith("-")) {
		return { kind: "error", message: `Unknown option for "${commandLabel}": ${arg}` };
	}
	return { kind: "error", message: `Unknown option for "${commandLabel}": ${arg}` };
}

export type PawCliScalarFieldBinding = {
	readonly option: string;
	set: (value: string) => void;
};

export function pawCliParseScalarFieldsFromArgs(
	commandLabel: string,
	args: readonly string[],
	startIndex: number,
	allowedOptions: ReadonlySet<string>,
	bindings: readonly PawCliScalarFieldBinding[],
): PawCliParsedArgsBase | { nextIndex: number } {
	const seenScalarOptions = new Set<string>();
	let index = startIndex;

	while (index < args.length) {
		const arg = args[index];
		if (!allowedOptions.has(arg)) {
			return pawCliUnknownPositionalArg(commandLabel, arg);
		}

		const binding = bindings.find((entry) => entry.option === arg);
		if (binding === undefined) {
			return { kind: "error", message: `Unknown option for "${commandLabel}": ${arg}` };
		}

		const scalar = pawCliReadScalarOptionValue(commandLabel, arg, args, index, seenScalarOptions);
		if ("kind" in scalar) {
			return scalar;
		}
		binding.set(scalar.value);
		index = scalar.nextIndex;
	}

	return { nextIndex: index };
}

export function pawCliParseRepeatableScalarOption(
	commandLabel: string,
	optionName: string,
	args: readonly string[],
	startIndex: number,
): PawCliParsedArgsBase | { values: string[]; nextIndex: number } {
	const values: string[] = [];
	let index = startIndex;

	while (index < args.length && args[index] === optionName) {
		const scalar = pawCliReadScalarOptionValue(commandLabel, optionName, args, index, new Set());
		if ("kind" in scalar) {
			return scalar;
		}
		values.push(scalar.value);
		index = scalar.nextIndex;
	}

	if (values.length === 0) {
		return { kind: "error", message: `Missing required option for "${commandLabel}": ${optionName}` };
	}

	return { values, nextIndex: index };
}

export function pawCliCollectRepeatableScalarOption(
	commandLabel: string,
	optionName: string,
	args: readonly string[],
	startIndex: number,
): PawCliParsedArgsBase | { values: string[]; nextIndex: number } {
	const values: string[] = [];
	let index = startIndex;

	while (index < args.length && args[index] === optionName) {
		const scalar = pawCliReadScalarOptionValue(commandLabel, optionName, args, index, new Set());
		if ("kind" in scalar) {
			return scalar;
		}
		values.push(scalar.value);
		index = scalar.nextIndex;
	}

	return { values, nextIndex: index };
}
