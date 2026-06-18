
import { describe, expect, test } from "vitest";
import {
	evaluatePawEditIdempotency,
	evaluatePawNextEditAttempt,
	loadDefaultPawRuntimeConfig,
} from "../src/paw/index.ts";

describe("Paw edit strategy policy", () => {
	test("uses loaded default edit strategy limits", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(config.edit).toEqual({
			strategy: "diff_first",
			fuzzy_apply_retries: 2,
			full_file_rewrite_max_lines: 400,
			idempotency: "content_hash_compare",
		});
	});

	test("first attempt returns diff", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(
			evaluatePawNextEditAttempt({
				config: config.edit,
				failedAttempts: 0,
				fileLineCount: 20,
			}),
		).toMatchObject({
			status: "apply",
			method: "diff",
		});
	});

	test("diff failure returns first fuzzy attempt", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(
			evaluatePawNextEditAttempt({
				config: config.edit,
				previousMethod: "diff",
				failedAttempts: 1,
				fileLineCount: 20,
				failingHunk: "@@ -1 +1 @@",
			}),
		).toMatchObject({
			status: "apply",
			method: "fuzzy_diff",
		});
	});

	test("fuzzy attempt can be retried up to two total fuzzy attempts", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(
			evaluatePawNextEditAttempt({
				config: config.edit,
				previousMethod: "fuzzy_diff",
				failedAttempts: 1,
				fileLineCount: 20,
			}),
		).toMatchObject({
			status: "apply",
			method: "fuzzy_diff",
		});
	});

	test("after fuzzy retries exhausted, small file returns full_file", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(
			evaluatePawNextEditAttempt({
				config: config.edit,
				previousMethod: "fuzzy_diff",
				failedAttempts: 2,
				fileLineCount: 400,
			}),
		).toMatchObject({
			status: "apply",
			method: "full_file",
		});
	});

	test("after fuzzy retries exhausted, large file blocks PATCH_APPLY_FAILED", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(
			evaluatePawNextEditAttempt({
				config: config.edit,
				previousMethod: "fuzzy_diff",
				failedAttempts: 2,
				fileLineCount: 401,
				failingHunk: "@@ -2 +2 @@",
			}),
		).toMatchObject({
			status: "blocked",
			method: "blocked",
			code: "PATCH_APPLY_FAILED",
			failingHunk: "@@ -2 +2 @@",
		});
	});

	test("full-file failure blocks PATCH_APPLY_FAILED", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(
			evaluatePawNextEditAttempt({
				config: config.edit,
				previousMethod: "full_file",
				failedAttempts: 1,
				fileLineCount: 20,
				failingHunk: "rewrite failed",
			}),
		).toMatchObject({
			status: "blocked",
			method: "blocked",
			code: "PATCH_APPLY_FAILED",
			failingHunk: "rewrite failed",
		});
	});

	test("idempotency returns noop when current hash equals expected result hash", () => {
		expect(
			evaluatePawEditIdempotency({
				currentHash: "result",
				expectedBaseHash: "base",
				expectedResultHash: "result",
			}),
		).toMatchObject({
			status: "noop",
		});
	});

	test("idempotency returns rederive when current hash differs from expected base hash", () => {
		expect(
			evaluatePawEditIdempotency({
				currentHash: "drifted",
				expectedBaseHash: "base",
				expectedResultHash: "result",
			}),
		).toMatchObject({
			status: "rederive",
		});
	});

	test("idempotency returns apply when current hash equals expected base hash", () => {
		expect(
			evaluatePawEditIdempotency({
				currentHash: "base",
				expectedBaseHash: "base",
				expectedResultHash: "result",
			}),
		).toMatchObject({
			status: "apply",
		});
	});
});
