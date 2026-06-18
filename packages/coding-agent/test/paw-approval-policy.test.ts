import { describe, expect, test } from "vitest";
import {
	evaluatePawProductApproval,
	evaluatePawToolApproval,
	isPawRiskAtLeast,
	loadDefaultPawRuntimeConfig,
	type PawRiskLevel,
} from "../src/paw/index.ts";

describe("Paw runtime tool approval policy", () => {
	test.each(["R0", "R1", "R2"] as const)("auto allows %s by default", (riskLevel) => {
		expect(evaluatePawToolApproval({ riskLevel, runMode: "interactive" })).toEqual({ status: "allow" });
	});

	test("read-only mode blocks writes", () => {
		expect(evaluatePawToolApproval({ riskLevel: "R1", runMode: "interactive", readOnly: true })).toMatchObject({
			status: "blocked",
			code: "TOOL_PERMISSION",
		});
	});

	test("interactive R3 requires approval", () => {
		expect(evaluatePawToolApproval({ riskLevel: "R3", runMode: "interactive" })).toMatchObject({
			status: "needs_approval",
		});
	});

	test.each(["json", "ci"] as const)("%s blocks R3 without explicit allow", (runMode) => {
		expect(evaluatePawToolApproval({ riskLevel: "R3", runMode })).toMatchObject({
			status: "blocked",
			code: "TOOL_PERMISSION",
		});
	});

	test("json allows R3 with exact explicit allow", () => {
		expect(evaluatePawToolApproval({ riskLevel: "R3", runMode: "json", allowedRiskLevels: ["R3"] })).toEqual({
			status: "allow",
		});
	});

	test("uses the loaded Paw approval matrix", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(evaluatePawToolApproval({ config: config.approval, riskLevel: "R2", runMode: "ci" })).toEqual({
			status: "allow",
		});
		expect(evaluatePawToolApproval({ config: config.approval, riskLevel: "R4", runMode: "ci" })).toMatchObject({
			status: "blocked",
			code: "TOOL_PERMISSION",
		});
	});

	test("json blocks R7 even with explicit allow", () => {
		expect(evaluatePawToolApproval({ riskLevel: "R7", runMode: "json", allowedRiskLevels: ["R7"] })).toMatchObject({
			status: "blocked",
			code: "TOOL_PERMISSION",
		});
	});

	test("interactive R7 requires human approval", () => {
		expect(evaluatePawToolApproval({ riskLevel: "R7", runMode: "interactive" })).toMatchObject({
			status: "needs_approval",
		});
	});
});

describe("Paw product approval policy", () => {
	test("interactive product approval requires user approval", () => {
		expect(evaluatePawProductApproval({ runMode: "interactive" })).toMatchObject({
			status: "needs_approval",
		});
	});

	test("non-interactive product approval fails closed", () => {
		expect(evaluatePawProductApproval({ runMode: "json" })).toMatchObject({
			status: "blocked",
			code: "NEEDS_USER_DECISION",
		});
	});
});

describe("Paw risk ordering", () => {
	test("orders risk levels by SPEC severity", () => {
		const riskLevel: PawRiskLevel = "R3";

		expect(isPawRiskAtLeast(riskLevel, "R2")).toBe(true);
		expect(isPawRiskAtLeast(riskLevel, "R4")).toBe(false);
	});
});
