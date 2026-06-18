
import { describe, expect, test } from "vitest";
import {
	classifyPawTask,
	loadDefaultPawRuntimeConfig,
	maxPawRiskLevel,
	type PawRiskScoringInput,
	scorePawTaskRisk,
} from "../src/paw/index.ts";

type RiskFlag = "newDependency" | "schemaOrDbChange" | "infraOrDeploy" | "destructiveCommand" | "securityPath";

function riskInputWithFlag(flag: RiskFlag): PawRiskScoringInput {
	const input: PawRiskScoringInput = { changedFileCount: 1 };
	input[flag] = true;
	return input;
}

describe("Paw risk scoring", () => {
	test("uses R0 for read-only-ish tasks and R1 for requested writes", () => {
		expect(scorePawTaskRisk({ changedFileCount: 1 }).riskLevel).toBe("R0");
		expect(scorePawTaskRisk({ changedFileCount: 1, writesRequested: true }).riskLevel).toBe("R1");
	});

	test("uses R2 for build or test operations", () => {
		const score = scorePawTaskRisk({ changedFileCount: 1, buildOrTest: true });

		expect(score.riskLevel).toBe("R2");
		expect(score.reasons).toContain("build/test operation requested");
	});

	test.each([
		["newDependency", "R3", "new dependency requested"],
		["schemaOrDbChange", "R4", "schema or database change requested"],
		["infraOrDeploy", "R5", "infra or deploy operation requested"],
		["destructiveCommand", "R6", "destructive command requested"],
		["securityPath", "R7", "security/auth/payment/secrets path requested"],
	] as const)("maps %s to %s", (flag, expectedRiskLevel, expectedReason) => {
		const score = scorePawTaskRisk(riskInputWithFlag(flag));

		expect(score.riskLevel).toBe(expectedRiskLevel);
		expect(score.reasons).toContain(expectedReason);
	});

	test("returns the maximum Paw risk level", () => {
		expect(maxPawRiskLevel(["R1", "R4", "R2"])).toBe("R4");
		expect(maxPawRiskLevel([])).toBe("R0");
	});
});

describe("Paw task classification", () => {
	test("default config classifies a one-file no-write no-risk task as trivial", () => {
		const config = loadDefaultPawRuntimeConfig();
		const result = classifyPawTask({ changedFileCount: 1 }, config.routing.trivial_requires_all);

		expect(result.taskClass).toBe("trivial");
		expect(result.risk.riskLevel).toBe("R0");
	});

	test("loaded default config drives the trivial file threshold", () => {
		const config = loadDefaultPawRuntimeConfig();
		const result = classifyPawTask(
			{ changedFileCount: config.routing.trivial_requires_all.max_files + 1 },
			config.routing.trivial_requires_all,
		);

		expect(config.routing.trivial_requires_all.max_files).toBe(1);
		expect(result.taskClass).toBe("standard");
		expect(result.reasons).toContain("changed file count exceeds trivial max_files=1");
	});

	test("cross-layer work escalates to standard", () => {
		const config = loadDefaultPawRuntimeConfig();
		const result = classifyPawTask({ changedFileCount: 1, crossLayer: true }, config.routing.trivial_requires_all);

		expect(result.taskClass).toBe("standard");
		expect(result.reasons).toContain("cross-layer work violates trivial cross_layer=false");
	});

	test("R2 build/test write work can remain trivial when other requirements pass", () => {
		const config = loadDefaultPawRuntimeConfig();
		const result = classifyPawTask(
			{ changedFileCount: 1, writesRequested: true, buildOrTest: true },
			config.routing.trivial_requires_all,
		);

		expect(result.taskClass).toBe("trivial");
		expect(result.risk.riskLevel).toBe("R2");
		expect(result.reasons).toContain("build/test operation requested");
	});

	test.each([
		["newDependency", "R3", "new dependency requested"],
		["schemaOrDbChange", "R4", "schema or database change requested"],
		["infraOrDeploy", "R5", "infra or deploy operation requested"],
		["destructiveCommand", "R6", "destructive command requested"],
	] as const)("classifies %s as high_risk", (flag, expectedRiskLevel, expectedReason) => {
		const config = loadDefaultPawRuntimeConfig();
		const result = classifyPawTask(riskInputWithFlag(flag), config.routing.trivial_requires_all);

		expect(result.taskClass).toBe("high_risk");
		expect(result.risk.riskLevel).toBe(expectedRiskLevel);
		expect(result.reasons).toContain(expectedReason);
	});

	test("classifies security paths as R7 high_risk and blocks trivial routing", () => {
		const config = loadDefaultPawRuntimeConfig();
		const result = classifyPawTask({ changedFileCount: 1, securityPath: true }, config.routing.trivial_requires_all);

		expect(result.taskClass).toBe("high_risk");
		expect(result.risk.riskLevel).toBe("R7");
		expect(result.reasons).toContain("security/auth/payment/secrets path requested");
		expect(result.reasons).toContain("security path violates trivial security_path=false");
	});
});
