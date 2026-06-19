/**
 * Builtin slash-command dispatch for interactive editor submit (reduces handleEditorSubmit complexity).
 */

export type SlashCommandAction =
	| { kind: "sync"; run: () => void }
	| { kind: "async"; run: () => Promise<void> }
	| { kind: "asyncWithText"; run: (text: string) => Promise<void> }
	| { kind: "syncWithText"; run: (text: string) => void }
	| { kind: "prefix"; prefix: string; run: (arg: string) => Promise<void> | void };

export function matchBuiltinSlashCommand(
	text: string,
	actions: Record<string, SlashCommandAction>,
	prefixActions: Array<{ prefix: string; action: SlashCommandAction }>,
): SlashCommandAction | undefined {
	const exact = actions[text];
	if (exact) {
		return exact;
	}
	for (const { prefix, action } of prefixActions) {
		if (text === prefix || text.startsWith(`${prefix} `)) {
			return action;
		}
	}
	return undefined;
}

export async function runSlashCommandAction(action: SlashCommandAction, text: string): Promise<void> {
	switch (action.kind) {
		case "sync":
			action.run();
			break;
		case "async":
			await action.run();
			break;
		case "asyncWithText":
			await action.run(text);
			break;
		case "syncWithText":
			action.run(text);
			break;
		case "prefix": {
			const arg = text === action.prefix ? "" : text.slice(action.prefix.length + 1).trim();
			await action.run(arg);
			break;
		}
	}
}
