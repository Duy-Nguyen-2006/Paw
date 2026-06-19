import { createInterface } from "node:readline";
import { APP_NAME } from "../config.ts";
import { loadDefaultPawRuntimeConfig } from "./config.ts";
import { readPawSessionState } from "./session-store.ts";
import { transitionPawSessionState, type PawSessionState, type PawSessionStateName } from "./state.ts";

export type PawAction = "approve" | "reject" | "retry" | "explain" | "continue" | "exit";

export interface PawChatMessage {
	role: "user" | "assistant" | "system";
	content: string;
	timestamp: string;
}

export interface PawChatSession {
	sessionId: string;
	history: PawChatMessage[];
	state: PawSessionState;
}

export interface PawChatParsedArgs {
	sessionId: string | null;
	json: boolean;
	readline?: (prompt: string) => Promise<string>;
	clock?: () => Date;
}

export type PawChatParseResult =
	| { kind: "help" }
	| { kind: "error"; message: string }
	| { kind: "ok"; args: PawChatParsedArgs };

export function parsePawChatArgs(args: string[]): PawChatParseResult {
	if (args.length === 0) {
		return { kind: "help" };
	}
	if (args[0] === "--help" || args[0] === "-h") {
		return { kind: "help" };
	}
	let sessionId: string | null = null;
	let json = false;
	for (const arg of args) {
		if (arg === "--json") json = true;
		else if (arg.startsWith("--")) {
			return { kind: "error", message: `Unknown option for "paw chat": ${arg}` };
		} else if (sessionId === null) {
			sessionId = arg;
		} else {
			return { kind: "error", message: `Unexpected positional argument: ${arg}` };
		}
	}
	return { kind: "ok", args: { sessionId, json } };
}

export async function runPawChatCommand(args: string[]): Promise<void> {
	const parsed = parsePawChatArgs(args);
	if (parsed.kind === "help") {
		printPawChatHelp();
		return;
	}
	if (parsed.kind === "error") {
		console.error(`Error: ${parsed.message}`);
		process.exitCode = 1;
		return;
	}
	if (parsed.args.sessionId === null) {
		console.error("Error: missing <session-id> for paw chat");
		process.exitCode = 1;
		return;
	}
	try {
		await runInteractiveChat(parsed.args);
	} catch (error) {
		console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
}

async function runInteractiveChat(args: PawChatParsedArgs): Promise<void> {
	const repoRoot = process.cwd();
	const sessionId = args.sessionId as string;
	const config = loadDefaultPawRuntimeConfig(repoRoot);
	const state = await readPawSessionState(repoRoot, sessionId);
	const chat: PawChatSession = {
		sessionId,
		state,
		history: [
			{ role: "system", content: `Paw interactive chat for session ${sessionId}. state=${state.name}`, timestamp: new Date().toISOString() },
		],
	};
	const readline = args.readline ?? defaultReadline;
	let nextAction: PawAction | null = null;
	while (nextAction !== "exit") {
		const prompt = `paw(${state.name})> `;
		const input = await readline(prompt);
		const trimmed = input.trim();
		if (trimmed === "") continue;
		if (trimmed === "/exit" || trimmed === "/quit") {
			nextAction = "exit";
			continue;
		}
		const action = parseChatAction(trimmed);
		chat.history.push({ role: "user", content: trimmed, timestamp: new Date().toISOString() });
		const response = await handleChatAction(action, chat, config, repoRoot, args.json);
		chat.history.push({ role: "assistant", content: response, timestamp: new Date().toISOString() });
		if (action === "exit") break;
	}
}

function parseChatAction(input: string): PawAction {
	const lower = input.toLowerCase();
	if (lower === "/approve" || lower === "approve") return "approve";
	if (lower === "/reject" || lower === "reject") return "reject";
	if (lower === "/retry" || lower === "retry") return "retry";
	if (lower === "/explain" || lower === "explain") return "explain";
	if (lower === "/continue" || lower === "continue") return "continue";
	if (lower === "/exit" || lower === "exit") return "exit";
	return "continue";
}

async function handleChatAction(
	action: PawAction,
	chat: PawChatSession,
	_config: ReturnType<typeof loadDefaultPawRuntimeConfig>,
	_repoRoot: string,
	json: boolean,
): Promise<string> {
	switch (action) {
		case "approve":
			return await transitionAndReport(chat, chat.state.name === "PLAN_DRAFTED" ? "PLAN_APPROVED" : "SLICE_DONE", json);
		case "reject":
			return `Rejected slice ${chat.state.current_slice_id ?? "(none)"}. Use /retry to continue with explicit reasoning.`;
		case "retry":
			return `Retrying current slice ${chat.state.current_slice_id ?? "(none)"}. Awaiting provider response.`;
		case "explain": {
			const blocked = chat.state.blocked_reason;
			if (blocked === null) {
				return `No blocked reason. State ${chat.state.name} is active. Pending=${chat.state.pending_slice_ids.length} Completed=${chat.state.completed_slice_ids.length}`;
			}
			return `Blocked (${blocked.code}): ${blocked.message}. Suggested action: ${blocked.suggested_action}. Resume state: ${blocked.resume_state}.`;
		}
		case "continue":
			return `Acknowledged: state=${chat.state.name} slice=${chat.state.current_slice_id ?? "(none)"}. Use /approve, /reject, /retry, /explain, or /exit.`;
		case "exit":
			return "Goodbye.";
	}
}

async function transitionAndReport(chat: PawChatSession, target: PawSessionStateName, _json: boolean): Promise<string> {
	const transition: { to: PawSessionStateName; slice_ids?: string[] } = { to: target };
	if (target === "PLAN_APPROVED") {
		transition.slice_ids = chat.state.pending_slice_ids.length > 0 ? [...chat.state.pending_slice_ids] : ["chat-slice-1"];
	}
	const result = transitionPawSessionState(chat.state, transition);
	if (!result.ok) {
		return `Cannot transition to ${target}: ${result.issues.map((issue) => issue.message).join("; ")}`;
	}
	chat.state = result.value;
	return `Advanced to ${result.value.name}. pending=${result.value.pending_slice_ids.length} current=${result.value.current_slice_id ?? "(none)"}.`;
}

function defaultReadline(prompt: string): Promise<string> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => {
		rl.question(prompt, (answer) => {
			rl.close();
			resolve(answer);
		});
	});
}

function printPawChatHelp(): void {
	console.log(`Usage:
  ${APP_NAME} paw chat <session-id> [--json]

Interactive Paw CLI chat for inspecting and guiding a session.

Commands inside the chat:
  /approve    Advance the session to the next allowed state
  /reject     Reject the current slice
  /retry      Retry the current slice
  /explain    Explain the current state/blocked reason
  /continue   Acknowledge the current prompt
  /exit       Leave the chat
`);
}
