import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { PawFileMemoryStore } from "../src/paw/index.ts";

const tempRoots: string[] = [];

afterEach(() => {
	for (const root of tempRoots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

function tempStore(): PawFileMemoryStore {
	const root = mkdtempSync(join(tmpdir(), "paw-memory-"));
	tempRoots.push(root);
	return new PawFileMemoryStore({ filePath: join(root, "memory.json") });
}

describe("PawFileMemoryStore", () => {
	test("add and get entry", async () => {
		const store = tempStore();
		await store.add({ key: "preferred-test", value: "vitest", tags: ["test", "preference"] });
		const got = await store.get("preferred-test");
		expect(got?.value).toBe("vitest");
	});

	test("deduplicates identical entries", async () => {
		const store = tempStore();
		const first = await store.add({ key: "k", value: "v" });
		const second = await store.add({ key: "k", value: "v" });
		expect(first.id).toBe(second.id);
		const tagResults = await store.listByTag("k");
		// no tags - list by tag won't return anything
		expect(tagResults).toEqual([]);
	});

	test("prunes expired entries", async () => {
		const store = tempStore();
		await store.add({ key: "temp", value: "v", ttlSec: 1 });
		const removed = await store.prune(new Date(Date.now() + 10_000));
		expect(removed).toBe(1);
		const after = await store.get("temp");
		expect(after).toBeNull();
	});

	test("list by tag returns matching entries", async () => {
		const store = tempStore();
		await store.add({ key: "k1", value: "v1", tags: ["lint"] });
		await store.add({ key: "k2", value: "v2", tags: ["build"] });
		await store.add({ key: "k3", value: "v3", tags: ["lint"] });
		const lint = await store.listByTag("lint");
		expect(lint).toHaveLength(2);
	});
});
