
import { describe, expect, test } from "vitest";
import {
	createPawNativeVerificationCommandPolicy,
	createPawPolicyCheckedNativeVerificationExecutor,
} from "../src/paw/verification-command-policy.ts";
import type { PawNativeVerificationPlanEntry } from "../src/paw/verification-plan.ts";
import { createPawNativeVerificationPlan } from "../src/paw/verification-plan.ts";
import type {
	PawNativeVerificationExecutor,
	PawNativeVerificationExecutorInput,
} from "../src/paw/verification-runner.ts";

describe("createPawNativeVerificationCommandPolicy", () => {
	test("allows exact gate+command pair from a planned entry", () => {
		const plan = createPawNativeVerificationPlan(["working_tree_baseline"]);
		const policy = createPawNativeVerificationCommandPolicy(plan);

		expect(policy.isAllowed("working_tree_baseline", ["git", "status", "--short"])).toBe(true);
	});

	test("blocks when command argv differs from the planned entry", () => {
		const plan = createPawNativeVerificationPlan(["working_tree_baseline"]);
		const policy = createPawNativeVerificationCommandPolicy(plan);

		expect(policy.isAllowed("working_tree_baseline", ["git", "status"])).toBe(false);
		expect(policy.isAllowed("working_tree_baseline", ["git", "status", "--long"])).toBe(false);
	});

	test("blocks when gate is not in the plan", () => {
		const plan = createPawNativeVerificationPlan(["working_tree_baseline"]);
		const policy = createPawNativeVerificationCommandPolicy(plan);

		expect(policy.isAllowed("unit_tests", ["./test.sh"])).toBe(false);
	});

	test("blocks unsupported gate even if command matches a known mapping elsewhere", () => {
		const plan = createPawNativeVerificationPlan(["custom_gate"]);
		const policy = createPawNativeVerificationCommandPolicy(plan);

		// custom_gate is unsupported in plan (no command), so even matching command is blocked
		expect(policy.isAllowed("custom_gate", ["git", "status", "--short"])).toBe(false);
	});

	test("allows multiple planned gates with distinct commands", () => {
		const plan = createPawNativeVerificationPlan(["working_tree_baseline", "unit_tests", "tsc"]);
		const policy = createPawNativeVerificationCommandPolicy(plan);

		expect(policy.isAllowed("working_tree_baseline", ["git", "status", "--short"])).toBe(true);
		expect(policy.isAllowed("unit_tests", ["./test.sh"])).toBe(true);
		expect(policy.isAllowed("tsc", ["npm", "run", "check"])).toBe(true);
	});

	test("blocks argv that only matches when joined with spaces", () => {
		const plan: PawNativeVerificationPlanEntry[] = [
			{
				status: "planned",
				gate: "join_collision_gate",
				command: ["tool", "a b"],
				executed: false,
				reason: "planned for join-collision policy test",
			},
		];
		const policy = createPawNativeVerificationCommandPolicy(plan);

		expect(policy.isAllowed("join_collision_gate", ["tool", "a b"])).toBe(true);
		expect(policy.isAllowed("join_collision_gate", ["tool", "a", "b"])).toBe(false);
	});

	test("blocks empty command against a planned gate", () => {
		const plan = createPawNativeVerificationPlan(["working_tree_baseline"]);
		const policy = createPawNativeVerificationCommandPolicy(plan);

		expect(policy.isAllowed("working_tree_baseline", [])).toBe(false);
	});

	test("blocks command in different order even with same tokens", () => {
		const plan = createPawNativeVerificationPlan(["dep_diff"]);
		const policy = createPawNativeVerificationCommandPolicy(plan);

		// dep_diff is ["git", "diff", "--", "package.json", "package-lock.json", ...]
		// reversed args should not match
		const reversed = [
			"git",
			"diff",
			"--",
			"packages/coding-agent/npm-shrinkwrap.json",
			"package-lock.json",
			"package.json",
		];
		expect(policy.isAllowed("dep_diff", reversed)).toBe(false);
	});
});

