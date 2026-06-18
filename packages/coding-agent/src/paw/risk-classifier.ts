
import { comparePawRiskLevels, isPawRiskAtLeast } from "./approval-policy.ts";
import type { PawRiskLevel, PawRuntimeConfig, PawTaskClass } from "./contracts.ts";

export type PawRiskClassifierConfig = PawRuntimeConfig["routing"]["trivial_requires_all"];

export type PawRiskScoringInput = {
	changedFileCount: number;
	crossLayer?: boolean;
	writesRequested?: boolean;
	buildOrTest?: boolean;
	securityPath?: boolean;
	newDependency?: boolean;
	schemaOrDbChange?: boolean;
	destructiveCommand?: boolean;
	infraOrDeploy?: boolean;
};

export type PawRiskScore = {
	riskLevel: PawRiskLevel;
	reasons: string[];
};

export type PawTaskClassification = {
	taskClass: PawTaskClass;
	risk: PawRiskScore;
	reasons: string[];
};

type PawRiskSignal = {
	flag: keyof Pick<
		PawRiskScoringInput,
		"buildOrTest" | "securityPath" | "newDependency" | "schemaOrDbChange" | "destructiveCommand" | "infraOrDeploy"
	>;
	riskLevel: PawRiskLevel;
	reason: string;
};

const RISK_SIGNALS: readonly PawRiskSignal[] = [
	{ flag: "buildOrTest", riskLevel: "R2", reason: "build/test operation requested" },
	{ flag: "newDependency", riskLevel: "R3", reason: "new dependency requested" },
	{ flag: "schemaOrDbChange", riskLevel: "R4", reason: "schema or database change requested" },
	{ flag: "infraOrDeploy", riskLevel: "R5", reason: "infra or deploy operation requested" },
	{ flag: "destructiveCommand", riskLevel: "R6", reason: "destructive command requested" },
	{ flag: "securityPath", riskLevel: "R7", reason: "security/auth/payment/secrets path requested" },
];

export function maxPawRiskLevel(riskLevels: readonly PawRiskLevel[]): PawRiskLevel {
	let maxRiskLevel: PawRiskLevel = "R0";
	for (const riskLevel of riskLevels) {
		if (comparePawRiskLevels(riskLevel, maxRiskLevel) > 0) {
			maxRiskLevel = riskLevel;
		}
	}
	return maxRiskLevel;
}

export function scorePawTaskRisk(input: PawRiskScoringInput): PawRiskScore {
	const riskLevels: PawRiskLevel[] = [input.writesRequested === true ? "R1" : "R0"];
	const reasons: string[] = [
		input.writesRequested === true ? "writes requested" : "no writes requested",
		`changed file count: ${input.changedFileCount}`,
	];

	if (input.crossLayer === true) {
		reasons.push("cross-layer work requested");
	}

	for (const signal of RISK_SIGNALS) {
		if (input[signal.flag] === true) {
			riskLevels.push(signal.riskLevel);
			reasons.push(signal.reason);
		}
	}

	return {
		riskLevel: maxPawRiskLevel(riskLevels),
		reasons,
	};
}

export function classifyPawTask(input: PawRiskScoringInput, config: PawRiskClassifierConfig): PawTaskClassification {
	const risk = scorePawTaskRisk(input);
	const trivialFailures = getTrivialRequirementFailures(input, risk.riskLevel, config);
	const reasons = [...risk.reasons, ...trivialFailures];

	if (isPawRiskAtLeast(risk.riskLevel, "R3") || input.securityPath === true) {
		reasons.push(`${risk.riskLevel} risk requires high-risk routing`);
		return {
			taskClass: "high_risk",
			risk,
			reasons,
		};
	}

	if (trivialFailures.length === 0) {
		return {
			taskClass: "trivial",
			risk,
			reasons,
		};
	}

	return {
		taskClass: "standard",
		risk,
		reasons,
	};
}

function getTrivialRequirementFailures(
	input: PawRiskScoringInput,
	riskLevel: PawRiskLevel,
	config: PawRiskClassifierConfig,
): string[] {
	const failures: string[] = [];

	if (input.changedFileCount > config.max_files) {
		failures.push(`changed file count exceeds trivial max_files=${config.max_files}`);
	}

	if (input.crossLayer === true && config.cross_layer === false) {
		failures.push("cross-layer work violates trivial cross_layer=false");
	}

	if (comparePawRiskLevels(riskLevel, config.max_risk_level) > 0) {
		failures.push(`risk level exceeds trivial max_risk_level=${config.max_risk_level}`);
	}

	if (input.securityPath === true && config.security_path === false) {
		failures.push("security path violates trivial security_path=false");
	}

	return failures;
}
