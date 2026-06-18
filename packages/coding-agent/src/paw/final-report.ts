
import type { PawDegradedStep, PawVerifyGateDecision } from "./resilience-policy.ts";
import type { PawNativeVerificationRunResult } from "./verification-runner.ts";

export type PawFinalReportStatus = "done" | "done_with_unverified";

export type PawFinalReportRisk = {
	description: string;
	severity: "low" | "medium" | "high" | "critical";
};

export type PawFinalReportInput = {
	sessionId: string;
	summary: string;
	evidence: string[];
	risks?: PawFinalReportRisk[];
	verifyDecisions: PawVerifyGateDecision[];
	degradedSteps?: PawDegradedStep[];
	nextActions?: string[];
	nativeVerificationRunResults?: readonly PawNativeVerificationRunResult[];
};

export type PawFinalReport = {
	session_id: string;
	summary: string;
	status: PawFinalReportStatus;
	evidence: string[];
	risks: PawFinalReportRisk[];
	verified_gates: PawVerifyGateDecision[];
	unverified_gates: PawVerifyGateDecision[];
	degraded_steps: PawDegradedStep[];
	next_actions: string[];
	native_verification_run_results: readonly PawNativeVerificationRunResult[];
};

export function createPawFinalReport(input: PawFinalReportInput): PawFinalReport {
	const sessionId = requireNonEmptyString(input.sessionId, "sessionId");
	const summary = requireNonEmptyString(input.summary, "summary");
	const verifiedGates = input.verifyDecisions.filter(
		(decision) => decision.status === "verified" && decision.applicable,
	);
	const unverifiedGates = input.verifyDecisions.filter(
		(decision) => decision.status === "unverified" && decision.applicable,
	);

	return {
		session_id: sessionId,
		summary,
		status: unverifiedGates.length > 0 ? "done_with_unverified" : "done",
		evidence: trimNonEmptyStrings(input.evidence),
		risks: input.risks ?? [],
		verified_gates: verifiedGates,
		unverified_gates: unverifiedGates,
		degraded_steps: input.degradedSteps ?? [],
		next_actions: trimNonEmptyStrings(input.nextActions ?? []),
		native_verification_run_results: input.nativeVerificationRunResults ?? [],
	};
}

export function renderPawFinalReportMarkdown(report: PawFinalReport): string {
	return [
		"## Summary",
		"",
		`Session: ${report.session_id}`,
		"",
		report.summary,
		"",
		"## Status",
		"",
		`- ${report.status}`,
		"",
		"## Evidence",
		"",
		renderStringList(report.evidence),
		"",
		"## Verified Gates",
		"",
		renderVerifiedGates(report.verified_gates),
		"",
		"## Unverified Gates",
		"",
		renderUnverifiedGates(report.unverified_gates),
		"",
		"## Verification Evidence",
		"",
		renderVerificationEvidence(report.native_verification_run_results),
		"",
		"## Risks",
		"",
		renderRisks(report.risks),
		"",
		"## Degraded Steps",
		"",
		renderDegradedSteps(report.degraded_steps),
		"",
		"## Next Actions",
		"",
		renderStringList(report.next_actions),
		"",
	].join("\n");
}

function renderVerificationEvidence(results: readonly PawNativeVerificationRunResult[]): string {
	const executed = results.filter((result) => result.executed);
	if (executed.length === 0) {
		return "- No native verification gates executed";
	}

	return executed.map((result) => `- ${result.gate}: ${result.status}`).join("\n");
}

function requireNonEmptyString(value: string, fieldName: string): string {
	const trimmed = value.trim();

	if (trimmed.length === 0) {
		throw new Error(`${fieldName} must be a non-empty string`);
	}

	return trimmed;
}

function trimNonEmptyStrings(values: readonly string[]): string[] {
	return values.map((value) => value.trim()).filter((value) => value.length > 0);
}

function renderStringList(values: readonly string[]): string {
	if (values.length === 0) {
		return "- None";
	}

	return values.map((value) => `- ${value}`).join("\n");
}

function renderVerifiedGates(gates: readonly PawVerifyGateDecision[]): string {
	if (gates.length === 0) {
		return "- None";
	}

	return gates.map((gate) => `- ${gate.gate}`).join("\n");
}

function renderUnverifiedGates(gates: readonly PawVerifyGateDecision[]): string {
	if (gates.length === 0) {
		return "- None";
	}

	return gates
		.map((gate) => {
			if (gate.status === "unverified") {
				return `- ${gate.gate}: ${gate.reason}`;
			}

			return `- ${gate.gate}`;
		})
		.join("\n");
}

function renderRisks(risks: readonly PawFinalReportRisk[]): string {
	if (risks.length === 0) {
		return "- None";
	}

	return risks.map((risk) => `- ${risk.severity}: ${risk.description}`).join("\n");
}

function renderDegradedSteps(steps: readonly PawDegradedStep[]): string {
	if (steps.length === 0) {
		return "- None";
	}

	return steps.map((step) => `- ${step.step}: ${step.reason}`).join("\n");
}
