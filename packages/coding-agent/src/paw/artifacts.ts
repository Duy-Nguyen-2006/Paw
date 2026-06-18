import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PawSubAgentRole } from "./contracts.ts";
import { resolvePawProjectPaths } from "./persistence.ts";

export interface PawArtifactNameInput {
	timestamp: Date | string;
	slug: string;
	shortId: string;
}

export interface PawArtifactPaths {
	repoRoot: string;
	artifactName: string;
	agent: PawSubAgentRole;
	artifactDir: string;
	agentDir: string;
	reportFile: string;
	artifactRef: string;
}

const PAW_ARTIFACT_REF_PATTERN = /^\.paw\/artifacts\/.+\/(scout|planner|worker|reviewer)\/report\.md$/;
const PAW_ARTIFACT_NAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const PAW_SUB_AGENT_ROLES: readonly PawSubAgentRole[] = ["scout", "planner", "worker", "reviewer"];
const MAX_ARTIFACT_SLUG_LENGTH = 48;

export function createPawArtifactName(input: PawArtifactNameInput): string {
	const timestamp = formatArtifactTimestamp(input.timestamp);
	const slug = sanitizeArtifactSegment(input.slug, "artifact", MAX_ARTIFACT_SLUG_LENGTH);
	const shortId = sanitizeArtifactShortId(input.shortId);

	return `${timestamp}-${slug}-${shortId}`;
}

export function resolvePawArtifactPaths(
	repoRoot: string,
	artifactName: string,
	agent: PawSubAgentRole,
): PawArtifactPaths {
	assertValidArtifactName(artifactName);
	assertValidArtifactAgent(agent);

	const projectPaths = resolvePawProjectPaths(repoRoot);
	const artifactDir = join(projectPaths.pawDir, "artifacts", artifactName);
	const agentDir = join(artifactDir, agent);

	return {
		repoRoot: projectPaths.repoRoot,
		artifactName,
		agent,
		artifactDir,
		agentDir,
		reportFile: join(agentDir, "report.md"),
		artifactRef: `.paw/artifacts/${artifactName}/${agent}/report.md`,
	};
}

export async function writePawArtifactReport(
	repoRoot: string,
	artifactName: string,
	agent: PawSubAgentRole,
	content: string,
): Promise<PawArtifactPaths> {
	const paths = resolvePawArtifactPaths(repoRoot, artifactName, agent);

	await mkdir(paths.agentDir, { recursive: true });
	await writeFile(paths.reportFile, content, "utf-8");

	return paths;
}

export async function readPawArtifactReport(
	repoRoot: string,
	artifactName: string,
	agent: PawSubAgentRole,
): Promise<string> {
	const paths = resolvePawArtifactPaths(repoRoot, artifactName, agent);
	return readFile(paths.reportFile, "utf-8");
}

export function isPawArtifactRef(ref: string): boolean {
	return PAW_ARTIFACT_REF_PATTERN.test(ref);
}

export function assertPawArtifactRef(ref: string): void {
	if (!isPawArtifactRef(ref)) {
		throw new Error(`Invalid Paw artifact ref: ${ref}`);
	}
}

function formatArtifactTimestamp(timestamp: Date | string): string {
	const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp;

	if (Number.isNaN(date.getTime())) {
		throw new Error("Paw artifact timestamp must be a valid date.");
	}

	const iso = date.toISOString();
	return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
}

function sanitizeArtifactSegment(value: string, fallback: string, maxLength: number): string {
	const sanitized = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, maxLength)
		.replace(/^-+|-+$/g, "");

	return sanitized.length > 0 ? sanitized : fallback;
}

function sanitizeArtifactShortId(value: string): string {
	const sanitized = value.toLowerCase().replace(/[^a-z0-9]+/g, "");
	if (sanitized.length === 0) {
		throw new Error("Paw artifact short id must contain at least one alphanumeric character.");
	}
	return sanitized;
}

function assertValidArtifactName(artifactName: string): void {
	if (!PAW_ARTIFACT_NAME_PATTERN.test(artifactName)) {
		throw new Error(
			"Paw artifact name must be non-empty, contain only alphanumeric characters and '-', and start and end with an alphanumeric character.",
		);
	}
}

function assertValidArtifactAgent(agent: PawSubAgentRole): void {
	if (!PAW_SUB_AGENT_ROLES.includes(agent)) {
		throw new Error(`Paw artifact agent must be one of: ${PAW_SUB_AGENT_ROLES.join(", ")}.`);
	}
}
