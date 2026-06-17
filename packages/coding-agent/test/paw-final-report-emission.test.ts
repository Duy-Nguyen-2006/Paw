import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
	emitPawFinalReport,
	type PawNativeVerificationRunResult,
	type PawSessionLock,
	type PawSessionState,
	type PawVerifyGateDecision,
	readPawSessionState,
	resolvePawSessionPaths,
	writePawJsonAtomic,
	writePawSessionState,
} from "../src/paw/index.ts";

const tempRoots: string[] = [];

const verifiedUnitGate: PawVerifyGateDecision = {
	status: "verified",
	gate: "unit_tests",
	verified: true,
	applicable: true,
	gateSet: "v1",
};

const unverifiedLintGate: PawVerifyGateDecision = {
	status: "unverified",
	gate: "lint",
	verified: false,
	applicable: true,
	gateSet: "v1",
	reason: "lint command unavailable",
};

async function createTempRepo(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-final-report-emission-"));
	tempRoots.push(root);
	return root;
}

function createSliceDoneState(sessionId: string): PawSessionState {
	return {
		session_id: sessionId,
		name: "SLICE_DONE",
		current_slice_id: null,
		pending_slice_ids: [],
		completed_slice_ids: ["slice-1", "slice-2"],
		blocked_reason: null,
	};
}

async function writeLock(repoRoot: string, sessionId: string, lock: PawSessionLock): Promise<void> {
	await writePawJsonAtomic(resolvePawSessionPaths(repoRoot, sessionId).lockFile, lock);
}

