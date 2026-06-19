import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
	createPawApproveRetryResult,
	formatPawApproveRetryResult,
	initializePawProject,
	loadDefaultPawRuntimeConfig,
	parsePawApproveRetryArgs,
	releasePawSessionLock,
	startPawTaskSession,
	transitionPawSessionState,
	writePawSessionState,
} from "../src/paw/index.ts";

let tempDir: string;
let owner: { pid: number; host: string };

beforeEach(async () => {
	tempDir = mkdtempSync(join(tmpdir(), "paw-approve-retry-"));
	const config = loadDefaultPawRuntimeConfig();
	await initializePawProject(tempDir, config);
	owner = { pid: process.pid, host: "test-host" };
});

afterEach(() => {
	rmSync(tempDir, { recursive: true, force: true });
});

async function lockAndSeedSession(
	sessionId: string,
	stateName:
		| "SPEC_DRAFTED"
		| "PLAN_DRAFTED"
		| "SLICE_DONE"
		| "BLOCKED_NEEDS_USER_DECISION"
		| "BLOCKED_PATCH_APPLY_FAILED"
		| "IMPLEMENTING"
		| "INTAKE",
): Promise<void> {
	const start = await startPawTaskSession({
		repoRoot: tempDir,
		sessionId,
		runtimeConfig: loadDefaultPawRuntimeConfig(),
		lockOptions: owner,
	});
	if (start.status === "locked") {
		throw new Error("unexpectedly locked");
	}
	let state = start.state;
	if (stateName === "SPEC_DRAFTED") {
		state = applyTransition(state, { to: "CLASSIFYING" });
		state = applyTransition(state, { to: "CLARIFYING" });
		state = applyTransition(state, { to: "SPEC_DRAFTED" });
	} else if (stateName === "PLAN_DRAFTED") {
		state = applyTransition(state, { to: "CLASSIFYING" });
		state = applyTransition(state, { to: "CLARIFYING" });
		state = applyTransition(state, { to: "SPEC_DRAFTED" });
		state = applyTransition(state, { to: "SPEC_APPROVED" });
		state = applyTransition(state, { to: "SCOUTING" });
		state = applyTransition(state, { to: "PLAN_DRAFTED", slice_ids: ["s1"] });
		state = { ...state, pending_slice_ids: ["s1"] };
	} else if (stateName === "SLICE_DONE") {
		state = applyTransition(state, { to: "CLASSIFYING" });
		state = applyTransition(state, { to: "CLARIFYING" });
		state = applyTransition(state, { to: "SPEC_DRAFTED" });
		state = applyTransition(state, { to: "SPEC_APPROVED" });
		state = applyTransition(state, { to: "SCOUTING" });
		state = applyTransition(state, { to: "PLAN_DRAFTED", slice_ids: ["s1"] });
		state = applyTransition(state, { to: "PLAN_APPROVED", slice_ids: ["s1"] });
		state = applyTransition(state, { to: "SLICE_SELECT", slice_ids: ["s1"] });
		state = applyTransition(state, { to: "IMPLEMENTING" });
		state = applyTransition(state, { to: "REVIEWING" });
		state = applyTransition(state, { to: "VERIFYING" });
		state = applyTransition(state, { to: "SLICE_DONE", slice_ids: ["s1"] });
	} else if (stateName === "BLOCKED_NEEDS_USER_DECISION") {
		state = applyTransition(state, { to: "CLASSIFYING" });
		state = applyTransition(state, { to: "CLARIFYING" });
		state = applyTransition(state, {
			to: "BLOCKED_NEEDS_USER_DECISION",
			blocked_reason: {
				code: "NEEDS_USER_DECISION",
				message: "test",
				suggested_action: "fix",
				slice_id: null,
			},
		});
	} else if (stateName === "BLOCKED_PATCH_APPLY_FAILED") {
		state = applyTransition(state, { to: "CLASSIFYING" });
		state = applyTransition(state, { to: "CLARIFYING" });
		state = applyTransition(state, { to: "SPEC_DRAFTED" });
		state = applyTransition(state, { to: "SPEC_APPROVED" });
		state = applyTransition(state, { to: "SCOUTING" });
		state = applyTransition(state, { to: "PLAN_DRAFTED", slice_ids: ["s1"] });
		state = applyTransition(state, { to: "PLAN_APPROVED", slice_ids: ["s1"] });
		state = applyTransition(state, { to: "SLICE_SELECT", slice_ids: ["s1"] });
		state = applyTransition(state, { to: "IMPLEMENTING" });
		state = applyTransition(state, {
			to: "BLOCKED_PATCH_APPLY_FAILED",
			blocked_reason: {
				code: "PATCH_APPLY_FAILED",
				message: "patch mismatch",
				suggested_action: "fix the patch",
				slice_id: "s1",
			},
		});
	} else if (stateName === "IMPLEMENTING") {
		state = applyTransition(state, { to: "CLASSIFYING" });
		state = applyTransition(state, { to: "CLARIFYING" });
		state = applyTransition(state, { to: "SPEC_DRAFTED" });
		state = applyTransition(state, { to: "SPEC_APPROVED" });
		state = applyTransition(state, { to: "SCOUTING" });
		state = applyTransition(state, { to: "PLAN_DRAFTED", slice_ids: ["s1"] });
		state = applyTransition(state, { to: "PLAN_APPROVED", slice_ids: ["s1"] });
		state = applyTransition(state, { to: "SLICE_SELECT", slice_ids: ["s1"] });
		state = applyTransition(state, { to: "IMPLEMENTING" });
	} else if (stateName === "INTAKE") {
		// no-op; start state is already INTAKE
	}
	await writePawSessionState(tempDir, state);
	await releasePawSessionLock(tempDir, sessionId, owner);
}

