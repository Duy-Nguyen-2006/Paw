import { evaluatePawToolApproval, type PawApprovalBlockCode, type PawRunMode } from "./approval-policy.ts";
import type { PawRiskLevel, PawRuntimeConfig, PawValidationIssue } from "./contracts.ts";
import {
	evaluatePawSandbox,
	evaluatePawUntrustedSource,
	isPawSecretPath,
	type PawSandboxBlockCode,
} from "./security-policy.ts";

export type PawToolRuntimeBlockCode = PawApprovalBlockCode | PawSandboxBlockCode | "SECRET_PATH" | "UNTRUSTED_SOURCE";

export interface PawToolRuntimeSandboxInput {
	availablePrimitives: readonly string[];
	unsafeOverride?: boolean;
}

export interface PawToolRuntimeRequest {
	toolName: string;
	riskLevel: PawRiskLevel;
	runMode: PawRunMode;
	readOnly?: boolean;
	allowedRiskLevels?: readonly PawRiskLevel[];
	sandbox?: PawToolRuntimeSandboxInput;
	paths?: readonly string[];
	source?: string;
}

export interface PawToolRuntimeInput {
	config: PawRuntimeConfig;
	request: PawToolRuntimeRequest;
}

export type PawToolRuntimeDecision =
	| PawToolRuntimeDryRunAllowedDecision
	| PawToolRuntimeBlockedDecision
	| PawToolRuntimeInvalidDecision;

export interface PawToolRuntimeDryRunAllowedDecision {
	status: "dry_run_allowed";
	toolName: string;
	riskLevel: PawRiskLevel;
	executed: false;
	filesChanged: false;
	message: string;
	sandboxPrimitive?: string;
	degraded: boolean;
}

export interface PawToolRuntimeBlockedDecision {
	status: "blocked";
	code: PawToolRuntimeBlockCode;
	toolName: string;
	riskLevel: PawRiskLevel;
	executed: false;
	filesChanged: false;
	message: string;
	suggestedAction: string;
	issues: readonly PawValidationIssue[];
}

export interface PawToolRuntimeInvalidDecision {
	status: "invalid";
	code: "INVALID_TOOL_REQUEST";
	executed: false;
	filesChanged: false;
	message: string;
	issues: readonly PawValidationIssue[];
}

export function evaluatePawToolRuntimeRequest(input: PawToolRuntimeInput): PawToolRuntimeDecision {
	const validationIssues = validatePawToolRuntimeRequest(input.request);
	if (validationIssues.length > 0) {
		return {
			status: "invalid",
			code: "INVALID_TOOL_REQUEST",
			executed: false,
			filesChanged: false,
			message: "Paw tool runtime request is invalid.",
			issues: validationIssues,
		};
	}

	const secretPath = input.request.paths?.find((path) => isPawSecretPath(path, input.config.secrets));
	if (secretPath !== undefined) {
		return blocked(
			input.request,
			"SECRET_PATH",
			`Paw tool request touches secret path ${secretPath}.`,
			"Use a non-secret path or provide a redacted artifact reference.",
			[{ path: "/paths", message: `Secret path is excluded from Paw tool runtime: ${secretPath}.` }],
		);
	}

	if (input.request.source !== undefined) {
		const sourceDecision = evaluatePawUntrustedSource(input.request.source, input.config.injection);
		if (sourceDecision.status === "read_only_summary" && input.request.readOnly !== true) {
			return blocked(
				input.request,
				"UNTRUSTED_SOURCE",
				`Paw tool request from untrusted source ${input.request.source} cannot perform write-capable work.`,
				"Convert untrusted content into a read-only structured summary before requesting tools.",
				[{ path: "/source", message: sourceDecision.handling }],
			);
		}
	}

	const approval = evaluatePawToolApproval({
		riskLevel: input.request.riskLevel,
		runMode: input.request.runMode,
		config: input.config.approval,
		readOnly: input.request.readOnly,
		allowedRiskLevels: input.request.allowedRiskLevels,
	});
	if (approval.status === "blocked" || approval.status === "needs_approval") {
		return blocked(
			input.request,
			approval.status === "blocked" ? approval.code : "NEEDS_USER_DECISION",
			approval.message,
			approval.suggestedAction,
			[{ path: "/riskLevel", message: approval.message }],
		);
	}

	if (input.request.readOnly !== true) {
		const sandbox = evaluatePawSandbox({
			config: input.config.sandbox,
			availablePrimitives: input.request.sandbox?.availablePrimitives ?? [],
			riskLevel: input.request.riskLevel,
			unsafeOverride: input.request.sandbox?.unsafeOverride,
		});
		if (sandbox.status !== "allow") {
			return blocked(input.request, sandbox.code, sandbox.message, sandbox.suggestedAction, [
				{ path: "/sandbox", message: sandbox.message },
			]);
		}
		return {
			status: "dry_run_allowed",
			toolName: input.request.toolName,
			riskLevel: input.request.riskLevel,
			executed: false,
			filesChanged: false,
			message: sandbox.message,
			...("selectedPrimitive" in sandbox ? { sandboxPrimitive: sandbox.selectedPrimitive } : {}),
			degraded: sandbox.degraded,
		};
	}

	return {
		status: "dry_run_allowed",
		toolName: input.request.toolName,
		riskLevel: input.request.riskLevel,
		executed: false,
		filesChanged: false,
		message: "Paw tool request is allowed for dry-run inspection only.",
		degraded: false,
	};
}

function validatePawToolRuntimeRequest(request: PawToolRuntimeRequest): PawValidationIssue[] {
	const issues: PawValidationIssue[] = [];
	if (request.toolName.trim().length === 0) {
		issues.push({ path: "/toolName", message: "Expected non-empty tool name." });
	}
	for (const [index, path] of (request.paths ?? []).entries()) {
		if (path.trim().length === 0) {
			issues.push({ path: `/paths/${index}`, message: "Expected non-empty path." });
		}
	}
	return issues;
}

function blocked(
	request: PawToolRuntimeRequest,
	code: PawToolRuntimeBlockCode,
	message: string,
	suggestedAction: string,
	issues: readonly PawValidationIssue[],
): PawToolRuntimeBlockedDecision {
	return {
		status: "blocked",
		code,
		toolName: request.toolName,
		riskLevel: request.riskLevel,
		executed: false,
		filesChanged: false,
		message,
		suggestedAction,
		issues,
	};
}
