
import { describe, expect, test } from "vitest";
import {
	evaluatePawSubAgentResponse,
	type PawSubAgentOutput,
	type PawSubAgentRole,
	validatePawSubAgentOutput,
} from "../src/paw/index.ts";

function createPawSubAgentOutput(
	agent: PawSubAgentRole,
	overrides: Partial<PawSubAgentOutput> = {},
): PawSubAgentOutput {
	const output: PawSubAgentOutput = {
		status: "pass",
		confidence: "high",
		agent,
		session_id: "session-1",
		slice_id: "slice-1",
		artifact_ref: `.paw/artifacts/session-1/${agent}/report.md`,
		changed_files: [],
		inspected_files: [],
		risks: [],
		next_actions: [],
		tokens_used: 42,
		usd_cost: 0.01,
		degraded: false,
		model_used: "model-1",
		...overrides,
	};

	return output;
}

describe("evaluatePawSubAgentResponse", () => {
	test("accepts valid worker output and returns the parsed value", () => {
		const output = createPawSubAgentOutput("worker");
		const decision = evaluatePawSubAgentResponse({
			rawOutput: JSON.stringify(output),
			attemptNumber: 1,
			expectedAgent: "worker",
			expectedSessionId: "session-1",
			expectedArtifactRef: ".paw/artifacts/session-1/worker/report.md",
			expectedSliceId: "slice-1",
		});

		expect(decision).toEqual({
			status: "accepted",
			output,
			attempts: 1,
		});
	});

	test("returns retry with a root issue and message for invalid JSON on attempt 1", () => {
		const decision = evaluatePawSubAgentResponse({
			rawOutput: "{not json",
			attemptNumber: 1,
			expectedAgent: "worker",
			expectedSessionId: "session-1",
			expectedArtifactRef: ".paw/artifacts/session-1/worker/report.md",
			expectedSliceId: "slice-1",
		});

		expect(decision.status).toBe("retry");
		if (decision.status === "retry") {
			expect(decision.attempts).toBe(1);
			expect(decision.issues[0]?.path).toBe("/");
			expect(decision.message).toContain("Sub-agent response did not match the required contract");
			expect(decision.message).toContain("/");
		}
	});

	test("returns retry with a path-level issue for invalid schema on attempt 1", () => {
		const decision = evaluatePawSubAgentResponse({
			rawOutput: JSON.stringify({
				status: "done",
				confidence: "high",
				agent: "worker",
				session_id: "session-1",
				slice_id: "slice-1",
				artifact_ref: ".paw/artifacts/session-1/worker/report.md",
				changed_files: [],
				inspected_files: [],
				risks: [],
				next_actions: [],
				tokens_used: 0,
				usd_cost: 0,
				degraded: false,
			}),
			attemptNumber: 1,
			expectedAgent: "worker",
			expectedSessionId: "session-1",
			expectedArtifactRef: ".paw/artifacts/session-1/worker/report.md",
			expectedSliceId: "slice-1",
		});

		expect(decision.status).toBe("retry");
		if (decision.status === "retry") {
			expect(decision.issues.map((issue) => issue.path)).toContain("/status");
		}
	});

	test("returns blocked output that validates for invalid JSON on attempt 2", () => {
		const decision = evaluatePawSubAgentResponse({
			rawOutput: "{not json",
			attemptNumber: 2,
			expectedAgent: "worker",
			expectedSessionId: "session-1",
			expectedArtifactRef: ".paw/artifacts/session-1/worker/report.md",
			expectedSliceId: "slice-1",
			modelUsed: "model-2",
		});

		expect(decision.status).toBe("blocked");
		if (decision.status === "blocked") {
			expect(decision.output.status).toBe("blocked");
			expect(decision.output.model_used).toBe("model-2");
			expect(validatePawSubAgentOutput(decision.output).ok).toBe(true);
		}
	});

	test("returns retry first and blocked when metadata mismatch attempts are exhausted", () => {
		const output = createPawSubAgentOutput("worker", {
			session_id: "session-2",
		});
		const firstDecision = evaluatePawSubAgentResponse({
			rawOutput: JSON.stringify(output),
			attemptNumber: 1,
			expectedAgent: "worker",
			expectedSessionId: "session-1",
			expectedArtifactRef: ".paw/artifacts/session-1/worker/report.md",
			expectedSliceId: "slice-1",
		});
		const secondDecision = evaluatePawSubAgentResponse({
			rawOutput: JSON.stringify(output),
			attemptNumber: 2,
			expectedAgent: "worker",
			expectedSessionId: "session-1",
			expectedArtifactRef: ".paw/artifacts/session-1/worker/report.md",
			expectedSliceId: "slice-1",
		});

		expect(firstDecision.status).toBe("retry");
		if (firstDecision.status === "retry") {
			expect(firstDecision.issues.map((issue) => issue.path)).toContain("/session_id");
		}
		expect(secondDecision.status).toBe("blocked");
		if (secondDecision.status === "blocked") {
			expect(secondDecision.issues.map((issue) => issue.path)).toContain("/session_id");
			expect(secondDecision.output.session_id).toBe("session-1");
			expect(validatePawSubAgentOutput(secondDecision.output).ok).toBe(true);
		}
	});

	test("enforces expected null slice id for planner and scout style responses", () => {
		const plannerOutput = createPawSubAgentOutput("planner", {
			slice_id: null,
			artifact_ref: ".paw/artifacts/session-1/planner/report.md",
			plan_slices: [],
		});
		const plannerDecision = evaluatePawSubAgentResponse({
			rawOutput: JSON.stringify(plannerOutput),
			attemptNumber: 1,
			expectedAgent: "planner",
			expectedSessionId: "session-1",
			expectedArtifactRef: ".paw/artifacts/session-1/planner/report.md",
			expectedSliceId: null,
		});
		const scoutOutput = createPawSubAgentOutput("scout", {
			slice_id: undefined,
			artifact_ref: ".paw/artifacts/session-1/scout/report.md",
		});
		const scoutDecision = evaluatePawSubAgentResponse({
			rawOutput: JSON.stringify(scoutOutput),
			attemptNumber: 1,
			expectedAgent: "scout",
			expectedSessionId: "session-1",
			expectedArtifactRef: ".paw/artifacts/session-1/scout/report.md",
			expectedSliceId: null,
		});

		expect(plannerDecision.status).toBe("accepted");
		expect(scoutDecision.status).toBe("retry");
		if (scoutDecision.status === "retry") {
			expect(scoutDecision.issues).toContainEqual({
				path: "/slice_id",
				message: "Expected null but received undefined",
			});
		}
	});
});
