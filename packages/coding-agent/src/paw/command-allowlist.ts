import type { PawRiskLevel } from "./contracts.ts";

export interface PawCommandAllowlistEntry {
	command: string;
	argPattern: string | null;
	riskLevel: PawRiskLevel;
	allowed: boolean;
}

export interface PawCommandAllowlistConfig {
	entries: readonly PawCommandAllowlistEntry[];
	blockedByDefault: boolean;
}

export const DEFAULT_PAW_COMMAND_ALLOWLIST: PawCommandAllowlistConfig = {
	blockedByDefault: true,
	entries: [
		{ command: "ls", argPattern: null, riskLevel: "R0", allowed: true },
		{ command: "cat", argPattern: null, riskLevel: "R0", allowed: true },
		{ command: "head", argPattern: null, riskLevel: "R0", allowed: true },
		{ command: "tail", argPattern: null, riskLevel: "R0", allowed: true },
		{ command: "grep", argPattern: null, riskLevel: "R0", allowed: true },
		{ command: "find", argPattern: null, riskLevel: "R0", allowed: true },
		{ command: "git", argPattern: "^status$", riskLevel: "R0", allowed: true },
		{ command: "git", argPattern: "^diff$", riskLevel: "R0", allowed: true },
		{ command: "git", argPattern: "^log$", riskLevel: "R0", allowed: true },
		{ command: "git", argPattern: "^show$", riskLevel: "R0", allowed: true },
		{ command: "git", argPattern: "^add$", riskLevel: "R1", allowed: true },
		{ command: "npm", argPattern: "^test$", riskLevel: "R2", allowed: true },
		{ command: "npm", argPattern: "^run$", riskLevel: "R2", allowed: true },
		{ command: "npm", argPattern: "^ci$", riskLevel: "R3", allowed: true },
		{ command: "npm", argPattern: "^install$", riskLevel: "R3", allowed: true },
		{ command: "npx", argPattern: null, riskLevel: "R2", allowed: true },
		{ command: "node", argPattern: null, riskLevel: "R2", allowed: true },
		{ command: "python3?", argPattern: null, riskLevel: "R2", allowed: true },
		{ command: "cargo", argPattern: null, riskLevel: "R2", allowed: true },
		{ command: "go", argPattern: null, riskLevel: "R2", allowed: true },
		{ command: "docker", argPattern: null, riskLevel: "R5", allowed: false },
		{ command: "kubectl", argPattern: null, riskLevel: "R5", allowed: false },
		{ command: "aws", argPattern: null, riskLevel: "R5", allowed: false },
		{ command: "rm", argPattern: null, riskLevel: "R6", allowed: false },
		{ command: "rmdir", argPattern: null, riskLevel: "R6", allowed: false },
		{ command: "sudo", argPattern: null, riskLevel: "R7", allowed: false },
	],
};

export interface PawCommandAllowlistInput {
	command: string;
	args: readonly string[];
	config: PawCommandAllowlistConfig;
}

export type PawCommandAllowlistDecision =
	| { allowed: true; matchedEntry: PawCommandAllowlistEntry | null; reason: string }
	| { allowed: false; matchedEntry: PawCommandAllowlistEntry | null; reason: string };

export function evaluatePawCommandAllowlist(input: PawCommandAllowlistInput): PawCommandAllowlistDecision {
	const command = normalizeCommandName(input.command);
	for (const entry of input.config.entries) {
		const decision = matchPawAllowlistEntry(command, input.args, entry);
		if (decision !== null) {
			return decision;
		}
	}
	return defaultPawAllowlistDecision(command, input.config.blockedByDefault);
}

function matchPawAllowlistEntry(
	command: string,
	args: readonly string[],
	entry: PawCommandAllowlistEntry,
): PawCommandAllowlistDecision | null {
	const entryCommand = entry.command.endsWith("?") ? entry.command.slice(0, -1) : entry.command;
	if (command !== entryCommand) {
		return null;
	}
	if (entry.argPattern === null) {
		return decisionForAllowlistEntry(
			entry,
			`Matched ${entry.command} allowlist entry`,
			`Command ${entry.command} is denied (${entry.riskLevel})`,
		);
	}
	const firstArg = args[0] ?? "";
	if (!new RegExp(entry.argPattern).test(firstArg)) {
		return null;
	}
	return decisionForAllowlistEntry(
		entry,
		`Matched ${entry.command} ${entry.argPattern}`,
		`Command ${entry.command} ${entry.argPattern} is denied`,
	);
}

function decisionForAllowlistEntry(
	entry: PawCommandAllowlistEntry,
	allowReason: string,
	denyReason: string,
): PawCommandAllowlistDecision {
	return entry.allowed
		? { allowed: true, matchedEntry: entry, reason: allowReason }
		: { allowed: false, matchedEntry: entry, reason: denyReason };
}

function defaultPawAllowlistDecision(command: string, blockedByDefault: boolean): PawCommandAllowlistDecision {
	return blockedByDefault
		? { allowed: false, matchedEntry: null, reason: `Command ${command} is not in the allowlist` }
		: {
				allowed: true,
				matchedEntry: null,
				reason: `Command ${command} accepted by default (allowlist not enforced)`,
			};
}

function normalizeCommandName(command: string): string {
	const basename = command.split("/").pop() ?? command;
	return basename === "python3.12" || basename === "python3.11" || basename === "python3.10" || basename === "python3"
		? "python3"
		: basename;
}
