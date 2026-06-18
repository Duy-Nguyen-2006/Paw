import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
	appendPawSliceJournalEntry,
	findPawAppliedChange,
	hasPawAppliedChange,
	type PawSliceJournalEntry,
	readPawSliceJournal,
	resolvePawSessionPaths,
} from "../src/paw/index.ts";

const tempRoots: string[] = [];

async function createTempRepo(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-slice-journal-"));
	tempRoots.push(root);
	return root;
}

function createEntry(overrides: Partial<PawSliceJournalEntry> = {}): PawSliceJournalEntry {
	return {
		session_id: "session-1",
		slice_id: "slice-1",
		path: "src/example.ts",
		change_type: "modify",
		content_hash: "sha256:abc123",
		apply_method: "diff",
		timestamp: "2026-06-16T00:00:00.000Z",
		...overrides,
	};
}

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Paw slice journal", () => {
	test("reading absent journal returns an empty list", async () => {
		const repoRoot = await createTempRepo();

		await expect(readPawSliceJournal(repoRoot, "session-1")).resolves.toEqual([]);
	});

	test("appending creates the session journal and stores one JSON object per line", async () => {
		const repoRoot = await createTempRepo();
		const paths = resolvePawSessionPaths(repoRoot, "session-1");
		const entry = createEntry();

		await appendPawSliceJournalEntry(repoRoot, entry);

		const lines = (await readFile(paths.sliceJournalFile, "utf-8")).trimEnd().split("\n");
		expect(lines).toHaveLength(1);
		expect(JSON.parse(lines[0])).toEqual(entry);
	});

	test("appending two entries preserves order and reads both", async () => {
		const repoRoot = await createTempRepo();
		const first = createEntry({ slice_id: "slice-1", content_hash: "sha256:first" });
		const second = createEntry({
			slice_id: "slice-2",
			path: "src/other.ts",
			change_type: "create",
			content_hash: "sha256:second",
			apply_method: "full_file",
			timestamp: "2026-06-16T00:01:00.000Z",
		});

		await appendPawSliceJournalEntry(repoRoot, first);
		await appendPawSliceJournalEntry(repoRoot, second);

		await expect(readPawSliceJournal(repoRoot, "session-1")).resolves.toEqual([first, second]);
	});

	test("blank trailing line is ignored", async () => {
		const repoRoot = await createTempRepo();
		const paths = resolvePawSessionPaths(repoRoot, "session-1");
		const entry = createEntry();
		await appendPawSliceJournalEntry(repoRoot, entry);
		await appendFile(paths.sliceJournalFile, "\n", "utf-8");

		await expect(readPawSliceJournal(repoRoot, "session-1")).resolves.toEqual([entry]);
	});

	test("malformed JSON line throws with line number", async () => {
		const repoRoot = await createTempRepo();
		const paths = resolvePawSessionPaths(repoRoot, "session-1");
		await appendPawSliceJournalEntry(repoRoot, createEntry());
		await appendFile(paths.sliceJournalFile, "{not json}\n", "utf-8");

		await expect(readPawSliceJournal(repoRoot, "session-1")).rejects.toThrow(
			"Invalid Paw slice journal JSON on line 2",
		);
	});

	test("invalid entry shape throws a useful error", async () => {
		const repoRoot = await createTempRepo();
		const paths = resolvePawSessionPaths(repoRoot, "session-1");
		await mkdir(dirname(paths.sliceJournalFile), { recursive: true });
		await writeFile(
			paths.sliceJournalFile,
			`${JSON.stringify({
				session_id: "session-1",
				slice_id: "slice-1",
				path: "src/example.ts",
				change_type: "copy",
				content_hash: "sha256:abc123",
				timestamp: "2026-06-16T00:00:00.000Z",
			})}\n`,
			"utf-8",
		);

		await expect(readPawSliceJournal(repoRoot, "session-1")).rejects.toThrow(
			"Invalid Paw slice journal entry on line 1: /change_type Expected one of create, modify, delete, rename.",
		);
	});

	test("lookup matches same slice, path, and hash only", () => {
		const entries = [createEntry(), createEntry({ slice_id: "slice-2", content_hash: "sha256:def456" })];

		expect(
			hasPawAppliedChange(entries, {
				sliceId: "slice-1",
				path: "src/example.ts",
				contentHash: "sha256:abc123",
			}),
		).toBe(true);
		expect(
			findPawAppliedChange(entries, {
				sliceId: "slice-1",
				path: "src/example.ts",
				contentHash: "sha256:changed",
			}),
		).toBeNull();
		expect(
			hasPawAppliedChange(entries, {
				sliceId: "slice-3",
				path: "src/example.ts",
				contentHash: "sha256:abc123",
			}),
		).toBe(false);
	});
});