function applyTransition(
	state: import("../src/paw/index.ts").PawSessionState,
	transition: import("../src/paw/index.ts").PawStateTransition,
): import("../src/paw/index.ts").PawSessionState {
	if (transition.to === state.name) {
		return state;
	}
	const result = transitionPawSessionState(state, transition);
	if (!result.ok) {
		throw new Error(`Failed to transition from ${state.name} to ${transition.to}: ${JSON.stringify(result.issues)}`);
	}
	return result.value;
}

describe("parsePawApproveRetryArgs", () => {
	test("empty args returns help", () => {
		const result = parsePawApproveRetryArgs([]);
		expect(result.kind).toBe("help");
	});

	test("--help returns help", () => {
		const result = parsePawApproveRetryArgs(["--help"]);
		expect(result.kind).toBe("help");
	});

	test("rejects unknown action", () => {
		const result = parsePawApproveRetryArgs(["bogus", "s1"]);
		expect(result.kind).toBe("error");
	});

	test("parses approve with session id", () => {
		const result = parsePawApproveRetryArgs(["approve", "s1"]);
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.args.action).toBe("approve");
		expect(result.args.sessionId).toBe("s1");
		expect(result.args.reason).toBe(null);
	});

	test("parses reject with --reason", () => {
		const result = parsePawApproveRetryArgs(["reject", "s1", "--reason", "not ready"]);
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.args.action).toBe("reject");
		expect(result.args.sessionId).toBe("s1");
		expect(result.args.reason).toBe("not ready");
	});

	test("parses retry with short reason flag", () => {
		const result = parsePawApproveRetryArgs(["retry", "s1", "-r", "again"]);
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.args.action).toBe("retry");
		expect(result.args.reason).toBe("again");
	});

	test("rejects missing session id", () => {
		const result = parsePawApproveRetryArgs(["approve"]);
		expect(result.kind).toBe("error");
	});

	test("rejects unknown option", () => {
		const result = parsePawApproveRetryArgs(["approve", "s1", "--bogus"]);
		expect(result.kind).toBe("error");
	});

	test("rejects --reason with no value", () => {
		const result = parsePawApproveRetryArgs(["reject", "s1", "--reason"]);
		expect(result.kind).toBe("error");
	});
});

describe("createPawApproveRetryResult - approve", () => {
	test("advances SPEC_DRAFTED to SPEC_APPROVED", async () => {
		await lockAndSeedSession("s1", "SPEC_DRAFTED");
		const result = await createPawApproveRetryResult({
			repoRoot: tempDir,
			sessionId: "s1",
			action: "approve",
			lockOptions: owner,
		});
		expect(result.status).toBe("advanced");
		if (result.status !== "advanced") return;
		expect(result.previousStateName).toBe("SPEC_DRAFTED");
		expect(result.nextStateName).toBe("SPEC_APPROVED");
	});

	test("advances PLAN_DRAFTED to PLAN_APPROVED when pending slices exist", async () => {
		await lockAndSeedSession("s1", "PLAN_DRAFTED");
		const result = await createPawApproveRetryResult({
			repoRoot: tempDir,
			sessionId: "s1",
			action: "approve",
			lockOptions: owner,
		});
		expect(result.status).toBe("advanced");
		if (result.status !== "advanced") return;
		expect(result.nextStateName).toBe("PLAN_APPROVED");
	});

	test("advances SLICE_DONE with no pending slices to FINAL_REPORT", async () => {
		await lockAndSeedSession("s1", "SLICE_DONE");
		const result = await createPawApproveRetryResult({
			repoRoot: tempDir,
			sessionId: "s1",
			action: "approve",
			lockOptions: owner,
		});
		expect(result.status).toBe("advanced");
		if (result.status !== "advanced") return;
		expect(result.nextStateName).toBe("FINAL_REPORT");
	});

	test("resumes from BLOCKED_NEEDS_USER_DECISION", async () => {
		await lockAndSeedSession("s1", "BLOCKED_NEEDS_USER_DECISION");
		const result = await createPawApproveRetryResult({
			repoRoot: tempDir,
			sessionId: "s1",
			action: "approve",
			lockOptions: owner,
		});
		expect(result.status).toBe("advanced");
		if (result.status !== "advanced") return;
		expect(result.previousStateName).toBe("BLOCKED_NEEDS_USER_DECISION");
		expect(result.nextStateName).toBe("CLARIFYING");
	});

	test("returns invalid_state when from non-approvable state", async () => {
		await lockAndSeedSession("s1", "INTAKE");
		const result = await createPawApproveRetryResult({
			repoRoot: tempDir,
			sessionId: "s1",
			action: "approve",
			lockOptions: owner,
		});
		expect(result.status).toBe("invalid_state");
	});

	test("returns missing_session for unknown session", async () => {
		const result = await createPawApproveRetryResult({
			repoRoot: tempDir,
			sessionId: "ghost",
			action: "approve",
			lockOptions: owner,
		});
		expect(result.status).toBe("missing_session");
	});
});

