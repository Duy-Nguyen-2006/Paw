import { describe, expect, test } from "vitest";
import { createPawNativeVerificationPlan } from "../src/paw/verification-plan.ts";
import { type PawNativeVerificationExecutor, runPawNativeVerificationPlan } from "../src/paw/verification-runner.ts";

describe("Paw native verification runner", () => {
	test("executes planned gates through an injected executor and preserves honest outcomes", async () => {
		const plan = createPawNativeVerificationPlan(["working_tree_baseline", "unit_tests", "build", "custom_gate"]);
		const executedCommands: string[] = [];
		const executor: PawNativeVerificationExecutor = async (input) => {
			executedCommands.push(input.command.join(" "));
			if (input.gate === "working_tree_baseline") {
				return { exitCode: 0, stdout: "", stderr: "" };
			}
			if (input.gate === "unit_tests") {
				return { exitCode: 1, stdout: "red test output", stderr: "expected failure" };
			}
			return { exitCode: 124, stdout: "partial build output", stderr: "", timedOut: true };
		};

		const results = await runPawNativeVerificationPlan(plan, executor, {
			timeoutSec: 120,
			outputMaxChars: 12,
		});

		expect(executedCommands).toEqual(["git status --short", "./test.sh", "npm run build"]);
		expect(results.find((result) => result.gate === "working_tree_baseline")).toMatchObject({
			status: "verified",
			verified: true,
			exitCode: 0,
			executed: true,
		});
		expect(results.find((result) => result.gate === "unit_tests")).toMatchObject({
			status: "unverified",
			verified: false,
			exitCode: 1,
			executed: true,
			reason: "Native verification command failed with exit code 1: red test ...",
		});
		expect(results.find((result) => result.gate === "build")).toMatchObject({
			status: "unverified",
			verified: false,
			exitCode: 124,
			executed: true,
			reason: "Native verification command timed out after 120 seconds.",
		});
		expect(results.find((result) => result.gate === "custom_gate")).toMatchObject({
			status: "unverified",
			verified: false,
			executed: false,
			reason: "No native command mapping is defined for verification gate custom_gate.",
		});
	});
});
