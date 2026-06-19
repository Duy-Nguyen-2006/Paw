import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { APP_NAME } from "../config.ts";
import { loadDefaultPawRuntimeConfig } from "./config.ts";
import { readPawSessionState } from "./session-store.ts";
import { PAW_ALLOWED_ACTIVE_TRANSITIONS, type PawSessionState } from "./state.ts";

export type PawPlanView = "current" | "queue" | "completed";

export interface PawPlanParsedArgs {
	sessionId: string | null;
	view: PawPlanView;
	showAcceptance: boolean;
	repoRoot?: string;
}

export type PawPlanParseResult =
	| { kind: "help" }
	| { kind: "error"; message: string }
	| { kind: "ok"; args: PawPlanParsedArgs };

export interface PawPlanSlice {
	sliceId: string;
	status: "pending" | "current" | "completed";
	title: string;
	acceptance: string | null;
}

export interface PawPlanResult {
	sessionId: string;
	currentState: string;
	pending: string[];
	completed: string[];
	slices: PawPlanSlice[];
	nextState: string | null;
}

export function parsePawPlanArgs(args: string[]): PawPlanParseResult {
	if (args.length === 0) {
		return { kind: "help" };
	}
	if (args[0] === "--help" || args[0] === "-h") {
		return { kind: "help" };
	}
	let sessionId: string | null = null;
	let view: PawPlanView = "current";
	let showAcceptance = false;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--queue") view = "queue";
		else if (arg === "--completed") view = "completed";
		else if (arg === "--acceptance") showAcceptance = true;
		else if (arg.startsWith("--")) {
			return { kind: "error", message: `Unknown option for "paw plan": ${arg}` };
		} else if (sessionId === null) {
			sessionId = arg;
		} else {
			return { kind: "error", message: `Unexpected positional argument: ${arg}` };
		}
	}
	return { kind: "ok", args: { sessionId, view, showAcceptance } };
}

export async function runPawPlanCommand(args: string[]): Promise<void> {
	const parsed = parsePawPlanArgs(args);
	if (parsed.kind === "help") {
		printPawPlanHelp();
		return;
	}
	if (parsed.kind === "error") {
		console.error(`Error: ${parsed.message}`);
		process.exitCode = 1;
		return;
	}
	if (parsed.args.sessionId === null) {
		console.error("Error: missing <session-id> for paw plan");
		process.exitCode = 1;
		return;
	}
	try {
		const result = await createPawPlanResult(parsed.args);
		console.log(formatPawPlanResult(result));
	} catch (error) {
		console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
}

export async function createPawPlanResult(args: PawPlanParsedArgs): Promise<PawPlanResult> {
	if (args.sessionId === null) {
		throw new Error("paw plan requires a session id");
	}
	const repoRoot = resolve(args.repoRoot ?? process.cwd());
	const state = await readPawSessionState(repoRoot, args.sessionId);
	const slices = await loadPawPlanSlices(repoRoot, args.sessionId, state);
	const nextState = findNextState(state);
	return {
		sessionId: args.sessionId,
		currentState: state.name,
		pending: [...state.pending_slice_ids],
		completed: [...state.completed_slice_ids],
		slices,
		nextState,
	};
}

async function loadPawPlanSlices(
	repoRoot: string,
	sessionId: string,
	state: PawSessionState,
): Promise<PawPlanSlice[]> {
	// Attempt to load the slice plan from the session state if present (in-memory only)
	const planFile = `${repoRoot}/.paw/sessions/${sessionId}/plan.json`;
	let planSlices: { slice_id: string; title?: string; acceptance?: string }[] = [];
	try {
		const content = await readFile(planFile, "utf-8");
		const parsed = JSON.parse(content) as { slices?: { slice_id: string; title?: string; acceptance?: string }[] };
		planSlices = parsed.slices ?? [];
	} catch {
		// No plan file; fall back to slice ids only.
	}
	const titleOf = (sliceId: string) => planSlices.find((s) => s.slice_id === sliceId)?.title ?? sliceId;
	const acceptanceOf = (sliceId: string) => planSlices.find((s) => s.slice_id === sliceId)?.acceptance ?? null;
	const allSliceIds = [
		...state.pending_slice_ids,
		...(state.current_slice_id !== null ? [state.current_slice_id] : []),
		...state.completed_slice_ids,
	];
	return allSliceIds.map((sliceId) => {
		const status: PawPlanSlice["status"] = state.current_slice_id === sliceId
			? "current"
			: state.completed_slice_ids.includes(sliceId)
				? "completed"
				: "pending";
		return {
			sliceId,
			status,
			title: titleOf(sliceId),
			acceptance: acceptanceOf(sliceId),
		};
	});
}

function findNextState(state: PawSessionState): string | null {
	const allowed = PAW_ALLOWED_ACTIVE_TRANSITIONS[state.name as keyof typeof PAW_ALLOWED_ACTIVE_TRANSITIONS];
	if (!allowed || allowed.length === 0) return null;
	return allowed[0];
}

export function formatPawPlanResult(result: PawPlanResult): string {
	const lines = [
		"Paw plan",
		`session: ${result.sessionId}`,
		`state: ${result.currentState}`,
		`next: ${result.nextState ?? "none"}`,
		`pending: ${result.pending.join(", ") || "(none)"}`,
		`completed: ${result.completed.join(", ") || "(none)"}`,
		"slices:",
	];
	for (const slice of result.slices) {
		lines.push(`  [${slice.status}] ${slice.sliceId}: ${slice.title}`);
	}
	return lines.join("\n");
}

function printPawPlanHelp(): void {
	console.log(`Usage:
  ${APP_NAME} paw plan <session-id> [--queue|--completed] [--acceptance]

Inspect the current Paw plan state for a session.
`);
}

// Touch config import for loadDefaultPawRuntimeConfig side effect (typed import for future use).
export const _pawPlanConfigLoader = loadDefaultPawRuntimeConfig;
