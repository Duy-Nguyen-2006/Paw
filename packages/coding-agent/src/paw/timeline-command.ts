import { APP_NAME } from "../config.ts";
import { pawCliArgsShowHelp } from "./cli-arg-parsing.ts";
import { type PawEventLogEntry, readPawEventLog } from "./event-log.ts";
import { readPawSessionState } from "./session-store.ts";

export interface PawTimelineParsedArgs {
	sessionId: string;
	limit: number | null;
	includeJournal: boolean;
}

export type PawTimelineParseResult =
	| { kind: "help" }
	| { kind: "error"; message: string }
	| { kind: "ok"; args: PawTimelineParsedArgs };

export interface PawTimelineEntry {
	timestamp: string;
	source: "event" | "state" | "journal";
	detail: string;
	sliceId: string | null;
}

export interface PawTimelineResult {
	sessionId: string;
	entries: PawTimelineEntry[];
	summary: string;
}

export function parsePawTimelineArgs(args: string[]): PawTimelineParseResult {
	if (args.length === 0 || pawCliArgsShowHelp(args)) {
		return { kind: "help" };
	}
	const parsed = parsePawTimelineOptions(args);
	if ("kind" in parsed) {
		return parsed;
	}
	return { kind: "ok", args: parsed };
}

function parsePawTimelineOptions(args: string[]): PawTimelineParseResult | PawTimelineParsedArgs {
	let sessionId: string | null = null;
	let limit: number | null = null;
	let includeJournal = true;
	for (let index = 0; index < args.length; index += 1) {
		const step = consumePawTimelineArg(args, index, { sessionId, limit, includeJournal });
		if ("kind" in step) {
			return step;
		}
		sessionId = step.sessionId;
		limit = step.limit;
		includeJournal = step.includeJournal;
		index = step.index;
	}
	if (sessionId === null) {
		return { kind: "error", message: "Missing <session-id> for paw timeline" };
	}
	return { sessionId, limit, includeJournal };
}

function consumePawTimelineArg(
	args: string[],
	index: number,
	state: { sessionId: string | null; limit: number | null; includeJournal: boolean },
): PawTimelineParseResult | { sessionId: string | null; limit: number | null; includeJournal: boolean; index: number } {
	const arg = args[index];
	if (arg === "--limit" || arg === "-n") {
		return parsePawTimelineLimitArg(args, index, arg, state);
	}
	if (arg === "--no-journal") {
		return { ...state, includeJournal: false, index };
	}
	if (arg.startsWith("--")) {
		return { kind: "error", message: `Unknown option for "paw timeline": ${arg}` };
	}
	if (state.sessionId === null) {
		return { ...state, sessionId: arg, index };
	}
	return { kind: "error", message: `Unexpected positional argument: ${arg}` };
}

function parsePawTimelineLimitArg(
	args: string[],
	index: number,
	option: string,
	state: { sessionId: string | null; limit: number | null; includeJournal: boolean },
): PawTimelineParseResult | { sessionId: string | null; limit: number | null; includeJournal: boolean; index: number } {
	const value = args[index + 1];
	if (value === undefined) {
		return { kind: "error", message: `Missing value for ${option}` };
	}
	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		return { kind: "error", message: `Option ${option} must be a positive integer.` };
	}
	return { ...state, limit: parsed, index: index + 1 };
}

export async function runPawTimelineCommand(args: string[]): Promise<void> {
	const parsed = parsePawTimelineArgs(args);
	if (parsed.kind === "help") {
		printPawTimelineHelp();
		return;
	}
	if (parsed.kind === "error") {
		console.error(`Error: ${parsed.message}`);
		process.exitCode = 1;
		return;
	}
	try {
		const result = await createPawTimelineResult(parsed.args);
		console.log(formatPawTimelineResult(result));
	} catch (error) {
		console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
}

export async function createPawTimelineResult(args: PawTimelineParsedArgs): Promise<PawTimelineResult> {
	const repoRoot = process.cwd();
	const entries: PawTimelineEntry[] = [];

	// Event log entries
	const events: PawEventLogEntry[] = await readPawEventLog(repoRoot, args.sessionId);
	for (const event of events) {
		entries.push({
			timestamp: event.ts,
			source: "event",
			detail: formatEvent(event),
			sliceId: event.slice_id,
		});
	}

	// State transitions from session state
	try {
		const state = await readPawSessionState(repoRoot, args.sessionId);
		entries.push({
			timestamp: new Date(0).toISOString(),
			source: "state",
			detail: `state=${state.name} current_slice=${state.current_slice_id ?? "none"} pending=${state.pending_slice_ids.length} completed=${state.completed_slice_ids.length}`,
			sliceId: state.current_slice_id,
		});
	} catch {
		// ignore
	}

	// Journal entries (slice_id/path)
	if (args.includeJournal) {
		const { readPawSliceJournal } = await import("./slice-journal.ts");
		const journal = await readPawSliceJournal(repoRoot, args.sessionId);
		for (const entry of journal) {
			entries.push({
				timestamp: entry.timestamp,
				source: "journal",
				detail: `${entry.change_type} ${entry.path} (${entry.apply_method ?? "unknown"})`,
				sliceId: entry.slice_id,
			});
		}
	}

	entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
	const limited = args.limit !== null ? entries.slice(-args.limit) : entries;
	const summary = `${limited.length} timeline entries (events=${events.length} journal_included=${args.includeJournal})`;
	return { sessionId: args.sessionId, entries: limited, summary };
}

function formatEvent(event: PawEventLogEntry): string {
	const data = event.data ? ` ${JSON.stringify(event.data)}` : "";
	return `${event.event}${data}`;
}

export function formatPawTimelineResult(result: PawTimelineResult): string {
	const lines = ["Paw timeline", `session: ${result.sessionId}`, `summary: ${result.summary}`];
	if (result.entries.length === 0) {
		lines.push("entries: (none)");
	} else {
		for (const entry of result.entries) {
			lines.push(`  ${entry.timestamp} [${entry.source}] ${entry.sliceId ?? "-"}: ${entry.detail}`);
		}
	}
	return lines.join("\n");
}

function printPawTimelineHelp(): void {
	console.log(`Usage:
  ${APP_NAME} paw timeline <session-id> [--limit <n>] [--no-journal]

Show the Paw session timeline (event log + state + journal).
`);
}
