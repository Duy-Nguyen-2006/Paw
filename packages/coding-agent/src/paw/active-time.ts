import type { PawValidationIssue, PawValidationResult } from "./contracts.ts";
import type { PawSessionStateName } from "./state.ts";

export type PawActiveTimeConfig = {
	enabled: boolean;
	pause_states: readonly string[];
};

export type PawStateTimingSegment = {
	state: PawSessionStateName;
	started_at: string;
	ended_at?: string | null;
};

export type PawPausedTimingSegment = {
	state: PawSessionStateName;
	started_at: string;
	ended_at: string;
	duration_ms: number;
};

export type PawActiveTimeInput = {
	config: PawActiveTimeConfig;
	segments: readonly PawStateTimingSegment[];
	now?: string | Date;
};

export type PawActiveTimeResult = {
	active_ms: number;
	paused_ms: number;
	total_ms: number;
	paused_segments: PawPausedTimingSegment[];
};

type ParsedTimingSegment = {
	segment: PawStateTimingSegment;
	startedAtMs: number;
	endedAtMs: number;
	endedAtValue: string;
};

export function calculatePawActiveTime(input: PawActiveTimeInput): PawValidationResult<PawActiveTimeResult> {
	const issues: PawValidationIssue[] = [];
	const now = parseOptionalNow(input.now, issues);
	const parsedSegments: ParsedTimingSegment[] = [];

	for (const [index, segment] of input.segments.entries()) {
		const startedAtMs = parseTimestamp(segment.started_at, `/segments/${index}/started_at`, issues);
		const endedAt = resolveEndedAt(segment, index, now, input.now, issues);

		if (startedAtMs === null || endedAt === null) {
			continue;
		}

		if (endedAt.ms < startedAtMs) {
			issues.push({
				path: `/segments/${index}/ended_at`,
				message: "Segment ended before it started.",
			});
			continue;
		}

		parsedSegments.push({
			segment,
			startedAtMs,
			endedAtMs: endedAt.ms,
			endedAtValue: endedAt.value,
		});
	}

	if (issues.length > 0) {
		return { ok: false, issues };
	}

	let totalMs = 0;
	let pausedMs = 0;
	const pausedSegments: PawPausedTimingSegment[] = [];

	for (const parsedSegment of parsedSegments) {
		const durationMs = parsedSegment.endedAtMs - parsedSegment.startedAtMs;
		totalMs += durationMs;

		if (input.config.enabled && input.config.pause_states.includes(parsedSegment.segment.state)) {
			pausedMs += durationMs;
			pausedSegments.push({
				state: parsedSegment.segment.state,
				started_at: parsedSegment.segment.started_at,
				ended_at: parsedSegment.endedAtValue,
				duration_ms: durationMs,
			});
		}
	}

	return {
		ok: true,
		value: {
			active_ms: totalMs - pausedMs,
			paused_ms: pausedMs,
			total_ms: totalMs,
			paused_segments: input.config.enabled ? pausedSegments : [],
		},
	};
}

function parseOptionalNow(
	now: string | Date | undefined,
	issues: PawValidationIssue[],
): { ms: number; value: string } | null {
	if (now === undefined) {
		return null;
	}

	if (now instanceof Date) {
		const ms = now.getTime();
		if (Number.isNaN(ms)) {
			issues.push({ path: "/now", message: "Invalid timestamp." });
			return null;
		}
		return { ms, value: now.toISOString() };
	}

	const ms = parseTimestamp(now, "/now", issues);
	return ms === null ? null : { ms, value: now };
}

function resolveEndedAt(
	segment: PawStateTimingSegment,
	index: number,
	now: { ms: number; value: string } | null,
	inputNow: string | Date | undefined,
	issues: PawValidationIssue[],
): { ms: number; value: string } | null {
	if (segment.ended_at !== undefined && segment.ended_at !== null) {
		const ms = parseTimestamp(segment.ended_at, `/segments/${index}/ended_at`, issues);
		return ms === null ? null : { ms, value: segment.ended_at };
	}

	if (inputNow === undefined) {
		issues.push({ path: `/segments/${index}/ended_at`, message: "Open segment requires now." });
		return null;
	}

	return now;
}

function parseTimestamp(value: string, path: string, issues: PawValidationIssue[]): number | null {
	const ms = new Date(value).getTime();
	if (Number.isNaN(ms)) {
		issues.push({ path, message: "Invalid timestamp." });
		return null;
	}
	return ms;
}
