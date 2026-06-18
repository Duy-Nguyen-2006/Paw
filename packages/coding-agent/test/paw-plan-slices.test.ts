
import { describe, expect, test } from "vitest";
import { createInitialPawSessionState, createPawPlanSliceQueue, transitionPawSessionState } from "../src/paw/index.ts";

function validationPaths(result: ReturnType<typeof createPawPlanSliceQueue>): string[] {
	if (result.ok) return [];
	return result.issues.map((issue) => issue.path);
}

function createPlanReadyState() {
	let state = createInitialPawSessionState("session-1");

	for (const next of [
		"INTAKE",
		"CLASSIFYING",
		"CLARIFYING",
		"SPEC_DRAFTED",
		"SPEC_APPROVED",
		"SCOUTING",
		"PLAN_DRAFTED",
	] as const) {
		const result = transitionPawSessionState(state, { to: next });
		expect(result.ok).toBe(true);
		if (result.ok) {
			state = result.value;
		}
	}

	return state;
}

describe("createPawPlanSliceQueue", () => {
	test("sorts unordered valid slices and exposes execution slice ids", () => {
		const result = createPawPlanSliceQueue([
			{
				slice_id: "slice-2",
				title: "Second slice",
				order: 1,
				target_files: ["src/second.ts"],
				max_risk_level: "R2",
				acceptance: "Second acceptance",
			},
			{
				slice_id: "slice-1",
				title: "First slice",
				order: 0,
			},
		]);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.slice_ids).toEqual(["slice-1", "slice-2"]);
		expect(result.value.slices).toEqual([
			{
				slice_id: "slice-1",
				title: "First slice",
				order: 0,
			},
			{
				slice_id: "slice-2",
				title: "Second slice",
				order: 1,
				target_files: ["src/second.ts"],
				max_risk_level: "R2",
				acceptance: "Second acceptance",
			},
		]);
	});

	test("feeds the existing state transition queue through plan approval and slice selection", () => {
		const queue = createPawPlanSliceQueue([
			{ slice_id: "slice-2", title: "Second slice", order: 1 },
			{ slice_id: "slice-1", title: "First slice", order: 0 },
		]);
		expect(queue.ok).toBe(true);
		if (!queue.ok) return;

		const approved = transitionPawSessionState(createPlanReadyState(), {
			to: "PLAN_APPROVED",
			slice_ids: queue.value.slice_ids,
		});
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;
		expect(approved.value.pending_slice_ids).toEqual(["slice-1", "slice-2"]);

		const selected = transitionPawSessionState(approved.value, { to: "SLICE_SELECT" });
		expect(selected.ok).toBe(true);
		if (selected.ok) {
			expect(selected.value.current_slice_id).toBe("slice-1");
			expect(selected.value.pending_slice_ids).toEqual(["slice-2"]);
		}
	});

	test("rejects empty input with a path-level issue", () => {
		const result = createPawPlanSliceQueue([]);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues).toContainEqual({
				path: "/",
				message: "Planner slice input must be a non-empty array.",
			});
		}
	});

	test("rejects duplicate slice ids and orders with path-level issues", () => {
		const result = createPawPlanSliceQueue([
			{ slice_id: "slice-1", title: "First slice", order: 0 },
			{ slice_id: "slice-1", title: "Duplicate id", order: 1 },
			{ slice_id: "slice-3", title: "Duplicate order", order: 1 },
		]);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues).toContainEqual({
				path: "/1/slice_id",
				message: "Duplicate slice id slice-1.",
			});
			expect(result.issues).toContainEqual({
				path: "/2/order",
				message: "Duplicate slice order 1.",
			});
		}
	});

	test("rejects invalid fields with path-level issues", () => {
		const result = createPawPlanSliceQueue([
			{
				slice_id: " ",
				title: "",
				order: 1.5,
				target_files: [""],
				max_risk_level: "R8",
				acceptance: " ",
			},
		]);

		expect(result.ok).toBe(false);
		expect(validationPaths(result)).toEqual(
			expect.arrayContaining([
				"/0/slice_id",
				"/0/title",
				"/0/order",
				"/0/target_files/0",
				"/0/max_risk_level",
				"/0/acceptance",
			]),
		);
	});

	test("rejects unexpected slice properties with path-level issues", () => {
		const result = createPawPlanSliceQueue([
			{
				slice_id: "slice-1",
				title: "First slice",
				order: 0,
				extra: true,
			},
		]);

		expect(result.ok).toBe(false);
		expect(validationPaths(result)).toContain("/0/extra");
	});

	test("does not mutate the input array or slice objects", () => {
		const input = [
			{ slice_id: "slice-2", title: "Second slice", order: 1, target_files: ["src/second.ts"] },
			{ slice_id: "slice-1", title: "First slice", order: 0 },
		];
		const original = structuredClone(input);

		const result = createPawPlanSliceQueue(input);

		expect(result.ok).toBe(true);
		expect(input).toEqual(original);
	});
});
