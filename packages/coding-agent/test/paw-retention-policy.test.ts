import { describe, expect, test } from "vitest";
import {
	createPawRetentionPlan,
	loadDefaultPawRuntimeConfig,
	type PawRetentionArtifactRecord,
	type PawRetentionPlanInput,
	type PawRetentionSessionRecord,
} from "../src/paw/index.ts";

function validationPaths(result: ReturnType<typeof createPawRetentionPlan>): string[] {
	if (result.ok) return [];
	return result.issues.map((issue) => issue.path);
}

function session(session_id: string, last_activity_at: string): PawRetentionSessionRecord {
	return {
		session_id,
		path: `.paw/sessions/${session_id}`,
		last_activity_at,
	};
}

function artifact(artifact_name: string, created_at: string): PawRetentionArtifactRecord {
	return {
		artifact_name,
		path: `.paw/artifacts/${artifact_name}`,
		created_at,
	};
}

describe("createPawRetentionPlan", () => {
	test("loaded default runtime config keeps newest 20 sessions and removes the 21st", () => {
		const config = loadDefaultPawRuntimeConfig().persistence.retention;
		const sessions = Array.from({ length: 21 }, (_, index) =>
			session(
				`session-${index.toString().padStart(2, "0")}`,
				`2026-06-${(21 - index).toString().padStart(2, "0")}T00:00:00.000Z`,
			),
		);

		const result = createPawRetentionPlan({
			config,
			sessions,
			artifacts: [],
			now: "2026-06-22T00:00:00.000Z",
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.keep_sessions.map((record) => record.session_id)).toHaveLength(20);
		expect(result.value.keep_sessions[0]?.session_id).toBe("session-00");
		expect(result.value.keep_sessions[19]?.session_id).toBe("session-19");
		expect(result.value.remove_sessions).toEqual([
			{
				kind: "session",
				id: "session-20",
				path: ".paw/sessions/session-20",
				reason: "exceeds keep_last_sessions=20",
			},
		]);
	});

	test("removes artifacts older than configured days and keeps threshold-day artifacts", () => {
		const result = createPawRetentionPlan({
			config: { keep_last_sessions: 20, artifact_days: 7 },
			sessions: [],
			artifacts: [
				artifact("older", "2026-06-08T23:59:59.999Z"),
				artifact("threshold", "2026-06-09T00:00:00.000Z"),
				artifact("newer", "2026-06-15T00:00:00.000Z"),
			],
			now: "2026-06-16T00:00:00.000Z",
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.keep_artifacts.map((record) => record.artifact_name)).toEqual(["newer", "threshold"]);
		expect(result.value.remove_artifacts).toEqual([
			{
				kind: "artifact",
				id: "older",
				path: ".paw/artifacts/older",
				reason: "older than artifact_days=7",
			},
		]);
	});

	test("zero keep sessions removes all sessions", () => {
		const result = createPawRetentionPlan({
			config: { keep_last_sessions: 0, artifact_days: 7 },
			sessions: [session("session-2", "2026-06-16T00:00:00.000Z"), session("session-1", "2026-06-16T00:00:00.000Z")],
			artifacts: [],
			now: "2026-06-16T00:00:00.000Z",
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.keep_sessions).toEqual([]);
		expect(result.value.remove_sessions.map((removal) => removal.id)).toEqual(["session-1", "session-2"]);
	});

	test("zero artifact days removes artifacts before now and keeps artifacts at now", () => {
		const result = createPawRetentionPlan({
			config: { keep_last_sessions: 20, artifact_days: 0 },
			sessions: [],
			artifacts: [
				artifact("future", "2026-06-16T00:00:00.001Z"),
				artifact("at-now", "2026-06-16T00:00:00.000Z"),
				artifact("before-now", "2026-06-15T23:59:59.999Z"),
			],
			now: "2026-06-16T00:00:00.000Z",
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.keep_artifacts.map((record) => record.artifact_name)).toEqual(["future", "at-now"]);
		expect(result.value.remove_artifacts.map((removal) => removal.id)).toEqual(["before-now"]);
	});

	test("invalid config and timestamps return path-level issues", () => {
		const result = createPawRetentionPlan({
			config: { keep_last_sessions: -1, artifact_days: 1.5 },
			sessions: [session("session-1", "not-a-date")],
			artifacts: [artifact("artifact-1", "also-not-a-date")],
			now: "invalid-now",
		});

		expect(result.ok).toBe(false);
		expect(validationPaths(result)).toEqual(
			expect.arrayContaining([
				"/config/keep_last_sessions",
				"/config/artifact_days",
				"/now",
				"/sessions/0/last_activity_at",
				"/artifacts/0/created_at",
			]),
		);
	});

	test("invalid ids and paths return path-level issues", () => {
		const result = createPawRetentionPlan({
			config: { keep_last_sessions: 20, artifact_days: 7 },
			sessions: [{ session_id: " ", path: "", last_activity_at: "2026-06-16T00:00:00.000Z" }],
			artifacts: [{ artifact_name: "", path: " ", created_at: "2026-06-16T00:00:00.000Z" }],
			now: "2026-06-16T00:00:00.000Z",
		});

		expect(result.ok).toBe(false);
		expect(validationPaths(result)).toEqual(
			expect.arrayContaining([
				"/sessions/0/session_id",
				"/sessions/0/path",
				"/artifacts/0/artifact_name",
				"/artifacts/0/path",
			]),
		);
	});

	test("does not mutate input arrays or records", () => {
		const sessions = [
			session("session-older", "2026-06-15T00:00:00.000Z"),
			session("session-newer", "2026-06-16T00:00:00.000Z"),
		];
		const artifacts = [
			artifact("artifact-older", "2026-06-01T00:00:00.000Z"),
			artifact("artifact-newer", "2026-06-16T00:00:00.000Z"),
		];
		const input: PawRetentionPlanInput = {
			config: { keep_last_sessions: 1, artifact_days: 7 },
			sessions,
			artifacts,
			now: "2026-06-16T00:00:00.000Z",
		};
		const originalSessions = structuredClone(sessions);
		const originalArtifacts = structuredClone(artifacts);

		const result = createPawRetentionPlan(input);

		expect(result.ok).toBe(true);
		expect(sessions).toEqual(originalSessions);
		expect(artifacts).toEqual(originalArtifacts);
		if (!result.ok) return;
		expect(result.value.keep_sessions[0]).not.toBe(sessions[1]);
		expect(result.value.keep_artifacts[0]).not.toBe(artifacts[1]);
	});
});
