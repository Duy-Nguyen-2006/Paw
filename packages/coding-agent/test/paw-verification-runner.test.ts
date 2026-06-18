import { describe, expect, test } from "vitest";
import type { PawVerifyConfig } from "../src/paw/resilience-policy.ts";
import { createPawNativeVerificationPlan } from "../src/paw/verification-plan.ts";
import {
	mapPawNativeVerificationRunResults,
	type PawNativeVerificationExecutor,
	type PawNativeVerificationRunResult,
	runPawNativeVerificationPlan,
} from "../src/paw/verification-runner.ts";

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

const TEST_CONFIG: PawVerifyConfig = {
	v1_gates: ["working_tree_baseline", "unit_tests", "build"],
	v2_optin_gates: ["tsc", "eslint_ruff"],
	parallel_native: false,
	summary_max_tokens: 512,
};

describe("mapPawNativeVerificationRunResults", () => {
	test("maps verified runner result to verified gate decision", () => {
		const results: PawNativeVerificationRunResult[] = [
			{
				status: "verified",
				gate: "working_tree_baseline",
				verified: true,
				executed: true,
				command: ["git", "status", "--short"],
				exitCode: 0,
				stdout: "",
				stderr: "",
			},
		];

		const decisions = mapPawNativeVerificationRunResults(results, TEST_CONFIG);

		expect(decisions).toHaveLength(1);
		expect(decisions[0]).toMatchObject({
			status: "verified",
			gate: "working_tree_baseline",
			verified: true,
			applicable: true,
			gateSet: "v1",
		});
	});

	test("maps unverified runner result with explicit reason to unverified gate decision", () => {
		const results: PawNativeVerificationRunResult[] = [
			{
				status: "unverified",
				gate: "unit_tests",
				verified: false,
				executed: true,
				command: ["./test.sh"],
				exitCode: 1,
				stdout: "FAIL src/foo.test.ts",
				stderr: "",
				reason: "Native verification command failed with exit code 1: FAIL src/foo.test.ts",
			},
		];

		const decisions = mapPawNativeVerificationRunResults(results, TEST_CONFIG);

		expect(decisions).toHaveLength(1);
		expect(decisions[0]).toMatchObject({
			status: "unverified",
			gate: "unit_tests",
			verified: false,
			applicable: true,
			gateSet: "v1",
			reason: "Native verification command failed with exit code 1: FAIL src/foo.test.ts",
		});
	});

	test("maps unsupported gate result to unverified gate decision with unconfigured gateSet", () => {
		const results: PawNativeVerificationRunResult[] = [
			{
				status: "unverified",
				gate: "custom_gate",
				verified: false,
				executed: false,
				reason: "No native command mapping is defined for verification gate custom_gate.",
			},
		];

		const decisions = mapPawNativeVerificationRunResults(results, TEST_CONFIG);

		expect(decisions).toHaveLength(1);
		expect(decisions[0]).toMatchObject({
			status: "unverified",
			gate: "custom_gate",
			verified: false,
			applicable: false,
			gateSet: "unconfigured",
			reason: "No native command mapping is defined for verification gate custom_gate.",
		});
	});

	test("maps timeout result to unverified gate decision", () => {
		const results: PawNativeVerificationRunResult[] = [
			{
				status: "unverified",
				gate: "build",
				verified: false,
				executed: true,
				command: ["npm", "run", "build"],
				exitCode: 124,
				stdout: "",
				stderr: "",
				reason: "Native verification command timed out after 120 seconds.",
			},
		];

		const decisions = mapPawNativeVerificationRunResults(results, TEST_CONFIG);

		expect(decisions).toHaveLength(1);
		expect(decisions[0]).toMatchObject({
			status: "unverified",
			gate: "build",
			verified: false,
			applicable: true,
			gateSet: "v1",
			reason: "Native verification command timed out after 120 seconds.",
		});
	});

	test("maps mixed results preserving order and gateSet classification", () => {
		const results: PawNativeVerificationRunResult[] = [
			{
				status: "verified",
				gate: "working_tree_baseline",
				verified: true,
				executed: true,
				command: ["git", "status", "--short"],
				exitCode: 0,
				stdout: "",
				stderr: "",
			},
			{
				status: "unverified",
				gate: "unit_tests",
				verified: false,
				executed: true,
				command: ["./test.sh"],
				exitCode: 1,
				stdout: "failure",
				stderr: "",
				reason: "Native verification command failed with exit code 1: failure",
			},
			{
				status: "verified",
				gate: "tsc",
				verified: true,
				executed: true,
				command: ["npm", "run", "check"],
				exitCode: 0,
				stdout: "",
				stderr: "",
			},
		];

		const decisions = mapPawNativeVerificationRunResults(results, TEST_CONFIG);

		expect(decisions).toHaveLength(3);
		expect(decisions[0]).toMatchObject({ status: "verified", gate: "working_tree_baseline", gateSet: "v1" });
		expect(decisions[1]).toMatchObject({ status: "unverified", gate: "unit_tests", gateSet: "v1" });
		expect(decisions[2]).toMatchObject({ status: "verified", gate: "tsc", gateSet: "v2" });
	});

	test("returns empty array for empty results", () => {
		const decisions = mapPawNativeVerificationRunResults([], TEST_CONFIG);
		expect(decisions).toEqual([]);
	});

	test("maps v2_optin gates correctly", () => {
		const results: PawNativeVerificationRunResult[] = [
			{
				status: "verified",
				gate: "eslint_ruff",
				verified: true,
				executed: true,
				command: ["npm", "run", "check"],
				exitCode: 0,
				stdout: "",
				stderr: "",
			},
		];

		const decisions = mapPawNativeVerificationRunResults(results, TEST_CONFIG);

		expect(decisions[0]).toMatchObject({
			status: "verified",
			gate: "eslint_ruff",
			applicable: true,
			gateSet: "v2",
		});
	});
});
