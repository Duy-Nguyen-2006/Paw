import type { PawRiskLevel, PawRuntimeConfig } from "./contracts.ts";

export type PawRunMode = "interactive" | "print" | "json" | "ci";

export type PawApprovalBlockCode = "TOOL_PERMISSION" | "NEEDS_USER_DECISION";
export type PawApprovalPolicyConfig = PawRuntimeConfig["approval"];

export type PawApprovalDecision =
	| {
			status: "allow";
	  }
	| {
			status: "needs_approval";
			message: string;
			suggestedAction: string;
			riskLevel?: PawRiskLevel;
	  }
	| {
			status: "blocked";
			code: PawApprovalBlockCode;
			message: string;
			suggestedAction: string;
			riskLevel?: PawRiskLevel;
	  };

export type PawToolApprovalInput = {
	riskLevel: PawRiskLevel;
	runMode: PawRunMode;
	config?: PawApprovalPolicyConfig;
	readOnly?: boolean;
	allowedRiskLevels?: readonly PawRiskLevel[];
};

export type PawProductApprovalInput = {
	runMode: PawRunMode;
	config?: PawApprovalPolicyConfig;
};

const PAW_RISK_LEVEL_RANKS: Record<PawRiskLevel, number> = {
	R0: 0,
	R1: 1,
	R2: 2,
	R3: 3,
	R4: 4,
	R5: 5,
	R6: 6,
	R7: 7,
};

const PAW_RISK_LEVEL_LABELS: Record<PawRiskLevel, string> = {
	R0: "read",
	R1: "safe write",
	R2: "build/test",
	R3: "dependency install",
	R4: "migration",
	R5: "deploy",
	R6: "destructive filesystem",
	R7: "secrets/auth/payment",
};

const DEFAULT_AUTO_RISK_LEVELS: readonly PawRiskLevel[] = ["R0", "R1", "R2"];
const DEFAULT_APPROVAL_RISK_LEVELS: readonly PawRiskLevel[] = ["R3", "R4", "R5", "R6"];
const DEFAULT_ALWAYS_HUMAN_RISK_LEVELS: readonly PawRiskLevel[] = ["R7"];

export function comparePawRiskLevels(left: PawRiskLevel, right: PawRiskLevel): number {
	return PAW_RISK_LEVEL_RANKS[left] - PAW_RISK_LEVEL_RANKS[right];
}

export function isPawRiskAtLeast(riskLevel: PawRiskLevel, minimumRiskLevel: PawRiskLevel): boolean {
	return comparePawRiskLevels(riskLevel, minimumRiskLevel) >= 0;
}

export function evaluatePawToolApproval(input: PawToolApprovalInput): PawApprovalDecision {
	const { riskLevel } = input;
	const autoRiskLevels = input.config?.matrix.auto ?? DEFAULT_AUTO_RISK_LEVELS;
	const approvalRiskLevels = input.config?.matrix.require_approval ?? DEFAULT_APPROVAL_RISK_LEVELS;
	const alwaysHumanRiskLevels = input.config?.matrix.always_human_never_auto ?? DEFAULT_ALWAYS_HUMAN_RISK_LEVELS;
	const riskLabel = formatPawRiskLabel(input.config, riskLevel);

	if (input.readOnly === true && isPawRiskAtLeast(riskLevel, "R1")) {
		return blocked(
			"TOOL_PERMISSION",
			`Read-only mode blocks ${riskLevel} ${riskLabel} tools.`,
			"Run in a writable mode or choose an R0 read-only tool.",
			riskLevel,
		);
	}

	if (alwaysHumanRiskLevels.includes(riskLevel)) {
		if (input.runMode === "interactive") {
			return needsApproval(
				`${riskLevel} ${riskLabel} tools require explicit human approval.`,
				"Review the sensitive operation before allowing it to run.",
				riskLevel,
			);
		}

		return blocked(
			"TOOL_PERMISSION",
			`${riskLevel} ${riskLabel} tools cannot be pre-authorized in non-interactive modes.`,
			"Run interactively and approve the sensitive operation manually.",
			riskLevel,
		);
	}

	if (autoRiskLevels.includes(riskLevel)) {
		return { status: "allow" };
	}

	if (!approvalRiskLevels.includes(riskLevel)) {
		return blocked(
			"TOOL_PERMISSION",
			`${riskLevel} ${riskLabel} tools are not covered by the Paw approval policy.`,
			"Update the Paw approval matrix or run interactively after reviewing the operation.",
			riskLevel,
		);
	}

	if (input.runMode === "interactive") {
		return needsApproval(
			`${riskLevel} ${riskLabel} tools require approval.`,
			"Approve the engineering operation before it runs.",
			riskLevel,
		);
	}

	if (input.allowedRiskLevels?.includes(riskLevel) === true) {
		return { status: "allow" };
	}

	return blocked(
		"TOOL_PERMISSION",
		`${input.runMode} mode blocks ${riskLevel} ${riskLabel} tools without an exact explicit allow.`,
		`Pass --allow ${riskLevel} or run interactively to approve the operation.`,
		riskLevel,
	);
}

export function evaluatePawProductApproval(input: PawProductApprovalInput): PawApprovalDecision {
	if (input.runMode === "interactive") {
		return needsApproval(
			"Product approval requires a user decision.",
			"Review the SPEC and approve or reject it interactively.",
		);
	}

	return blocked(
		"NEEDS_USER_DECISION",
		"Product approval cannot be completed in non-interactive mode.",
		"Emit the SPEC for review and rerun interactively after approval.",
	);
}

function needsApproval(message: string, suggestedAction: string, riskLevel?: PawRiskLevel): PawApprovalDecision {
	return {
		status: "needs_approval",
		message,
		suggestedAction,
		...(riskLevel === undefined ? {} : { riskLevel }),
	};
}

function blocked(
	code: PawApprovalBlockCode,
	message: string,
	suggestedAction: string,
	riskLevel?: PawRiskLevel,
): PawApprovalDecision {
	return {
		status: "blocked",
		code,
		message,
		suggestedAction,
		...(riskLevel === undefined ? {} : { riskLevel }),
	};
}

function formatPawRiskLabel(config: PawApprovalPolicyConfig | undefined, riskLevel: PawRiskLevel): string {
	return (config?.risk_levels[riskLevel] ?? PAW_RISK_LEVEL_LABELS[riskLevel]).replaceAll("_", " ");
}
