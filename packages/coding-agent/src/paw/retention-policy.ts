
import type { PawValidationIssue, PawValidationResult } from "./contracts.ts";

export type PawRetentionConfig = {
	keep_last_sessions: number;
	artifact_days: number;
};

export type PawRetentionSessionRecord = {
	session_id: string;
	path: string;
	last_activity_at: string;
};

export type PawRetentionArtifactRecord = {
	artifact_name: string;
	path: string;
	created_at: string;
};

export type PawRetentionRemoval = {
	kind: "session" | "artifact";
	id: string;
	path: string;
	reason: string;
};

export type PawRetentionPlan = {
	keep_sessions: PawRetentionSessionRecord[];
	remove_sessions: PawRetentionRemoval[];
	keep_artifacts: PawRetentionArtifactRecord[];
	remove_artifacts: PawRetentionRemoval[];
};

export type PawRetentionPlanInput = {
	config: PawRetentionConfig;
	sessions: readonly PawRetentionSessionRecord[];
	artifacts: readonly PawRetentionArtifactRecord[];
	now: string | Date;
};

type ParsedSession = {
	record: PawRetentionSessionRecord;
	lastActivityTime: number;
};

type ParsedArtifact = {
	record: PawRetentionArtifactRecord;
	createdTime: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function createPawRetentionPlan(input: PawRetentionPlanInput): PawValidationResult<PawRetentionPlan> {
	const issues: PawValidationIssue[] = [];

	validateNonNegativeInteger(
		issues,
		input.config.keep_last_sessions,
		"/config/keep_last_sessions",
		"keep_last_sessions must be an integer greater than or equal to 0.",
	);
	validateNonNegativeInteger(
		issues,
		input.config.artifact_days,
		"/config/artifact_days",
		"artifact_days must be an integer greater than or equal to 0.",
	);
	const nowTime = parseTimestamp(issues, input.now, "/now", "now must be a valid timestamp.");
	const sessions = validateSessions(issues, input.sessions);
	const artifacts = validateArtifacts(issues, input.artifacts);

	if (issues.length > 0 || nowTime === undefined) {
		return { ok: false, issues };
	}

	const sortedSessions = [...sessions].sort(
		(left, right) =>
			right.lastActivityTime - left.lastActivityTime ||
			left.record.session_id.localeCompare(right.record.session_id),
	);
	const keepSessionRecords = sortedSessions
		.slice(0, input.config.keep_last_sessions)
		.map((session) => ({ ...session.record }));
	const removeSessions = sortedSessions.slice(input.config.keep_last_sessions).map((session) => ({
		kind: "session" as const,
		id: session.record.session_id,
		path: session.record.path,
		reason: `exceeds keep_last_sessions=${input.config.keep_last_sessions}`,
	}));

	const artifactThreshold = nowTime - input.config.artifact_days * MS_PER_DAY;
	const sortedArtifacts = [...artifacts].sort(
		(left, right) =>
			right.createdTime - left.createdTime || left.record.artifact_name.localeCompare(right.record.artifact_name),
	);
	const keepArtifacts: PawRetentionArtifactRecord[] = [];
	const removeArtifacts: PawRetentionRemoval[] = [];

	for (const artifact of sortedArtifacts) {
		if (artifact.createdTime < artifactThreshold) {
			removeArtifacts.push({
				kind: "artifact",
				id: artifact.record.artifact_name,
				path: artifact.record.path,
				reason: `older than artifact_days=${input.config.artifact_days}`,
			});
		} else {
			keepArtifacts.push({ ...artifact.record });
		}
	}

	return {
		ok: true,
		value: {
			keep_sessions: keepSessionRecords,
			remove_sessions: removeSessions,
			keep_artifacts: keepArtifacts,
			remove_artifacts: removeArtifacts,
		},
	};
}

function validateNonNegativeInteger(issues: PawValidationIssue[], value: unknown, path: string, message: string): void {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
		issues.push({ path, message });
	}
}

function validateSessions(
	issues: PawValidationIssue[],
	sessions: readonly PawRetentionSessionRecord[],
): ParsedSession[] {
	const parsedSessions: ParsedSession[] = [];

	for (const [index, session] of sessions.entries()) {
		validateNonEmptyString(issues, session.session_id, `/sessions/${index}/session_id`, "Session id is required.");
		validateNonEmptyString(issues, session.path, `/sessions/${index}/path`, "Session path is required.");
		const lastActivityTime = parseTimestamp(
			issues,
			session.last_activity_at,
			`/sessions/${index}/last_activity_at`,
			"Session last_activity_at must be a valid timestamp.",
		);

		if (lastActivityTime !== undefined && session.session_id.trim() !== "" && session.path.trim() !== "") {
			parsedSessions.push({
				record: { ...session },
				lastActivityTime,
			});
		}
	}

	return parsedSessions;
}

function validateArtifacts(
	issues: PawValidationIssue[],
	artifacts: readonly PawRetentionArtifactRecord[],
): ParsedArtifact[] {
	const parsedArtifacts: ParsedArtifact[] = [];

	for (const [index, artifact] of artifacts.entries()) {
		validateNonEmptyString(
			issues,
			artifact.artifact_name,
			`/artifacts/${index}/artifact_name`,
			"Artifact name is required.",
		);
		validateNonEmptyString(issues, artifact.path, `/artifacts/${index}/path`, "Artifact path is required.");
		const createdTime = parseTimestamp(
			issues,
			artifact.created_at,
			`/artifacts/${index}/created_at`,
			"Artifact created_at must be a valid timestamp.",
		);

		if (createdTime !== undefined && artifact.artifact_name.trim() !== "" && artifact.path.trim() !== "") {
			parsedArtifacts.push({
				record: { ...artifact },
				createdTime,
			});
		}
	}

	return parsedArtifacts;
}

function validateNonEmptyString(issues: PawValidationIssue[], value: unknown, path: string, message: string): void {
	if (typeof value !== "string" || value.trim() === "") {
		issues.push({ path, message });
	}
}

function parseTimestamp(
	issues: PawValidationIssue[],
	value: unknown,
	path: string,
	message: string,
): number | undefined {
	if (typeof value !== "string" && !(value instanceof Date)) {
		issues.push({ path, message });
		return undefined;
	}

	const date = typeof value === "string" ? new Date(value) : value;
	const time = date.getTime();
	if (Number.isNaN(time)) {
		issues.push({ path, message });
		return undefined;
	}
	return time;
}