describe("createPawApproveRetryResult - reject", () => {
	test("rejects from INTAKE to BLOCKED_NEEDS_USER_DECISION", async () => {
		await lockAndSeedSession("s1", "INTAKE");
		const result = await createPawApproveRetryResult({
			repoRoot: tempDir,
			sessionId: "s1",
			action: "reject",
			reason: "spec is wrong",
			lockOptions: owner,
		});
		expect(result.status).toBe("rejected");
		if (result.status !== "rejected") return;
		expect(result.previousStateName).toBe("INTAKE");
		expect(result.blockedCode).toBe("NEEDS_USER_DECISION");
		expect(result.reason).toBe("spec is wrong");
	});

	test("refuses to reject from already-blocked state", async () => {
		await lockAndSeedSession("s1", "BLOCKED_NEEDS_USER_DECISION");
		const result = await createPawApproveRetryResult({
			repoRoot: tempDir,
			sessionId: "s1",
			action: "reject",
			reason: "still not ready",
			lockOptions: owner,
		});
		expect(result.status).toBe("invalid_state");
	});

	test("uses default reason when none provided", async () => {
		await lockAndSeedSession("s1", "INTAKE");
		const result = await createPawApproveRetryResult({
			repoRoot: tempDir,
			sessionId: "s1",
			action: "reject",
			lockOptions: owner,
		});
		expect(result.status).toBe("rejected");
		if (result.status !== "rejected") return;
		expect(result.reason.length).toBeGreaterThan(0);
	});
});

describe("createPawApproveRetryResult - retry", () => {
	test("resumes from BLOCKED_PATCH_APPLY_FAILED to resume_state (IMPLEMENTING)", async () => {
		await lockAndSeedSession("s1", "BLOCKED_PATCH_APPLY_FAILED");
		const result = await createPawApproveRetryResult({
			repoRoot: tempDir,
			sessionId: "s1",
			action: "retry",
			lockOptions: owner,
		});
		expect(result.status).toBe("retried");
		if (result.status !== "retried") return;
		expect(result.previousStateName).toBe("BLOCKED_PATCH_APPLY_FAILED");
		expect(result.nextStateName).toBe("IMPLEMENTING");
	});

	test("re-attempts the current slice step when in IMPLEMENTING", async () => {
		await lockAndSeedSession("s1", "IMPLEMENTING");
		const result = await createPawApproveRetryResult({
			repoRoot: tempDir,
			sessionId: "s1",
			action: "retry",
			lockOptions: owner,
		});
		expect(result.status).toBe("retried");
		if (result.status !== "retried") return;
		expect(result.nextStateName).toBe("IMPLEMENTING");
	});

	test("returns no_op from INTAKE", async () => {
		await lockAndSeedSession("s1", "INTAKE");
		const result = await createPawApproveRetryResult({
			repoRoot: tempDir,
			sessionId: "s1",
			action: "retry",
			lockOptions: owner,
		});
		expect(result.status).toBe("no_op");
	});
});

describe("formatPawApproveRetryResult", () => {
	test("formats advanced result with both states", async () => {
		await lockAndSeedSession("s1", "SPEC_DRAFTED");
		const result = await createPawApproveRetryResult({
			repoRoot: tempDir,
			sessionId: "s1",
			action: "approve",
			lockOptions: owner,
		});
		const formatted = formatPawApproveRetryResult(result);
		expect(formatted).toContain("SPEC_DRAFTED");
		expect(formatted).toContain("SPEC_APPROVED");
		expect(formatted).toContain("advanced");
	});
});
