import type { PawValidationIssue } from "./contracts.ts";
import type { PawVerifyGateDecision, PawVerifyGateSet } from "./resilience-policy.ts";

export function extractPawVerifyDecisionsFromJson(parsed: unknown): unknown[] | undefined {
	if (Array.isArray(parsed)) {
		return parsed;
	}
	if (typeof parsed === "object" && parsed !== null && "verify_decisions" in parsed) {
		const verifyDecisions = (parsed as { verify_decisions?: unknown }).verify_decisions;
		if (Array.isArray(verifyDecisions)) {
			return verifyDecisions;
		}
	}
	return undefined;
}

export function collectPawVerifyGateFieldIssues(
	record: Record<string, unknown>,
	basePath: string,
): PawValidationIssue[] {
	const itemIssues: PawValidationIssue[] = [];
	if (typeof record.status !== "string") {
		itemIssues.push({ path: `${basePath}/status`, message: "status must be a string." });
	}
	const gate = record.gate;
	if (typeof gate !== "string" || gate.trim().length === 0) {
		itemIssues.push({ path: `${basePath}/gate`, message: "gate must be a non-empty string." });
	}
	if (!isPawVerifyGateSet(record.gateSet)) {
		itemIssues.push({ path: `${basePath}/gateSet`, message: 'gateSet must be "v1", "v2", or "unconfigured".' });
	}
	if (typeof record.verified !== "boolean") {
		itemIssues.push({ path: `${basePath}/verified`, message: "verified must be a boolean." });
	}
	if (typeof record.applicable !== "boolean") {
		itemIssues.push({ path: `${basePath}/applicable`, message: "applicable must be a boolean." });
	}
	return itemIssues;
}

export function normalizePawVerifyGateDecision(
	decision: unknown,
	basePath: string,
	issues: PawValidationIssue[],
): PawVerifyGateDecision | undefined {
	if (typeof decision !== "object" || decision === null) {
		issues.push({ path: basePath, message: "Each verify decision must be an object." });
		return undefined;
	}

	const record = decision as Record<string, unknown>;
	const itemIssues = collectPawVerifyGateFieldIssues(record, basePath);
	if (itemIssues.length > 0) {
		issues.push(...itemIssues);
		return undefined;
	}

	return buildPawVerifyGateDecisionFromRecord(record, basePath, issues);
}

function buildPawVerifyGateDecisionFromRecord(
	record: Record<string, unknown>,
	basePath: string,
	issues: PawValidationIssue[],
): PawVerifyGateDecision | undefined {
	const { status, gate, gateSet, verified, applicable, reason } = record;
	const normalizedStatus = status as string;
	const normalizedGate = gate as string;
	const normalizedGateSet = gateSet as PawVerifyGateSet;
	const normalizedApplicable = applicable as boolean;

	if (normalizedStatus === "verified") {
		return buildPawVerifiedGateDecision(
			verified,
			normalizedGate,
			normalizedApplicable,
			normalizedGateSet,
			basePath,
			issues,
		);
	}

	if (normalizedStatus === "unverified") {
		return buildPawUnverifiedGateDecision(
			verified,
			reason,
			normalizedGate,
			normalizedApplicable,
			normalizedGateSet,
			basePath,
			issues,
		);
	}

	issues.push({ path: `${basePath}/status`, message: 'status must be "verified" or "unverified".' });
	return undefined;
}

function buildPawVerifiedGateDecision(
	verified: unknown,
	gate: string,
	applicable: boolean,
	gateSet: PawVerifyGateSet,
	basePath: string,
	issues: PawValidationIssue[],
): PawVerifyGateDecision | undefined {
	if (verified !== true) {
		issues.push({ path: `${basePath}/verified`, message: "verified decisions must set verified=true." });
		return undefined;
	}
	return {
		status: "verified",
		gate,
		verified: true,
		applicable,
		gateSet,
	};
}

function buildPawUnverifiedGateDecision(
	verified: unknown,
	reason: unknown,
	gate: string,
	applicable: boolean,
	gateSet: PawVerifyGateSet,
	basePath: string,
	issues: PawValidationIssue[],
): PawVerifyGateDecision | undefined {
	if (verified !== false) {
		issues.push({ path: `${basePath}/verified`, message: "unverified decisions must set verified=false." });
		return undefined;
	}
	const unverifiedReason = typeof reason === "string" && reason.trim().length > 0 ? reason : "unverified";
	return {
		status: "unverified",
		gate,
		verified: false,
		applicable,
		gateSet,
		reason: unverifiedReason,
	};
}

export function normalizePawVerifyGateDecisionList(decisions: unknown[]):
	| {
			ok: true;
			value: PawVerifyGateDecision[];
	  }
	| {
			ok: false;
			issues: PawValidationIssue[];
	  } {
	const issues: PawValidationIssue[] = [];
	const normalized: PawVerifyGateDecision[] = [];
	for (let index = 0; index < decisions.length; index += 1) {
		const decision = decisions[index];
		const basePath = `/verify_decisions/${index}`;
		const normalizedDecision = normalizePawVerifyGateDecision(decision, basePath, issues);
		if (normalizedDecision !== undefined) {
			normalized.push(normalizedDecision);
		}
	}

	if (issues.length > 0) {
		return { ok: false, issues };
	}

	return { ok: true, value: normalized };
}

function isPawVerifyGateSet(value: unknown): value is PawVerifyGateSet {
	return value === "v1" || value === "v2" || value === "unconfigured";
}
