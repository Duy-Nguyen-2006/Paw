import { APP_NAME } from "../config.ts";
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
	if (args.length === 0) {
		return { kind: "help" };
	}
	if (args[0] === "--help" || args[0] === "-h") {
		return { kind: "help" };
	}
	let sessionId: string | null = null;
	let limit: number | null = null;
	let includeJournal = true;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--limit" || arg === "-n") {
			const value = args[index + 1];
			if (value === undefined) return { kind: "error", message: `Missing value for ${arg}` };
			const parsed = Number.parseInt(value, 10);
			if (!Number.isInteger(parsed) || parsed <= 0) {
				return { kind: "error", message: `Option ${arg} must be a positive integer.` };
			}
			limit = parsed;
			index += 1;
		} else if (arg === "--no-journal") {
			includeJournal = false;
		} else if (arg.startsWith("--")) {
			return { kind: "error", message: `Unknown option for "paw timeline": ${arg}` };
		} else if (sessionId === null) {
			sessionId = arg;
		} else {
			return { kind: "error", message: `Unexpected positional argument: ${arg}` };
		}
	}
	if (sessionId === null) {
		return { kind: "error", message: "Missing <session-id> for paw timeline" };
	}
	return { kind: "ok", args: { sessionId, limit, includeJournal } };
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
