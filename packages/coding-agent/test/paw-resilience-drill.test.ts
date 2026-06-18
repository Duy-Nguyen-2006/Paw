
import { describe, expect, test } from "vitest";
import {
	evaluatePawResilienceDrill,
	type PawResilienceDrillEvent,
	type PawResilienceDrillInput,
} from "../src/paw/index.ts";

const PASSING_EVENTS: readonly PawResilienceDrillEvent[] = [
	{ name: "provider_failure" },
	{ name: "retry_attempted" },
	{ name: "failover_started" },
	{ name: "degraded_marked" },
	{ name: "resume_started" },
	{ name: "resume_completed" },
	{ name: "final_report_emitted" },
	{ name: "no_data_loss_confirmed" },
];

function evaluateWithEvents(events: readonly PawResilienceDrillEvent[]) {
	const input: PawResilienceDrillInput = {
		providerName: "primary",
		sessionId: "session-025",
		events,
	};

	return evaluatePawResilienceDrill(input);
}

describe("Paw resilience drill evaluator", () => {
	test("passes when injected provider failure recovers with no data loss", () => {
		const result = evaluateWithEvents(PASSING_EVENTS);

		expect(result).toMatchObject({
			ok: true,
			status: "PASS",
			issues: [],
		});
		expect(result.evidence).toContain("provider failure");
		expect(result.evidence).toContain("failover");
		expect(result.evidence).toContain("degraded flag");
		expect(result.evidence).toContain("resume");
		expect(result.evidence).toContain("final report");
		expect(result.evidence).toContain("no-data-loss confirmation");
		expect(result.evidence).toContain("primary");
		expect(result.evidence).toContain("session-025");
	});

	test("kills when failover is missing after provider failure", () => {
		const result = evaluateWithEvents(PASSING_EVENTS.filter((event) => event.name !== "failover_started"));

		expect(result).toMatchObject({
			ok: false,
			status: "KILL",
			issues: [{ path: "/events/failover_started", message: expect.stringContaining("Missing failover") }],
		});
	});

	test("kills when degraded flag is missing", () => {
		const result = evaluateWithEvents(PASSING_EVENTS.filter((event) => event.name !== "degraded_marked"));

		expect(result).toMatchObject({
			ok: false,
			status: "KILL",
			issues: [{ path: "/events/degraded_marked", message: expect.stringContaining("Missing degraded") }],
		});
	});

	test("kills when resume completion is missing", () => {
		const result = evaluateWithEvents(PASSING_EVENTS.filter((event) => event.name !== "resume_completed"));

		expect(result).toMatchObject({
			ok: false,
			status: "KILL",
			issues: [{ path: "/events/resume_completed", message: expect.stringContaining("Missing resume completion") }],
		});
	});

	test("kills when final report emission is missing", () => {
		const result = evaluateWithEvents(PASSING_EVENTS.filter((event) => event.name !== "final_report_emitted"));

		expect(result).toMatchObject({
			ok: false,
			status: "KILL",
			issues: [{ path: "/events/final_report_emitted", message: expect.stringContaining("Missing final report") }],
		});
	});

	test("kills when no-data-loss confirmation is missing", () => {
		const result = evaluateWithEvents(PASSING_EVENTS.filter((event) => event.name !== "no_data_loss_confirmed"));

		expect(result).toMatchObject({
			ok: false,
			status: "KILL",
			issues: [
				{
					path: "/events/no_data_loss_confirmed",
					message: expect.stringContaining("Missing no-data-loss confirmation"),
				},
			],
		});
	});

	test("kills when data loss is detected", () => {
		const result = evaluateWithEvents([...PASSING_EVENTS, { name: "data_loss_detected" }]);

		expect(result).toMatchObject({
			ok: false,
			status: "KILL",
			issues: [{ path: "/events/data_loss_detected", message: expect.stringContaining("Data loss detected") }],
		});
	});
});
