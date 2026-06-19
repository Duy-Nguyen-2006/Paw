/**
 * Extension slash command name resolution and disambiguation.
 */

import type { Extension, RegisteredCommand, ResolvedCommand } from "./types.ts";

export function resolveRegisteredCommands(extensions: Extension[]): ResolvedCommand[] {
	const commands: RegisteredCommand[] = [];
	const counts = new Map<string, number>();

	for (const ext of extensions) {
		for (const command of ext.commands.values()) {
			commands.push(command);
			counts.set(command.name, (counts.get(command.name) ?? 0) + 1);
		}
	}

	const seen = new Map<string, number>();
	const takenInvocationNames = new Set<string>();

	return commands.map((command) => {
		const occurrence = (seen.get(command.name) ?? 0) + 1;
		seen.set(command.name, occurrence);

		let invocationName = (counts.get(command.name) ?? 0) > 1 ? `${command.name}:${occurrence}` : command.name;

		if (takenInvocationNames.has(invocationName)) {
			let suffix = occurrence;
			do {
				suffix++;
				invocationName = `${command.name}:${suffix}`;
			} while (takenInvocationNames.has(invocationName));
		}

		takenInvocationNames.add(invocationName);
		return {
			...command,
			invocationName,
		};
	});
}
