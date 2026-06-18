import {
	evaluatePawToolApproval,
	isPawRiskAtLeast,
	type PawApprovalBlockCode,
	type PawRunMode,
} from "./approval-policy.ts";
import type { PawRiskLevel, PawRuntimeConfig, PawValidationIssue } from "./contracts.ts";
import {
	evaluatePawSandbox,
	evaluatePawUntrustedSource,
	isPawSecretPath,
	type PawSandboxBlockCode,
} from "./security-policy.ts";

export type PawToolRuntimeBlockCode =
	| PawApprovalBlockCode
	| PawSandboxBlockCode
	| "SECRET_PATH"
	| "UNTRUSTED_SOURCE"
	| "EXECUTE_AUTHORIZATION_REQUIRED"
	| "EXECUTE_AUTHORIZATION_MISMATCH"
	| "EXECUTOR_REQUIRED"
	| "EXECUTOR_FAILED";

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

export interface PawToolExecutionPlan {
	request: PawToolRuntimeRequest;
	description: string;
	expectedFilesChanged: boolean;
}

export type PawToolExecutionAuthorizationSource = "automatic_policy" | "explicit_allow" | "human_approval";

export interface PawToolExecutionAuthorization {
	status: "execute_authorized";
	toolName: string;
	riskLevel: PawRiskLevel;
	source: PawToolExecutionAuthorizationSource;
	reason: string;
}

export interface PawToolExecutorInput {
	plan: PawToolExecutionPlan;
	approvedRequest: PawToolRuntimeRequest;
	sandboxPrimitive?: string;
	degraded: boolean;
}

export interface PawToolExecutorResult {
	exitCode: number;
	stdout?: string;
	stderr?: string;
	filesChanged: boolean;
}

export type PawToolExecutor = (input: PawToolExecutorInput) => Promise<PawToolExecutorResult> | PawToolExecutorResult;

export interface PawToolRuntimeExecuteInput {
	config: PawRuntimeConfig;
	plan: PawToolExecutionPlan;
	authorization?: PawToolExecutionAuthorization;
	executor?: PawToolExecutor;
}

export type PawToolRuntimeDecision =
	| PawToolRuntimeDryRunAllowedDecision
	| PawToolRuntimeBlockedDecision
	| PawToolRuntimeInvalidDecision;

export type PawToolRuntimeExecutionResult =
	| PawToolRuntimeExecutedDecision
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

export interface PawToolRuntimeExecutedDecision {
	status: "executed";
	toolName: string;
	riskLevel: PawRiskLevel;
	executed: true;
	filesChanged: boolean;
	message: string;
	sandboxPrimitive?: string;
	degraded: boolean;
	exitCode: number;
	stdout?: string;
	stderr?: string;
}

export interface PawToolRuntimeBlockedDecision {
	status: "blocked";
	code: PawToolRuntimeBlockCode;
	toolName: string;
	riskLevel: PawRiskLevel;
	executed: boolean;
	filesChanged: boolean;
	message: string;
	suggestedAction: string;
	issues: readonly PawValidationIssue[];
	exitCode?: number;
	stdout?: string;
	stderr?: string;
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
	const preflight = evaluatePawToolRuntimePreflight(input, undefined);
	if (preflight.status !== "allow") {
		return preflight.decision;
	}

	return {
		status: "dry_run_allowed",
		toolName: input.request.toolName,
		riskLevel: input.request.riskLevel,
		executed: false,
		filesChanged: false,
		message: preflight.message,
		...(preflight.sandboxPrimitive === undefined ? {} : { sandboxPrimitive: preflight.sandboxPrimitive }),
		degraded: preflight.degraded,
	};
}

