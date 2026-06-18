
import { describe, expect, test } from "vitest";
import { createPawNativeVerificationPlan } from "../src/paw/verification-plan.ts";

describe("Paw native verification plan", () => {
	test("maps configured v1 gates to deterministic native command plans without executing them", () => {
		const plan = createPawNativeVerificationPlan([
			"working_tree_baseline",
			"dep_diff",
			"tsc",
			"eslint_ruff",
			"unit_tests",
			"build",
			"reviewer_diff",
			"a11y_lint_light",
			"custom_gate",
		]);

		expect(plan.map((entry) => entry.gate)).toEqual([
			"working_tree_baseline",
			"dep_diff",
			"tsc",
			"eslint_ruff",
			"unit_tests",
			"build",
			"reviewer_diff",
			"a11y_lint_light",
			"custom_gate",
		]);
		expect(plan.find((entry) => entry.gate === "working_tree_baseline")).toMatchObject({
			status: "planned",
			command: ["git", "status", "--short"],
			executed: false,
		});
		expect(plan.find((entry) => entry.gate === "unit_tests")).toMatchObject({
			status: "planned",
			command: ["./test.sh"],
			executed: false,
		});
		expect(plan.find((entry) => entry.gate === "custom_gate")).toMatchObject({
			status: "unsupported",
			executed: false,
			reason: "No native command mapping is defined for verification gate custom_gate.",
		});
	});
});
