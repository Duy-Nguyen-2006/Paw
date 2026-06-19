import { Compile } from "typebox/compile";
import {
	type PawSubAgentOutput,
	PawSubAgentOutputSchema,
	type PawValidationIssue,
	type PawValidationResult,
} from "./contracts.ts";
import { formatTypeboxIssues } from "./validation.ts";

const validateSubAgentOutput = Compile(PawSubAgentOutputSchema);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getSubAgentConditionalIssues(input: unknown): PawValidationIssue[] {
	if (!isRecord(input)) {
		return [];
	}

	const issues: PawValidationIssue[] = [];
	if (
		(input.status === "blocked" || input.status === "needs_user_decision") &&
		(!("blocked_reason" in input) || !isRecord(input.blocked_reason))
	) {
		issues.push({
			path: "/blocked_reason",
			message: "Expected object for blocked or needs_user_decision status",
		});
	}

	if (input.agent === "planner" && input.status === "pass" && !Array.isArray(input.plan_slices)) {
		issues.push({
			path: "/plan_slices",
			message: "Expected planner pass output to include plan_slices",
		});
	}

	return issues;
}

export function validatePawSubAgentOutput(input: unknown): PawValidationResult<PawSubAgentOutput> {
	const normalized = normalizePawSubAgentOutputCandidate(input);
	const issues = validateSubAgentOutput.Check(normalized)
		? []
		: formatTypeboxIssues(validateSubAgentOutput.Errors(normalized));
	issues.push(...getSubAgentConditionalIssues(input));

	if (issues.length > 0) {
		return { ok: false, issues };
	}

	return { ok: true, value: normalized as PawSubAgentOutput };
}

function normalizePawSubAgentOutputCandidate(input: unknown): unknown {
	if (!isRecord(input)) {
		return input;
	}
	const normalized: Record<string, unknown> = { ...input };
	if (typeof normalized.confidence === "number") {
		const confidence = normalized.confidence;
		normalized.confidence = confidence >= 0.75 ? "high" : confidence >= 0.4 ? "medium" : "low";
	}
	if (Array.isArray(normalized.risks)) {
		normalized.risks = normalized.risks.map((risk) => {
			if (typeof risk === "string") {
				return { description: risk, severity: "medium" };
			}
			return risk;
		});
	}
	return normalized;
}

export function parsePawSubAgentOutputJson(content: string): PawValidationResult<PawSubAgentOutput> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			ok: false,
			issues: [{ path: "/", message: `Invalid JSON: ${message}` }],
		};
	}

	return validatePawSubAgentOutput(parsed);
}
