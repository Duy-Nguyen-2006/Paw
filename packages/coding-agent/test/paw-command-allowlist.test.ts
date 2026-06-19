import { describe, expect, test } from "vitest";
import { DEFAULT_PAW_COMMAND_ALLOWLIST, evaluatePawCommandAllowlist } from "../src/paw/index.ts";

describe("PawCommandAllowlist", () => {
	test("allows git status", () => {
		const decision = evaluatePawCommandAllowlist({
			command: "git",
			args: ["status"],
			config: DEFAULT_PAW_COMMAND_ALLOWLIST,
		});
		expect(decision.allowed).toBe(true);
	});

	test("blocks rm", () => {
		const decision = evaluatePawCommandAllowlist({
			command: "rm",
			args: ["-rf", "/"],
			config: DEFAULT_PAW_COMMAND_ALLOWLIST,
		});
		expect(decision.allowed).toBe(false);
	});

	test("blocks unknown commands when blockedByDefault", () => {
		const decision = evaluatePawCommandAllowlist({
			command: "exotic-tool",
			args: [],
			config: DEFAULT_PAW_COMMAND_ALLOWLIST,
		});
		expect(decision.allowed).toBe(false);
	});

	test("blocks docker (R5)", () => {
		const decision = evaluatePawCommandAllowlist({
			command: "docker",
			args: ["run", "alpine"],
			config: DEFAULT_PAW_COMMAND_ALLOWLIST,
		});
		expect(decision.allowed).toBe(false);
	});

	test("allows npm test (R2)", () => {
		const decision = evaluatePawCommandAllowlist({
			command: "npm",
			args: ["test"],
			config: DEFAULT_PAW_COMMAND_ALLOWLIST,
		});
		expect(decision.allowed).toBe(true);
	});

	test("allows python3 as python3? pattern", () => {
		const decision = evaluatePawCommandAllowlist({
			command: "python3",
			args: ["-m", "pytest"],
			config: DEFAULT_PAW_COMMAND_ALLOWLIST,
		});
		expect(decision.allowed).toBe(true);
	});
});
