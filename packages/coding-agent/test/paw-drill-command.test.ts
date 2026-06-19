import { describe, expect, test } from "vitest";
import { type PawCrashResumeCheck, parsePawDrillArgs, runPawSecretRedactionDrill } from "../src/paw/drill-command.ts";
import { loadDefaultPawRuntimeConfig } from "../src/paw/index.ts";

const sourceRoot = (() => {
	const { join } = require("node:path") as typeof import("node:path");
	return join(import.meta.dirname, "..", "..", "..");
})();

describe("paw drill command parser", () => {
	test("rejects unknown drill name", () => {
		const result = parsePawDrillArgs(["nope"]);
		expect(result.kind).toBe("error");
	});

	test("parses secret-redaction with --json", () => {
		const result = parsePawDrillArgs(["secret-redaction", "--json"]);
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.args.drill).toBe("secret-redaction");
		expect(result.args.reportJson).toBe(true);
	});

	test("rejects unknown option", () => {
		const result = parsePawDrillArgs(["crash-resume", "--unknown"]);
		expect(result.kind).toBe("error");
	});

	test("help on empty args", () => {
		expect(parsePawDrillArgs([]).kind).toBe("help");
	});
});

describe("runPawSecretRedactionDrill", () => {
	test("detects API key, token, header, and env values", async () => {
		const config = loadDefaultPawRuntimeConfig(sourceRoot);
		const result = await runPawSecretRedactionDrill({ configLoader: () => config });
		const patterns = result.checks.map((check) => check.pattern);
		expect(patterns).toContain("api_keys");
		expect(patterns).toContain("tokens");
		expect(patterns).toContain("private_keys");
		expect(patterns).toContain("auth_headers");
		expect(patterns).toContain("cookies");
		expect(patterns).toContain("env_values");
	});

	test("returns PASS when all expected redactions match", async () => {
		const config = loadDefaultPawRuntimeConfig(sourceRoot);
		const result = await runPawSecretRedactionDrill({ configLoader: () => config });
		expect(result.status).toBe("PASS");
		expect(result.evidence).toMatch(/\d+\/\d+ redaction checks passed/);
	});
});

describe("PawCrashResumeCheck type", () => {
	test("can be created and used as a check descriptor", () => {
		const check: PawCrashResumeCheck = {
			state: "IDLE",
			passed: true,
			detail: "ok",
		};
		expect(check.passed).toBe(true);
	});
});
