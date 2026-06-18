import { describe, expect, test } from "vitest";
import {
	assertValidPawSessionState,
	createInitialPawSessionState,
	isPawBlockedState,
	type PawSessionState,
	transitionPawSessionState,
} from "../src/paw/index.ts";

describe("Paw session state machine", () => {
	test("creates an idle initial state with no active or completed slices", () => {
		const state = createInitialPawSessionState("session-1");

		expect(state).toEqual({
			session_id: "session-1",
			name: "IDLE",
			current_slice_id: null,
			pending_slice_ids: [],
			completed_slice_ids: [],
			blocked_reason: null,
		});
	});

	test("advances through the v1 flow and completes slices without redoing them", () => {
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
			if (result.ok) state = result.value;
		}

		const approved = transitionPawSessionState(state, {
			to: "PLAN_APPROVED",
			slice_ids: ["slice-1", "slice-2"],
		});
		expect(approved.ok).toBe(true);
		if (approved.ok) state = approved.value;
		expect(state.pending_slice_ids).toEqual(["slice-1", "slice-2"]);

		const selected = transitionPawSessionState(state, { to: "SLICE_SELECT" });
		expect(selected.ok).toBe(true);
		if (selected.ok) state = selected.value;
		expect(state.current_slice_id).toBe("slice-1");
		expect(state.pending_slice_ids).toEqual(["slice-2"]);

		for (const next of ["IMPLEMENTING", "REVIEWING", "VERIFYING", "SLICE_DONE"] as const) {
			const result = transitionPawSessionState(state, { to: next });
			expect(result.ok).toBe(true);
			if (result.ok) state = result.value;
		}

		expect(state.current_slice_id).toBeNull();
		expect(state.completed_slice_ids).toEqual(["slice-1"]);
		expect(state.pending_slice_ids).toEqual(["slice-2"]);

		const nextSlice = transitionPawSessionState(state, { to: "SLICE_SELECT" });
		expect(nextSlice.ok).toBe(true);
		if (nextSlice.ok) {
			state = nextSlice.value;
		}
		expect(state.current_slice_id).toBe("slice-2");
		expect(state.completed_slice_ids).toEqual(["slice-1"]);
		expect(state.pending_slice_ids).toEqual([]);

		for (const next of ["IMPLEMENTING", "REVIEWING", "VERIFYING", "SLICE_DONE", "FINAL_REPORT", "IDLE"] as const) {
			const result = transitionPawSessionState(state, { to: next });
			expect(result.ok).toBe(true);
			if (result.ok) state = result.value;
		}

		expect(state.name).toBe("IDLE");
		expect(state.current_slice_id).toBeNull();
		expect(state.completed_slice_ids).toEqual(["slice-1", "slice-2"]);
	});

	test("rejects invalid transitions with validation-style issues", () => {
		const result = transitionPawSessionState(createInitialPawSessionState("session-1"), { to: "VERIFYING" });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues).toEqual([
				{
					path: "/transition/to",
					message: "Cannot transition from IDLE to VERIFYING.",
				},
			]);
		}
	});

	test("enters blocked states with reason metadata and resumes the offending slice", () => {
		const state: PawSessionState = {
			...createInitialPawSessionState("session-1"),
			name: "VERIFYING",
			current_slice_id: "slice-1",
			pending_slice_ids: ["slice-2"],
		};

		const blocked = transitionPawSessionState(state, {
			to: "BLOCKED_TEST_FAILURE",
			blocked_reason: {
				message: "Unit test failed.",
				suggested_action: "Fix the failing test and resume verification.",
			},
		});

		expect(blocked.ok).toBe(true);
		if (!blocked.ok) return;
		expect(isPawBlockedState(blocked.value.name)).toBe(true);
		expect(blocked.value.blocked_reason).toEqual({
			code: "TEST_FAILURE",
			message: "Unit test failed.",
			suggested_action: "Fix the failing test and resume verification.",
			slice_id: "slice-1",
			resume_state: "VERIFYING",
		});

		const resumed = transitionPawSessionState(blocked.value, { to: "VERIFYING" });
		expect(resumed.ok).toBe(true);
		if (resumed.ok) {
			expect(resumed.value.current_slice_id).toBe("slice-1");
			expect(resumed.value.blocked_reason).toBeNull();
		}
	});

	test("validates blocked state invariants", () => {
		const result = assertValidPawSessionState({
			...createInitialPawSessionState("session-1"),
			name: "BLOCKED_PROVIDER_UNAVAILABLE",
			blocked_reason: null,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues).toContainEqual({
				path: "/blocked_reason",
				message: "Blocked states require blocked_reason metadata.",
			});
		}
	});
});
