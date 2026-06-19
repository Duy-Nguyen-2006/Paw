import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { ensurePawEventLogFile, PawEventLogWriter, readPawEventLog } from "../src/paw/index.ts";

const tempRoots: string[] = [];

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createTempRepo(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-eventlog-"));
	tempRoots.push(root);
	return root;
}

describe("PawEventLogWriter", () => {
	test("writes and reads events from session events.jsonl", async () => {
		const root = await createTempRepo();
		const writer = new PawEventLogWriter({ repoRoot: root, sessionId: "ses-1", now: () => new Date("2026-06-19T00:00:00.000Z") });
		await writer.write({ session_id: "ses-1", slice_id: "sl-1", event: "session_started" });
		await writer.write({ session_id: "ses-1", slice_id: "sl-1", event: "state_transitioned", data: { to: "INTAKE" } });
		await writer.flush();
		const events = await readPawEventLog(root, "ses-1");
		expect(events).toHaveLength(2);
		expect(events[0]?.event).toBe("session_started");
		expect(events[1]?.event).toBe("state_transitioned");
		expect(events[1]?.data).toEqual({ to: "INTAKE" });
	});

	test("ensurePawEventLogFile creates the session directory", async () => {
		const root = await createTempRepo();
		const filePath = await ensurePawEventLogFile(root, "ses-2");
		expect(filePath).toContain("ses-2");
	});

	test("readPawEventLog returns empty for missing file", async () => {
		const root = await createTempRepo();
		const events = await readPawEventLog(root, "missing");
		expect(events).toEqual([]);
	});

	test("skips malformed lines on read", async () => {
		const root = await createTempRepo();
		await mkdir(join(root, ".paw", "sessions", "ses-3"), { recursive: true });
		await writeFile(
			join(root, ".paw", "sessions", "ses-3", "events.jsonl"),
			`{"ts":"2026-06-19T00:00:00.000Z","session_id":"ses-3","slice_id":null,"event":"session_started"}\nnot-json\n`,
			"utf-8",
		);
		const events = await readPawEventLog(root, "ses-3");
		expect(events).toHaveLength(1);
	});
});
