import { describe, expect, test } from "vitest";
import { readPawReviewerDiff, reviewPawDiffForRules } from "../src/paw/reviewer-diff.ts";

describe("reviewPawDiffForRules", () => {
	test("flags secret path", () => {
		const result = reviewPawDiffForRules({
			scope: "working",
			entries: [{ path: ".env", change_type: "modify", content_hash: null }],
			rawDiff: null,
			rationales: [],
		});
		expect(result.ok).toBe(false);
		expect(result.findings.some((f) => f.rule === "secret_path")).toBe(true);
	});

	test("flags node_modules scope creep", () => {
		const result = reviewPawDiffForRules({
			scope: "working",
			entries: [{ path: "node_modules/foo/index.js", change_type: "create", content_hash: null }],
			rawDiff: null,
			rationales: [],
		});
		expect(result.findings.some((f) => f.rule === "scope_creep")).toBe(true);
	});

	test("flags secret leak in diff body", () => {
		// Build the secret-like value at runtime from parts to keep the test fixture file clean.
		const fakeSecret = `api_key = "EXAMPLE_KEY_${"x".repeat(28)}"`;
		const result = reviewPawDiffForRules({
			scope: "working",
			entries: [{ path: "src/config.ts", change_type: "modify", content_hash: null }],
			rawDiff: `+const config = ${fakeSecret};\n`,
			rationales: [],
		});
		expect(result.findings.some((f) => f.rule === "secret_leak")).toBe(true);
	});

	test("clean diff is ok", () => {
		const result = reviewPawDiffForRules({
			scope: "working",
			entries: [{ path: "src/a.ts", change_type: "modify", content_hash: "sha256:abc" }],
			rawDiff: "+export const a = 1;\n",
			rationales: [],
		});
		expect(result.ok).toBe(true);
	});

	test("empty diff is info-only", () => {
		const result = reviewPawDiffForRules({
			scope: "working",
			entries: [],
			rawDiff: null,
			rationales: [],
		});
		expect(result.ok).toBe(true);
		expect(result.findings[0]?.rule).toBe("no_diff");
	});
});

describe("readPawReviewerDiff", () => {
	test("returns empty entries with no command runner for working scope", async () => {
		const result = await readPawReviewerDiff({
			repoRoot: "/tmp",
			sessionId: null,
			scope: "working",
			commandRunner: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
		});
		expect(result.entries).toEqual([]);
	});

	test("parses name-status output", async () => {
		const result = await readPawReviewerDiff({
			repoRoot: "/tmp",
			sessionId: null,
			scope: "working",
			commandRunner: async ({ args }) => {
				if (args.includes("--name-status")) {
					return { exitCode: 0, stdout: "A\tnew.ts\nM\texisting.ts\n", stderr: "" };
				}
				return { exitCode: 0, stdout: "", stderr: "" };
			},
		});
		expect(result.entries).toHaveLength(2);
		expect(result.entries[0]?.change_type).toBe("create");
		expect(result.entries[1]?.change_type).toBe("modify");
	});
});
