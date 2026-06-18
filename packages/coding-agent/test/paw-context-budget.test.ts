import { describe, expect, test } from "vitest";
import {
	evaluatePawFileContext,
	evaluatePawHandoffContext,
	evaluatePawToolOutputContext,
	getPawContextAssemblyOrder,
	getPawSubAgentHandoffCap,
	getPawTaskContextCap,
	loadDefaultPawRuntimeConfig,
} from "../src/paw/index.ts";

describe("Paw context budget policy", () => {
	test("uses loaded default context limits", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(config.context.class_cap_tokens.standard).toBe(48_000);
		expect(config.context.class_cap_tokens.high_risk).toBe(96_000);
		expect(config.context.subagent_handoff_max_tokens.scout).toBe(4_000);
		expect(config.context.file_read_max_bytes).toBe(262_144);
		expect(config.context.tool_output_max_tokens).toBe(1_500);
	});

	test.each([
		["trivial", 16_000],
		["standard", 48_000],
		["high_risk", 96_000],
	] as const)("looks up the %s task context cap", (taskClass, expectedCap) => {
		const config = loadDefaultPawRuntimeConfig();

		expect(getPawTaskContextCap(config.context, taskClass)).toBe(expectedCap);
	});

	test.each([
		["scout", 4_000],
		["planner", 3_000],
		["worker", 2_000],
		["reviewer", 2_500],
	] as const)("looks up the %s handoff cap", (role, expectedCap) => {
		const config = loadDefaultPawRuntimeConfig();

		expect(getPawSubAgentHandoffCap(config.context, role)).toBe(expectedCap);
	});

	test("allows file content inline below the configured byte limit", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(
			evaluatePawFileContext({
				byteLength: config.context.file_read_max_bytes - 1,
				binary: false,
				config: config.context,
			}),
		).toMatchObject({ status: "inline" });
	});

	test("uses metadata only for files above the configured byte limit", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(
			evaluatePawFileContext({
				byteLength: config.context.file_read_max_bytes + 1,
				binary: false,
				config: config.context,
			}),
		).toMatchObject({
			status: "metadata_only",
			reason: "file_too_large",
		});
	});

	test("uses metadata only for binary files even below the configured byte limit", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(
			evaluatePawFileContext({
				byteLength: 128,
				binary: true,
				config: config.context,
			}),
		).toMatchObject({
			status: "metadata_only",
			reason: "binary_file",
		});
	});

	test("allows tool output inline at or below the configured token cap", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(
			evaluatePawToolOutputContext({
				tokenCount: config.context.tool_output_max_tokens,
				config: config.context,
			}),
		).toMatchObject({ status: "inline" });
	});

	test("requires summarization for tool output above the configured token cap", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(
			evaluatePawToolOutputContext({
				tokenCount: config.context.tool_output_max_tokens + 1,
				config: config.context,
			}),
		).toMatchObject({
			status: "summarize",
			reason: "tool_output_too_large",
		});
	});

	test("escalates required handoff content above the role cap with drilldown guidance", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(
			evaluatePawHandoffContext({
				role: "planner",
				tokenCount: config.context.subagent_handoff_max_tokens.planner + 1,
				required: true,
				config: config.context,
			}),
		).toMatchObject({
			status: "escalate",
			drilldown: config.context.drilldown,
			message: expect.stringContaining("required"),
			suggestedAction: expect.stringContaining(config.context.drilldown),
		});
	});

	test("allows optional truncation for optional handoff content above the role cap", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(
			evaluatePawHandoffContext({
				role: "worker",
				tokenCount: config.context.subagent_handoff_max_tokens.worker + 1,
				required: false,
				config: config.context,
			}),
		).toMatchObject({
			status: "optional_truncate",
			reason: "handoff_too_large",
		});
	});

	test("returns the configured context assembly order", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(getPawContextAssemblyOrder(config.context, config.prompt_cache)).toEqual(config.context.assembly_order);
		expect(getPawContextAssemblyOrder(config.context, config.prompt_cache).slice(0, 3)).toEqual([
			"L0_system",
			"L5_rules",
			"L6_memories",
		]);
	});
});
