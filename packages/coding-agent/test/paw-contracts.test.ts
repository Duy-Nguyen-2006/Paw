import { describe, expect, test } from "vitest";
import {
	loadDefaultPawRuntimeConfig,
	type PawSubAgentOutput,
	parsePawRuntimeConfigYaml,
	validatePawSubAgentOutput,
} from "../src/paw/index.ts";

function validationPaths(result: ReturnType<typeof validatePawSubAgentOutput>): string[] {
	if (result.ok) return [];
	return result.issues.map((issue) => issue.path);
}

describe("Paw runtime config contracts", () => {
	test("loads typed defaults from paw-spec/config.yaml", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(config.version).toBe(1);
		expect(config.context.class_cap_tokens.standard).toBe(48000);
		expect(config.context.subagent_handoff_max_tokens.scout).toBe(4000);
		expect(config.budget.per_task.high_risk.max_usd).toBe(3);
		expect(config.approval.matrix.always_human_never_auto).toEqual(["R7"]);
		expect(config.sandbox.on_unavailable).toBe("refuse_write");
		expect(config.verify.v1_gates).toContain("unit_tests");
	});

	test("reports path-level config parsing failures", () => {
		const result = parsePawRuntimeConfigYaml("version: nope\n");

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues.some((issue) => issue.path === "/version")).toBe(true);
		}
	});
});

describe("Paw sub-agent output contracts", () => {
	test("accepts the canonical worker output shape", () => {
		const output: PawSubAgentOutput = {
			status: "pass",
			confidence: "high",
			agent: "worker",
			session_id: "session-1",
			slice_id: "slice-1",
			artifact_ref: ".paw/artifacts/session-1/worker/report.md",
			changed_files: [
				{
					path: "src/app.ts",
					change_type: "modify",
					content_hash: "sha256:abc123",
					apply_method: "diff",
				},
			],
			inspected_files: [
				{
					path: "src/app.ts",
					line_span: "1-24",
					rationale: "Worker changed this slice target.",
					rank: 1,
					required: true,
				},
			],
			risks: [],
			next_actions: [],
			tokens_used: 120,
			usd_cost: 0.02,
			degraded: false,
			model_used: "configured-mid-model",
		};

		expect(validatePawSubAgentOutput(output)).toEqual({ ok: true, value: output });
	});

	test("rejects malformed output with path-level issues", () => {
		const result = validatePawSubAgentOutput({
			status: "done",
			confidence: "high",
			agent: "worker",
			session_id: "session-1",
			artifact_ref: ".paw/artifacts/session-1/worker/full.md",
			changed_files: [],
			inspected_files: [],
			risks: [],
			next_actions: [],
			tokens_used: -1,
			usd_cost: 0,
			degraded: false,
		});

		expect(result.ok).toBe(false);
		expect(validationPaths(result)).toEqual(expect.arrayContaining(["/status", "/artifact_ref", "/tokens_used"]));
	});

	test("requires a blocked reason for blocked outputs", () => {
		const result = validatePawSubAgentOutput({
			status: "blocked",
			confidence: "medium",
			agent: "reviewer",
			session_id: "session-1",
			artifact_ref: ".paw/artifacts/session-1/reviewer/report.md",
			changed_files: [],
			inspected_files: [],
			risks: [],
			next_actions: [],
			tokens_used: 0,
			usd_cost: 0,
			degraded: false,
		});

		expect(result.ok).toBe(false);
		expect(validationPaths(result)).toContain("/blocked_reason");
	});

	test("requires planner slices for passing planner outputs", () => {
		const result = validatePawSubAgentOutput({
			status: "pass",
			confidence: "high",
			agent: "planner",
			session_id: "session-1",
			artifact_ref: ".paw/artifacts/session-1/planner/report.md",
			changed_files: [],
			inspected_files: [],
			risks: [],
			next_actions: [],
			tokens_used: 20,
			usd_cost: 0.01,
			degraded: false,
		});

		expect(result.ok).toBe(false);
		expect(validationPaths(result)).toContain("/plan_slices");
	});
});
