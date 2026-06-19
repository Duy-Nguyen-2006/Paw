import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type PawEventLogEventName =
	| "session_started"
	| "session_resumed"
	| "state_transitioned"
	| "slice_selected"
	| "worker_completed"
	| "worker_blocked"
	| "reviewer_completed"
	| "reviewer_blocked"
	| "verifier_completed"
	| "verifier_blocked"
	| "checkpoint_prepared"
	| "rollback_executed"
	| "final_report_emitted"
	| "cost_recorded"
	| "secret_redacted"
	| "provider_failover"
	| "command_timeout"
	| "drill_completed";

export interface PawEventLogEntry {
	ts: string;
	session_id: string;
	slice_id: string | null;
	event: PawEventLogEventName;
	data?: Record<string, unknown>;
}

export interface PawEventLogWriterOptions {
	repoRoot: string;
	sessionId: string;
	now?: () => Date;
}

export class PawEventLogWriter {
	private readonly filePath: string;
	private readonly now: () => Date;
	private pending = "";
	private writing = false;

	constructor(options: PawEventLogWriterOptions) {
		const sessionDir = `${options.repoRoot}/.paw/sessions/${options.sessionId}`;
		this.filePath = `${sessionDir}/events.jsonl`;
		this.now = options.now ?? (() => new Date());
	}

	async write(entry: Omit<PawEventLogEntry, "ts"> & { ts?: string }): Promise<void> {
		const fullEntry: PawEventLogEntry = {
			ts: entry.ts ?? this.now().toISOString(),
			session_id: entry.session_id,
			slice_id: entry.slice_id,
			event: entry.event,
			...(entry.data !== undefined ? { data: entry.data } : {}),
		};
		this.pending += `${JSON.stringify(fullEntry)}\n`;
		if (this.writing) return;
		this.writing = true;
		try {
			while (this.pending.length > 0) {
				const chunk = this.pending;
				this.pending = "";
				const { mkdir } = await import("node:fs/promises");
				await mkdir(dirname(this.filePath), { recursive: true });
				await writeFile(this.filePath, chunk, { flag: "a", encoding: "utf-8" });
			}
		} finally {
			this.writing = false;
		}
	}

	async flush(): Promise<void> {
		while (this.writing) {
			await new Promise((r) => setTimeout(r, 10));
		}
	}
}

export async function readPawEventLog(repoRoot: string, sessionId: string): Promise<PawEventLogEntry[]> {
	const filePath = `${repoRoot}/.paw/sessions/${sessionId}/events.jsonl`;
	const { readFile } = await import("node:fs/promises");
	let content: string;
	try {
		content = await readFile(filePath, "utf-8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	const entries: PawEventLogEntry[] = [];
	for (const line of content.split("\n")) {
		if (line.trim().length === 0) continue;
		try {
			entries.push(JSON.parse(line) as PawEventLogEntry);
		} catch {
			// skip malformed line
		}
	}
	return entries;
}

export async function ensurePawEventLogFile(repoRoot: string, sessionId: string): Promise<string> {
	const filePath = `${repoRoot}/.paw/sessions/${sessionId}/events.jsonl`;
	await mkdir(dirname(filePath), { recursive: true });
	return filePath;
}