async function runInjectedExecutor(
	input: PawToolRuntimeExecuteInput,
	preflight: PawToolRuntimePreflightDecision & { status: "allow" },
): Promise<PawToolExecutorResult | PawToolRuntimeBlockedDecision> {
	if (input.executor === undefined) {
		return blocked(
			input.plan.request,
			"EXECUTOR_REQUIRED",
			"Paw tool execution requires an explicitly injected executor; the default runtime path is non-mutating.",
			"Provide a safe executor from a caller that owns sandboxed command execution.",
			[{ path: "/executor", message: "Missing injected executor." }],
		);
	}

	try {
		return await input.executor({
			plan: input.plan,
			approvedRequest: input.plan.request,
			...(preflight.sandboxPrimitive === undefined ? {} : { sandboxPrimitive: preflight.sandboxPrimitive }),
			degraded: preflight.degraded,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return blocked(
			input.plan.request,
			"EXECUTOR_FAILED",
			"Injected Paw tool executor threw before reporting an execution result.",
			"Inspect executor output and retry only after resolving the failure.",
			[{ path: "/executor", message }],
			{ executed: true, filesChanged: false, stderr: message },
		);
	}
}

export async function executePawToolRuntimePlan(
	input: PawToolRuntimeExecuteInput,
): Promise<PawToolRuntimeExecutionResult> {
	const preflight = evaluatePawToolRuntimePreflight(
		{ config: input.config, request: input.plan.request },
		input.authorization,
	);
	if (preflight.status !== "allow") {
		return preflight.decision;
	}

	if (input.authorization === undefined) {
		return blocked(
			input.plan.request,
			"EXECUTE_AUTHORIZATION_REQUIRED",
			"Paw tool execution requires a distinct execute authorization; dry-run approval is not execution approval.",
			"Create an execute authorization after approval gates pass, then retry with an injected executor.",
			[{ path: "/authorization", message: "Missing execute authorization." }],
		);
	}

	const authorizationIssues = validatePawToolExecutionAuthorization(input.plan.request, input.authorization);
	if (authorizationIssues.length > 0) {
		return blocked(
			input.plan.request,
			"EXECUTE_AUTHORIZATION_MISMATCH",
			"Paw tool execution authorization does not match the requested tool plan.",
			"Issue a fresh execute authorization for the exact tool name, risk level, and approval source.",
			authorizationIssues,
		);
	}

	const executorResult = await runInjectedExecutor(input, preflight);
	if ("executed" in executorResult && executorResult.executed === false) {
		return executorResult;
	}
	const result = executorResult as PawToolExecutorResult;

	if (result.exitCode !== 0) {
		return blocked(
			input.plan.request,
			"EXECUTOR_FAILED",
			`Injected Paw tool executor failed with exit code ${result.exitCode}.`,
			"Inspect executor output and retry only after resolving the failure.",
			[{ path: "/executor/exitCode", message: `Expected exit code 0, received ${result.exitCode}.` }],
			{
				executed: true,
				filesChanged: result.filesChanged,
				exitCode: result.exitCode,
				...(result.stdout === undefined ? {} : { stdout: result.stdout }),
				...(result.stderr === undefined ? {} : { stderr: result.stderr }),
			},
		);
	}

	return {
		status: "executed",
		toolName: input.plan.request.toolName,
		riskLevel: input.plan.request.riskLevel,
		executed: true,
		filesChanged: result.filesChanged,
		message:
			"Paw tool plan executed by injected executor after runtime approval, sandbox, secret, and untrusted-source gates passed.",
		...(preflight.sandboxPrimitive === undefined ? {} : { sandboxPrimitive: preflight.sandboxPrimitive }),
		degraded: preflight.degraded,
		exitCode: result.exitCode,
		...(result.stdout === undefined ? {} : { stdout: result.stdout }),
		...(result.stderr === undefined ? {} : { stderr: result.stderr }),
	};
}

type PawToolRuntimePreflightDecision =
	| {
			status: "allow";
			message: string;
			sandboxPrimitive?: string;
			degraded: boolean;
	  }
	| {
			status: "deny";
			decision: PawToolRuntimeBlockedDecision | PawToolRuntimeInvalidDecision;
	  };

function evaluatePawToolRuntimePreflight(
	input: PawToolRuntimeInput,
	authorization: PawToolExecutionAuthorization | undefined,
): PawToolRuntimePreflightDecision {
	const validationIssues = validatePawToolRuntimeRequest(input.request);
	if (validationIssues.length > 0) {
		return {
			status: "deny",
			decision: {
				status: "invalid",
				code: "INVALID_TOOL_REQUEST",
				executed: false,
				filesChanged: false,
				message: "Paw tool runtime request is invalid.",
				issues: validationIssues,
			},
		};
	}

	const secretPath = input.request.paths?.find((path) => isPawSecretPath(path, input.config.secrets));
	if (secretPath !== undefined) {
		return {
			status: "deny",
			decision: blocked(
				input.request,
				"SECRET_PATH",
				`Paw tool request touches secret path ${secretPath}.`,
				"Use a non-secret path or provide a redacted artifact reference.",
				[{ path: "/paths", message: `Secret path is excluded from Paw tool runtime: ${secretPath}.` }],
			),
		};
	}

	if (input.request.source !== undefined) {
		const sourceDecision = evaluatePawUntrustedSource(input.request.source, input.config.injection);
		if (sourceDecision.status === "read_only_summary" && input.request.readOnly !== true) {
			return {
				status: "deny",
				decision: blocked(
					input.request,
					"UNTRUSTED_SOURCE",
					`Paw tool request from untrusted source ${input.request.source} cannot perform write-capable work.`,
					"Convert untrusted content into a read-only structured summary before requesting tools.",
					[{ path: "/source", message: sourceDecision.handling }],
				),
			};
		}
	}

	const approval = evaluatePawToolApproval({
		riskLevel: input.request.riskLevel,
		runMode: input.request.runMode,
		config: input.config.approval,
		readOnly: input.request.readOnly,
		allowedRiskLevels: input.request.allowedRiskLevels,
	});
	if (approval.status === "blocked") {
		return {
			status: "deny",
			decision: blocked(input.request, approval.code, approval.message, approval.suggestedAction, [
				{ path: "/riskLevel", message: approval.message },
			]),
		};
	}
	if (approval.status === "needs_approval" && authorization?.source !== "human_approval") {
		return {
			status: "deny",
			decision: blocked(input.request, "NEEDS_USER_DECISION", approval.message, approval.suggestedAction, [
				{ path: "/riskLevel", message: approval.message },
			]),
		};
	}

	if (input.request.readOnly !== true) {
		const sandbox = evaluatePawSandbox({
			config: input.config.sandbox,
			availablePrimitives: input.request.sandbox?.availablePrimitives ?? [],
			riskLevel: input.request.riskLevel,
			unsafeOverride: input.request.sandbox?.unsafeOverride,
		});
		if (sandbox.status !== "allow") {
			return {
				status: "deny",
				decision: blocked(input.request, sandbox.code, sandbox.message, sandbox.suggestedAction, [
					{ path: "/sandbox", message: sandbox.message },
				]),
			};
		}
		return {
			status: "allow",
			message: sandbox.message,
			...("selectedPrimitive" in sandbox ? { sandboxPrimitive: sandbox.selectedPrimitive } : {}),
			degraded: sandbox.degraded,
		};
	}

	return {
		status: "allow",
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

function validatePawToolExecutionAuthorization(
	request: PawToolRuntimeRequest,
	authorization: PawToolExecutionAuthorization,
): PawValidationIssue[] {
	const issues: PawValidationIssue[] = [];

	if (authorization.status !== "execute_authorized") {
		issues.push({ path: "/authorization/status", message: "Expected execute_authorized status." });
	}
	if (authorization.toolName !== request.toolName) {
		issues.push({ path: "/authorization/toolName", message: "Authorization tool name must match the plan." });
	}
	if (authorization.riskLevel !== request.riskLevel) {
		issues.push({ path: "/authorization/riskLevel", message: "Authorization risk level must match the plan." });
	}
	if (authorization.reason.trim().length === 0) {
		issues.push({ path: "/authorization/reason", message: "Expected non-empty execute authorization reason." });
	}
	if (request.riskLevel === "R7" && authorization.source !== "human_approval") {
		issues.push({ path: "/authorization/source", message: "R7 execution requires human approval." });
	}
	if (authorization.source === "automatic_policy" && !isAutoExecutableRisk(request.riskLevel)) {
		issues.push({ path: "/authorization/source", message: "Automatic execution authorization is limited to R0-R2." });
	}
	if (authorization.source === "explicit_allow" && !isExplicitAllowExecutableRisk(request.riskLevel)) {
		issues.push({
			path: "/authorization/source",
			message: "Explicit allow execution authorization is limited to R3-R6.",
		});
	}

	return issues;
}

function isAutoExecutableRisk(riskLevel: PawRiskLevel): boolean {
	return !isPawRiskAtLeast(riskLevel, "R3");
}

function isExplicitAllowExecutableRisk(riskLevel: PawRiskLevel): boolean {
	return isPawRiskAtLeast(riskLevel, "R3") && !isPawRiskAtLeast(riskLevel, "R7");
}

function blocked(
	request: PawToolRuntimeRequest,
	code: PawToolRuntimeBlockCode,
	message: string,
	suggestedAction: string,
	issues: readonly PawValidationIssue[],
	execution?: Pick<PawToolRuntimeBlockedDecision, "executed" | "filesChanged" | "exitCode" | "stdout" | "stderr">,
): PawToolRuntimeBlockedDecision {
	return {
		status: "blocked",
		code,
		toolName: request.toolName,
		riskLevel: request.riskLevel,
		executed: execution?.executed ?? false,
		filesChanged: execution?.filesChanged ?? false,
		message,
		suggestedAction,
		issues,
		...(execution?.exitCode === undefined ? {} : { exitCode: execution.exitCode }),
		...(execution?.stdout === undefined ? {} : { stdout: execution.stdout }),
		...(execution?.stderr === undefined ? {} : { stderr: execution.stderr }),
	};
}
