
import { describe, expect, test } from "vitest";
import { calculatePawActiveTime, loadDefaultPawRuntimeConfig } from "../src/paw/index.ts";

describe("Paw active-time clock policy", () => {
	test("default runtime config excludes BLOCKED_NEEDS_USER_DECISION", () => {
		const config = loadDefaultPawRuntimeConfig();

		const result = calculatePawActiveTime({
			config: config.resilience.active_time_clock,
			segments: [
				{
					state: "IMPLEMENTING",
					started_at: "2026-01-01T00:00:00.000Z",
					ended_at: "2026-01-01T00:02:00.000Z",
				},
				{
					state: "BLOCKED_NEEDS_USER_DECISION",
					started_at: "2026-01-01T00:02:00.000Z",
					ended_at: "2026-01-01T00:05:00.000Z",
				},
				{
					state: "VERIFYING",
					started_at: "2026-01-01T00:05:00.000Z",
					ended_at: "2026-01-01T00:06:00.000Z",
				},
			],
		});

		expect(result).toEqual({
			ok: true,
			value: {
				active_ms: 180_000,
				paused_ms: 180_000,
				total_ms: 360_000,
				paused_segments: [
					{
						state: "BLOCKED_NEEDS_USER_DECISION",
						started_at: "2026-01-01T00:02:00.000Z",
						ended_at: "2026-01-01T00:05:00.000Z",
						duration_ms: 180_000,
					},
				],
			},
		});
	});

	test("disabled clock counts pause-state time as active", () => {
		const result = calculatePawActiveTime({
			config: { enabled: false, pause_states: ["BLOCKED_NEEDS_USER_DECISION"] },
			segments: [
				{
					state: "BLOCKED_NEEDS_USER_DECISION",
					started_at: "2026-01-01T00:00:00.000Z",
					ended_at: "2026-01-01T00:03:00.000Z",
				},
			],
		});

		expect(result).toEqual({
			ok: true,
			value: {
				active_ms: 180_000,
				paused_ms: 0,
				total_ms: 180_000,
				paused_segments: [],
			},
		});
	});

	test("open segment uses explicit now", () => {
		const result = calculatePawActiveTime({
			config: { enabled: true, pause_states: ["BLOCKED_NEEDS_USER_DECISION"] },
			now: "2026-01-01T00:04:00.000Z",
			segments: [
				{
					state: "BLOCKED_NEEDS_USER_DECISION",
					started_at: "2026-01-01T00:01:00.000Z",
				},
			],
		});

		expect(result).toEqual({
			ok: true,
			value: {
				active_ms: 0,
				paused_ms: 180_000,
				total_ms: 180_000,
				paused_segments: [
					{
						state: "BLOCKED_NEEDS_USER_DECISION",
						started_at: "2026-01-01T00:01:00.000Z",
						ended_at: "2026-01-01T00:04:00.000Z",
						duration_ms: 180_000,
					},
				],
			},
		});
	});

	test("invalid timestamp returns path-level issue", () => {
		const result = calculatePawActiveTime({
			config: { enabled: true, pause_states: [] },
			segments: [
				{
					state: "IMPLEMENTING",
					started_at: "not-a-date",
					ended_at: "2026-01-01T00:01:00.000Z",
				},
			],
		});

		expect(result).toEqual({
			ok: false,
			issues: [{ path: "/segments/0/started_at", message: "Invalid timestamp." }],
		});
	});

	test("negative duration returns path-level issue", () => {
		const result = calculatePawActiveTime({
			config: { enabled: true, pause_states: [] },
			segments: [
				{
					state: "IMPLEMENTING",
					started_at: "2026-01-01T00:02:00.000Z",
					ended_at: "2026-01-01T00:01:00.000Z",
				},
			],
		});

		expect(result).toEqual({
			ok: false,
			issues: [{ path: "/segments/0/ended_at", message: "Segment ended before it started." }],
		});
	});

	test("open segment without now returns path-level issue", () => {
		const result = calculatePawActiveTime({
			config: { enabled: true, pause_states: [] },
			segments: [
				{
					state: "IMPLEMENTING",
					started_at: "2026-01-01T00:00:00.000Z",
				},
			],
		});

		expect(result).toEqual({
			ok: false,
			issues: [{ path: "/segments/0/ended_at", message: "Open segment requires now." }],
		});
	});

	test("non-pause blocked state counts as active unless configured", () => {
		const result = calculatePawActiveTime({
			config: { enabled: true, pause_states: ["BLOCKED_NEEDS_USER_DECISION"] },
			segments: [
				{
					state: "BLOCKED_TEST_FAILURE",
					started_at: "2026-01-01T00:00:00.000Z",
					ended_at: "2026-01-01T00:02:00.000Z",
				},
			],
		});

		expect(result).toEqual({
			ok: true,
			value: {
				active_ms: 120_000,
				paused_ms: 0,
				total_ms: 120_000,
				paused_segments: [],
			},
		});
	});
});
