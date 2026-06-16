import { describe, expect, test } from "vitest";
import {
	createPawFinalReport,
	type PawDegradedStep,
	type PawFinalReportRisk,
	type PawVerifyGateDecision,
	renderPawFinalReportMarkdown,
} from "../src/paw/index.ts";

const verifiedUnitGate: PawVerifyGateDecision = {
	status: "verified",
	gate: "unit_tests",
	verified: true,
	applicable: true,
	gateSet: "v1",
};

const unverifiedLintGate: PawVerifyGateDecision = {
	status: "unverified",
	gate: "lint",
	verified: false,
	applicable: true,
	gateSet: "v1",
	reason: "lint command unavailable",
};

describe("Paw final report assembly", () => {
	test("all applicable gates verified returns done and verified gate list", () => {
		const report = createPawFinalReport({
			sessionId: "session-1",
			summary: "Implemented report assembly.",
			evidence: ["focused test passed"],
			verifyDecisions: [verifiedUnitGate],
		});

		expect(report.status).toBe("done");
		expect(report.verified_gates).toEqual([verifiedUnitGate]);
		expect(report.unverified_gates).toEqual([]);
	});

	test("applicable unverified gate returns done_with_unverified and keeps reason", () => {
		const report = createPawFinalReport({
			sessionId: "session-1",
			summary: "Implemented report assembly.",
			evidence: ["focused test passed"],
			verifyDecisions: [verifiedUnitGate, unverifiedLintGate],
		});

		expect(report.status).toBe("done_with_unverified");
		expect(report.unverified_gates).toEqual([unverifiedLintGate]);
	});

	test("non-applicable unverified gates do not change status", () => {
		const nonApplicableGate: PawVerifyGateDecision = {
			status: "unverified",
			gate: "v2_security_scan",
			verified: false,
			applicable: false,
			gateSet: "v2",
			reason: "v2 gate is not enabled",
		};

		const report = createPawFinalReport({
			sessionId: "session-1",
			summary: "Implemented report assembly.",
			evidence: ["focused test passed"],
			verifyDecisions: [verifiedUnitGate, nonApplicableGate],
		});

		expect(report.status).toBe("done");
		expect(report.verified_gates).toEqual([verifiedUnitGate]);
		expect(report.unverified_gates).toEqual([]);
	});

	test("degraded steps and risks are preserved in order", () => {
		const risks: PawFinalReportRisk[] = [
			{ description: "First risk", severity: "medium" },
			{ description: "Second risk", severity: "high" },
		];
		const degradedSteps: PawDegradedStep[] = [
			{ step: "worker", degraded: true, reason: "provider failover" },
			{ step: "reviewer", degraded: true, reason: "timeout recovery" },
		];

		const report = createPawFinalReport({
			sessionId: "session-1",
			summary: "Implemented report assembly.",
			evidence: [" first evidence ", "", "second evidence"],
			risks,
			verifyDecisions: [],
			degradedSteps,
			nextActions: [" review follow-up ", " ", "ship"],
		});

		expect(report.evidence).toEqual(["first evidence", "second evidence"]);
		expect(report.risks).toEqual(risks);
		expect(report.degraded_steps).toEqual(degradedSteps);
		expect(report.next_actions).toEqual(["review follow-up", "ship"]);
	});

	test("markdown includes status, evidence, unverified reason, risk severity, degraded reason, and none sections", () => {
		const report = createPawFinalReport({
			sessionId: "session-1",
			summary: "Implemented report assembly.",
			evidence: ["focused test passed"],
			risks: [{ description: "Missing broad check", severity: "low" }],
			verifyDecisions: [unverifiedLintGate],
			degradedSteps: [{ step: "worker", degraded: true, reason: "provider failover" }],
		});

		const markdown = renderPawFinalReportMarkdown(report);

		expect(markdown).toContain("## Status\n\n- done_with_unverified");
		expect(markdown).toContain("- focused test passed");
		expect(markdown).toContain("- lint: lint command unavailable");
		expect(markdown).toContain("- low: Missing broad check");
		expect(markdown).toContain("- worker: provider failover");
		expect(markdown).toContain("## Verified Gates\n\n- None");
		expect(markdown).toContain("## Next Actions\n\n- None");
	});

	test.each([
		{ sessionId: "", summary: "summary", message: "sessionId must be a non-empty string" },
		{ sessionId: "session-1", summary: "   ", message: "summary must be a non-empty string" },
	])("invalid session id or summary throws a useful error", ({ sessionId, summary, message }) => {
		expect(() =>
			createPawFinalReport({
				sessionId,
				summary,
				evidence: [],
				verifyDecisions: [],
			}),
		).toThrow(message);
	});
});