describe("createPawPolicyCheckedNativeVerificationExecutor", () => {
	function createTrackingExecutor(): {
		executor: PawNativeVerificationExecutor;
		callCount: number;
		calls: PawNativeVerificationExecutorInput[];
	} {
		let callCount = 0;
		const calls: PawNativeVerificationExecutorInput[] = [];
		const executor: PawNativeVerificationExecutor = async (input) => {
			callCount++;
			calls.push(input);
			return { exitCode: 0, stdout: "ok", stderr: "" };
		};
		return {
			executor,
			get callCount() {
				return callCount;
			},
			calls,
		};
	}

	test("delegates to wrapped executor when command is allowed", async () => {
		const plan = createPawNativeVerificationPlan(["working_tree_baseline"]);
		const policy = createPawNativeVerificationCommandPolicy(plan);
		const tracked = createTrackingExecutor();
		const checked = createPawPolicyCheckedNativeVerificationExecutor(tracked.executor, policy);

		const result = await checked({
			gate: "working_tree_baseline",
			command: ["git", "status", "--short"],
			timeoutSec: 60,
		});

		expect(tracked.callCount).toBe(1);
		expect(tracked.calls[0]).toMatchObject({
			gate: "working_tree_baseline",
			command: ["git", "status", "--short"],
		});
		expect(result).toMatchObject({ exitCode: 0, stdout: "ok", stderr: "" });
	});

	test("blocks disallowed command and does not call wrapped executor", async () => {
		const plan = createPawNativeVerificationPlan(["working_tree_baseline"]);
		const policy = createPawNativeVerificationCommandPolicy(plan);
		const tracked = createTrackingExecutor();
		const checked = createPawPolicyCheckedNativeVerificationExecutor(tracked.executor, policy);

		const result = await checked({
			gate: "working_tree_baseline",
			command: ["git", "status", "--long"],
			timeoutSec: 60,
		});

		expect(tracked.callCount).toBe(0);
		expect(result.exitCode).toBe(126);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("not allowed");
		expect(result.stderr).toContain("working_tree_baseline");
		expect(result.stderr).toContain("git status --long");
	});

	test("blocks wrong gate and does not call wrapped executor", async () => {
		const plan = createPawNativeVerificationPlan(["unit_tests"]);
		const policy = createPawNativeVerificationCommandPolicy(plan);
		const tracked = createTrackingExecutor();
		const checked = createPawPolicyCheckedNativeVerificationExecutor(tracked.executor, policy);

		const result = await checked({
			gate: "unknown_gate",
			command: ["./test.sh"],
			timeoutSec: 60,
		});

		expect(tracked.callCount).toBe(0);
		expect(result.exitCode).toBe(126);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("not allowed");
		expect(result.stderr).toContain("unknown_gate");
	});

	test("blocks unsupported plan gate and does not call wrapped executor", async () => {
		const plan = createPawNativeVerificationPlan(["custom_gate"]);
		const policy = createPawNativeVerificationCommandPolicy(plan);
		const tracked = createTrackingExecutor();
		const checked = createPawPolicyCheckedNativeVerificationExecutor(tracked.executor, policy);

		const result = await checked({
			gate: "custom_gate",
			command: ["echo", "hello"],
			timeoutSec: 60,
		});

		expect(tracked.callCount).toBe(0);
		expect(result.exitCode).toBe(126);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("not allowed");
		expect(result.stderr).toContain("custom_gate");
	});

	test("multiple calls: allowed one passes through, blocked one does not call executor", async () => {
		const plan = createPawNativeVerificationPlan(["working_tree_baseline", "unit_tests"]);
		const policy = createPawNativeVerificationCommandPolicy(plan);
		const tracked = createTrackingExecutor();
		const checked = createPawPolicyCheckedNativeVerificationExecutor(tracked.executor, policy);

		const result1 = await checked({
			gate: "working_tree_baseline",
			command: ["git", "status", "--short"],
			timeoutSec: 60,
		});
		const result2 = await checked({
			gate: "working_tree_baseline",
			command: ["rm", "-rf", "/"],
			timeoutSec: 60,
		});
		const result3 = await checked({
			gate: "unit_tests",
			command: ["./test.sh"],
			timeoutSec: 60,
		});

		// Only 2 calls reached the real executor (result1 and result3)
		expect(tracked.callCount).toBe(2);
		expect(result1.exitCode).toBe(0);
		expect(result2.exitCode).toBe(126);
		expect(result2.stderr).toContain("not allowed");
		expect(result3.exitCode).toBe(0);
	});

	test("blocked result is compatible with unverified run result mapping", async () => {
		const plan = createPawNativeVerificationPlan(["tsc"]);
		const policy = createPawNativeVerificationCommandPolicy(plan);
		const tracked = createTrackingExecutor();
		const checked = createPawPolicyCheckedNativeVerificationExecutor(tracked.executor, policy);

		const result = await checked({
			gate: "tsc",
			command: ["npm", "run", "build"],
			timeoutSec: 60,
		});

		// Should be shape-compatible with PawNativeVerificationExecutorResult
		expect(typeof result.exitCode).toBe("number");
		expect(typeof result.stdout).toBe("string");
		expect(typeof result.stderr).toBe("string");
		expect(result.timedOut).toBeUndefined();
	});
});
