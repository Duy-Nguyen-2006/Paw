import { describe, expect, test } from "vitest";
import { parsePawDiffArgs, parsePawPlanArgs, parsePawTimelineArgs, parsePawCostArgs } from "../src/paw/index.ts";

describe("parsePawDiffArgs", () => {
	test("parses --staged --stat", () => {
		const result = parsePawDiffArgs(["--staged", "--stat"]);
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.args.scope).toBe("staged");
		expect(result.args.stat).toBe(true);
	});

	test("positional session id selects session scope", () => {
		const result = parsePawDiffArgs(["session-1"]);
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.args.scope).toBe("session");
		expect(result.args.sessionId).toBe("session-1");
	});

	test("help on empty", () => {
		expect(parsePawDiffArgs([]).kind).toBe("help");
	});

	test("rejects unknown option", () => {
		const result = parsePawDiffArgs(["--bogus"]);
		expect(result.kind).toBe("error");
	});
});

describe("parsePawPlanArgs", () => {
	test("parses session id and view", () => {
		const result = parsePawPlanArgs(["session-1", "--queue", "--acceptance"]);
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.args.sessionId).toBe("session-1");
		expect(result.args.view).toBe("queue");
		expect(result.args.showAcceptance).toBe(true);
	});

	test("rejects unknown option", () => {
		const result = parsePawPlanArgs(["session-1", "--what"]);
		expect(result.kind).toBe("error");
	});
});

describe("parsePawTimelineArgs", () => {
	test("parses --limit and session id", () => {
		const result = parsePawTimelineArgs(["session-1", "--limit", "10", "--no-journal"]);
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.args.sessionId).toBe("session-1");
		expect(result.args.limit).toBe(10);
		expect(result.args.includeJournal).toBe(false);
	});

	test("rejects non-integer limit", () => {
		const result = parsePawTimelineArgs(["session-1", "--limit", "abc"]);
		expect(result.kind).toBe("error");
	});

	test("requires session id", () => {
		const result = parsePawTimelineArgs([]);
		expect(result.kind).toBe("help");
	});
});

describe("parsePawCostArgs", () => {
	test("parses class and session id", () => {
		const result = parsePawCostArgs(["session-1", "--class", "high_risk", "--json"]);
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.args.sessionId).toBe("session-1");
		expect(result.args.taskClass).toBe("high_risk");
		expect(result.args.json).toBe(true);
	});

	test("rejects invalid class", () => {
		const result = parsePawCostArgs(["session-1", "--class", "bad"]);
		expect(result.kind).toBe("error");
	});

	test("requires session id", () => {
		const result = parsePawCostArgs([]);
		expect(result.kind).toBe("help");
	});
});
