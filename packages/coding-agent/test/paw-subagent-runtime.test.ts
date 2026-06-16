import { describe, expect, test } from "vitest";
import {
	type PawSubAgentOutput,
	type PawSubAgentRole,
	type PawSubAgentRuntimeExecutor,
	type PawSubAgentRuntimeInvocation,
	runPawSubAgentRuntime,
	validatePawSubAgentOutput,
} from "../src/paw/index.ts";

function createInvocation(overrides: Partial<PawSubAgentRuntimeInvocation> = {}): PawSubAgentRuntimeInvocation {
	return {
		role: "worker",
		session_id: "session-1",
		slice_id: "slice-1",
		artifact_ref: ".paw/artifacts/session-1/worker/report.md",
		handoff: "Implement the selected slice.",
		handoff_token_estimate: 32,
		max_handoff_tokens: 100,
		attempt_number: 1,
		model_id: "requested-model",
		...overrides,
	};
}

function createPawSubAgentOutput(
	agent: PawSubAgentRole,
	overrides: Partial<PawSubAgentOutput> = {},
): PawSubAgentOutput {
	return {
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
}

describe("runPawSubAgentRuntime", () => {
	test("accepts valid executor output", async () => {
		const output = createPawSubAgentOutput("worker");
		const receivedInvocations: PawSubAgentRuntimeInvocation[] = [];
		const executor: PawSubAgentRuntimeExecutor = (invocation) => {
			receivedInvocations.push(invocation);
			return { raw_output: JSON.stringify(output), model_id: "executor-model" };
		};

		const decision = await runPawSubAgentRuntime(createInvocation(), executor);

		expect(receivedInvocations).toEqual([createInvocation()]);
		expect(decision.status).toBe("accepted");
		expect(decision.attempts).toBe(1);
		if (decision.status === "accepted") {
			expect(decision.output).toEqual(output);
		}
	});

	test("returns retry for invalid executor JSON before attempts are exhausted", async () => {
		const decision = await runPawSubAgentRuntime(createInvocation(), () => ({ raw_output: "{not json" }));

		expect(decision.status).toBe("retry");
		expect(decision.attempts).toBe(1);
		if (decision.status === "retry") {
			expect(decision.issues[0]?.path).toBe("/");
			expect(decision.message).toContain("Sub-agent response did not match the required contract");
		}
	});

	test("returns blocked output for invalid executor JSON when attempts are exhausted", async () => {
		const decision = await runPawSubAgentRuntime(
			createInvocation({ attempt_number: 2, model_id: "requested-model-2" }),
			() => ({ raw_output: "{not json", model_id: "executor-model-2" }),
		);

		expect(decision.status).toBe("blocked");
		expect(decision.attempts).toBe(2);
		if (decision.status === "blocked") {
			expect(decision.output.status).toBe("blocked");
			expect(decision.output.model_used).toBe("executor-model-2");
			expect(validatePawSubAgentOutput(decision.output).ok).toBe(true);
		}
	});

	test("blocks oversized handoff without invoking executor", async () => {
		let executorCalls = 0;
		const decision = await runPawSubAgentRuntime(
			createInvocation({ handoff_token_estimate: 101, max_handoff_tokens: 100 }),
			() => {
				executorCalls += 1;
				return { raw_output: JSON.stringify(createPawSubAgentOutput("worker")) };
			},
		);

		expect(executorCalls).toBe(0);
		expect(decision.status).toBe("blocked");
		expect(decision.attempts).toBe(1);
		if (decision.status === "blocked") {
			expect(decision.issues).toContainEqual({
				path: "/handoff_token_estimate",
				message: "Estimated handoff tokens 101 exceed max_handoff_tokens 100.",
			});
			expect(decision.output.status).toBe("blocked");
			expect(decision.output.blocked_reason?.code).toBe("BUDGET_EXCEEDED");
			expect(validatePawSubAgentOutput(decision.output).ok).toBe(true);
		}
	});
});