async function writeCurrentLock(repoRoot: string, sessionId: string, nowMs: number): Promise<PawSessionLock> {
	const lock: PawSessionLock = {
		pid: process.pid,
		host: hostname(),
		heartbeat_ts: nowMs,
		ttl: 120,
	};
	await writeLock(repoRoot, sessionId, lock);
	return lock;
}

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("emitPawFinalReport", () => {
	test("writes final report markdown and advances SLICE_DONE to FINAL_REPORT under the current lock", async () => {
		const repoRoot = await createTempRepo();
		const state = createSliceDoneState("session-1");
		await writePawSessionState(repoRoot, state);
		const lock = await writeCurrentLock(repoRoot, "session-1", 1_000);

		const result = await emitPawFinalReport({
			repoRoot,
			sessionId: "session-1",
			reportInput: {
				summary: "Implemented all planned slices.",
				evidence: ["focused tests passed"],
				verifyDecisions: [verifiedUnitGate],
			},
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result.status).toBe("completed");
		if (result.status !== "completed") return;
		expect(result.lock).toEqual(lock);
		expect(result.previousState).toEqual(state);
		expect(result.nextState).toEqual({
			...state,
			name: "FINAL_REPORT",
		});
		expect(result.report.status).toBe("done");
		expect(result.markdown).toContain("Session: session-1");
		expect(result.markdown).toContain("- done");
		expect(result.markdown).toContain("- focused tests passed");
		await expect(readFile(result.summaryFile, "utf-8")).resolves.toBe(result.markdown);
		await expect(readPawSessionState(repoRoot, "session-1")).resolves.toEqual(result.nextState);
	});

	test("writes done_with_unverified markdown when applicable gates are unverified", async () => {
		const repoRoot = await createTempRepo();
		const state = createSliceDoneState("session-1");
		await writePawSessionState(repoRoot, state);
		await writeCurrentLock(repoRoot, "session-1", 1_000);

		const result = await emitPawFinalReport({
			repoRoot,
			sessionId: "session-1",
			reportInput: {
				summary: "Implemented all planned slices.",
				evidence: ["focused tests passed"],
				verifyDecisions: [verifiedUnitGate, unverifiedLintGate],
			},
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result.status).toBe("completed");
		if (result.status !== "completed") return;
		expect(result.report.status).toBe("done_with_unverified");
		expect(result.markdown).toContain("- done_with_unverified");
		expect(result.markdown).toContain("- lint: lint command unavailable");
		await expect(readFile(result.summaryFile, "utf-8")).resolves.toBe(result.markdown);
	});

	test("returns pending_slices without writing state or summary", async () => {
		const repoRoot = await createTempRepo();
		const state: PawSessionState = {
			...createSliceDoneState("session-1"),
			pending_slice_ids: ["slice-3"],
		};
		await writePawSessionState(repoRoot, state);
		await writeCurrentLock(repoRoot, "session-1", 1_000);
		const summaryFile = resolvePawSessionPaths(repoRoot, "session-1").summaryFile;

		const result = await emitPawFinalReport({
			repoRoot,
			sessionId: "session-1",
			reportInput: {
				summary: "Implemented all planned slices.",
				evidence: ["focused tests passed"],
				verifyDecisions: [verifiedUnitGate],
			},
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result).toEqual({
			status: "pending_slices",
			previousState: state,
			issues: [
				{
					path: "/pending_slice_ids",
					message: "Final report emission requires no pending slices.",
				},
			],
		});
		expect(existsSync(summaryFile)).toBe(false);
		await expect(readPawSessionState(repoRoot, "session-1")).resolves.toEqual(state);
	});

	test("returns invalid_report_input without writing state or summary", async () => {
		const repoRoot = await createTempRepo();
		const state = createSliceDoneState("session-1");
		await writePawSessionState(repoRoot, state);
		await writeCurrentLock(repoRoot, "session-1", 1_000);
		const summaryFile = resolvePawSessionPaths(repoRoot, "session-1").summaryFile;

		const result = await emitPawFinalReport({
			repoRoot,
			sessionId: "session-1",
			reportInput: {
				summary: "   ",
				evidence: ["focused tests passed"],
				verifyDecisions: [verifiedUnitGate],
			},
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result.status).toBe("invalid_report_input");
		if (result.status !== "invalid_report_input") return;
		expect(result.previousState).toEqual(state);
		expect(result.issues).toEqual([
			{
				path: "/report_input",
				message: "summary must be a non-empty string",
			},
		]);
		expect(existsSync(summaryFile)).toBe(false);
		await expect(readPawSessionState(repoRoot, "session-1")).resolves.toEqual(state);
	});

	test("returns not_locked for missing and stale locks without writing state or summary", async () => {
		const repoRoot = await createTempRepo();
		const missingState = createSliceDoneState("missing-lock");
		const staleState = createSliceDoneState("stale-lock");
		await writePawSessionState(repoRoot, missingState);
		await writePawSessionState(repoRoot, staleState);
		const staleLock: PawSessionLock = {
			pid: process.pid,
			host: hostname(),
			heartbeat_ts: 1_000,
			ttl: 1,
		};
		await writeLock(repoRoot, "stale-lock", staleLock);

		const missing = await emitPawFinalReport({
			repoRoot,
			sessionId: "missing-lock",
			reportInput: {
				summary: "Implemented all planned slices.",
				evidence: ["focused tests passed"],
				verifyDecisions: [verifiedUnitGate],
			},
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});
		const stale = await emitPawFinalReport({
			repoRoot,
			sessionId: "stale-lock",
			reportInput: {
				summary: "Implemented all planned slices.",
				evidence: ["focused tests passed"],
				verifyDecisions: [verifiedUnitGate],
			},
			lockOptions: { nowMs: 2_001, ttlSec: 120 },
		});

		expect(missing).toEqual({ status: "not_locked", reason: "unlocked" });
		expect(stale).toEqual({
			status: "not_locked",
			reason: "stale",
			staleReason: "expired_heartbeat",
			lock: staleLock,
		});
		await expect(readPawSessionState(repoRoot, "missing-lock")).resolves.toEqual(missingState);
		await expect(readPawSessionState(repoRoot, "stale-lock")).resolves.toEqual(staleState);
	});

	test("returns locked_by_other or invalid_state without writing state or summary", async () => {
		const repoRoot = await createTempRepo();
		const foreignState = createSliceDoneState("foreign-lock");
		const wrongState: PawSessionState = {
			...createSliceDoneState("wrong-state"),
			name: "VERIFYING",
		};
		const otherOwnerLock: PawSessionLock = {
			pid: process.pid,
			host: "other-host",
			heartbeat_ts: 1_000,
			ttl: 120,
		};
		await writePawSessionState(repoRoot, foreignState);
		await writePawSessionState(repoRoot, wrongState);
		await writeLock(repoRoot, "foreign-lock", otherOwnerLock);
		await writeCurrentLock(repoRoot, "wrong-state", 1_000);

		const foreign = await emitPawFinalReport({
			repoRoot,
			sessionId: "foreign-lock",
			reportInput: {
				summary: "Implemented all planned slices.",
				evidence: ["focused tests passed"],
				verifyDecisions: [verifiedUnitGate],
			},
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});
		const wrong = await emitPawFinalReport({
			repoRoot,
			sessionId: "wrong-state",
			reportInput: {
				summary: "Implemented all planned slices.",
				evidence: ["focused tests passed"],
				verifyDecisions: [verifiedUnitGate],
			},
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(foreign).toEqual({
			status: "locked_by_other",
			lock: otherOwnerLock,
			expectedOwner: {
				pid: process.pid,
				host: hostname(),
			},
		});
		expect(wrong.status).toBe("invalid_state");
		if (wrong.status !== "invalid_state") return;
		expect(wrong.previousState).toEqual(wrongState);
		expect(wrong.issues).toEqual([
			{
				path: "/name",
				message: "Final report emission requires SLICE_DONE state.",
			},
		]);
		await expect(readPawSessionState(repoRoot, "foreign-lock")).resolves.toEqual(foreignState);
		await expect(readPawSessionState(repoRoot, "wrong-state")).resolves.toEqual(wrongState);
	});
});

describe("emitPawFinalReport native verification run results", () => {
	test("preserves run results on emitted report and concise Verification Evidence markdown", async () => {
		const repoRoot = await createTempRepo();
		const state = createSliceDoneState("session-native");
		await writePawSessionState(repoRoot, state);
		await writeCurrentLock(repoRoot, "session-native", 1_000);

		const nativeVerificationRunResults: PawNativeVerificationRunResult[] = [
			{
				status: "verified",
				gate: "unit_tests",
				verified: true,
				executed: true,
				command: ["./test.sh"],
				exitCode: 0,
				stdout: "all tests passed with sensitive data",
				stderr: "",
			},
			{
				status: "unverified",
				gate: "build",
				verified: false,
				executed: true,
				command: ["npm", "run", "build"],
				exitCode: 1,
				stdout: "ERROR in src/foo.ts(10,5): error TS2322",
				stderr: "Build failed",
				reason: "Native verification command failed with exit code 1.",
			},
		];

		const result = await emitPawFinalReport({
			repoRoot,
			sessionId: "session-native",
			reportInput: {
				summary: "Implemented all planned slices.",
				evidence: ["focused tests passed"],
				verifyDecisions: [verifiedUnitGate],
				nativeVerificationRunResults,
			},
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result.status).toBe("completed");
		if (result.status !== "completed") return;
		expect(result.report.native_verification_run_results).toEqual(nativeVerificationRunResults);
		expect(result.markdown).toContain("## Verification Evidence");
		expect(result.markdown).toContain("- unit_tests: verified");
		expect(result.markdown).toContain("- build: unverified");
		expect(result.markdown).not.toContain("all tests passed with sensitive data");
		expect(result.markdown).not.toContain("ERROR in src/foo.ts");
		expect(result.markdown).not.toContain("Build failed");
		expect(result.markdown).not.toContain("exitCode");
		await expect(readFile(result.summaryFile, "utf-8")).resolves.toBe(result.markdown);
	});

	test("emission without native verification run results shows no executed gates message", async () => {
		const repoRoot = await createTempRepo();
		const state = createSliceDoneState("session-no-native");
		await writePawSessionState(repoRoot, state);
		await writeCurrentLock(repoRoot, "session-no-native", 1_000);

		const result = await emitPawFinalReport({
			repoRoot,
			sessionId: "session-no-native",
			reportInput: {
				summary: "Implemented all planned slices.",
				evidence: ["focused tests passed"],
				verifyDecisions: [verifiedUnitGate],
			},
			lockOptions: { nowMs: 2_000, ttlSec: 120 },
		});

		expect(result.status).toBe("completed");
		if (result.status !== "completed") return;
		expect(result.report.native_verification_run_results).toEqual([]);
		expect(result.markdown).toContain("## Verification Evidence");
		expect(result.markdown).toContain("- No native verification gates executed");
	});
});
