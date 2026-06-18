
import { Buffer } from "node:buffer";
import type { PawArtifactPaths } from "./artifacts.ts";
import { writePawArtifactReport } from "./artifacts.ts";
import type { PawSubAgentRole, PawValidationIssue, PawValidationResult } from "./contracts.ts";

export type PawSubAgentArtifactReportInput = {
	repoRoot: string;
	artifactName: string;
	agent: PawSubAgentRole;
	reportContent: string;
	maxReportBytes: number;
};

export type PawSubAgentArtifactReport = {
	paths: PawArtifactPaths;
	artifactRef: string;
	byteLength: number;
	maxReportBytes: number;
};

export async function writePawSubAgentArtifactReport(
	input: PawSubAgentArtifactReportInput,
): Promise<PawValidationResult<PawSubAgentArtifactReport>> {
	const byteLength = Buffer.byteLength(input.reportContent, "utf-8");

	if (!Number.isInteger(input.maxReportBytes) || input.maxReportBytes < 0) {
		return {
			ok: false,
			issues: [
				{
					path: "/maxReportBytes",
					message: "maxReportBytes must be a non-negative integer.",
				},
			],
		};
	}

	if (byteLength > input.maxReportBytes) {
		return {
			ok: false,
			issues: [
				{
					path: "/reportContent",
					message: `Report content is ${byteLength} bytes, exceeding maxReportBytes ${input.maxReportBytes}.`,
				},
			],
		};
	}

	try {
		const paths = await writePawArtifactReport(input.repoRoot, input.artifactName, input.agent, input.reportContent);

		return {
			ok: true,
			value: {
				paths,
				artifactRef: paths.artifactRef,
				byteLength,
				maxReportBytes: input.maxReportBytes,
			},
		};
	} catch (error) {
		return {
			ok: false,
			issues: [createArtifactReportIssue(error)],
		};
	}
}

function createArtifactReportIssue(error: unknown): PawValidationIssue {
	const message = error instanceof Error ? error.message : "Failed to write Paw sub-agent artifact report.";

	if (message.startsWith("Paw artifact name must")) {
		return {
			path: "/artifactName",
			message,
		};
	}

	if (message.startsWith("Paw artifact agent must")) {
		return {
			path: "/agent",
			message,
		};
	}

	return {
		path: "/paths/reportFile",
		message,
	};
}
