
import type { PawRuntimeConfig } from "./contracts.ts";

export type PawEditPolicyConfig = PawRuntimeConfig["edit"];
export type PawEditMethod = "diff" | "fuzzy_diff" | "full_file" | "noop" | "blocked";
export type PawEditApplyMethod = "diff" | "fuzzy_diff" | "full_file";
export type PawEditBlockCode = "PATCH_APPLY_FAILED";

export type PawNextEditAttemptInput = {
	config: PawEditPolicyConfig;
	previousMethod?: PawEditApplyMethod;
	failedAttempts: number;
	fileLineCount: number;
	failingHunk?: string;
};

export type PawNextEditAttemptDecision =
	| {
			status: "apply";
			method: PawEditApplyMethod;
			message: string;
	  }
	| {
			status: "blocked";
			method: "blocked";
			code: PawEditBlockCode;
			message: string;
			suggestedAction: string;
			fileLineCount: number;
			maxFullFileRewriteLines: number;
			failingHunk?: string;
	  };

export type PawEditIdempotencyInput = {
	currentHash: string;
	expectedBaseHash: string;
	expectedResultHash: string;
};

export type PawEditIdempotencyDecision =
	| {
			status: "apply";
			message: string;
	  }
	| {
			status: "noop";
			method: "noop";
			message: string;
	  }
	| {
			status: "rederive";
			message: string;
			suggestedAction: string;
	  };

export function evaluatePawNextEditAttempt(input: PawNextEditAttemptInput): PawNextEditAttemptDecision {
	if (input.previousMethod === undefined) {
		return {
			status: "apply",
			method: "diff",
			message: `Apply a diff patch first because edit strategy is ${input.config.strategy}.`,
		};
	}

	if (input.previousMethod === "diff") {
		if (input.config.fuzzy_apply_retries > 0) {
			return {
				status: "apply",
				method: "fuzzy_diff",
				message: `Diff patch failed; try fuzzy diff attempt 1 of ${input.config.fuzzy_apply_retries}.`,
			};
		}

		return evaluateFullFileOrBlocked(input, "Diff patch failed and fuzzy retries are disabled.");
	}

	if (input.previousMethod === "fuzzy_diff") {
		if (input.failedAttempts < input.config.fuzzy_apply_retries) {
			return {
				status: "apply",
				method: "fuzzy_diff",
				message: `Fuzzy diff failed; retry fuzzy diff attempt ${input.failedAttempts + 1} of ${input.config.fuzzy_apply_retries}.`,
			};
		}

		return evaluateFullFileOrBlocked(input, "Fuzzy diff retries are exhausted.");
	}

	return blockedPatchApplyFailed(input, "Full-file rewrite failed.");
}

export function evaluatePawEditIdempotency(input: PawEditIdempotencyInput): PawEditIdempotencyDecision {
	if (input.currentHash === input.expectedResultHash) {
		return {
			status: "noop",
			method: "noop",
			message: "Current file hash already matches the expected result hash; skip the edit.",
		};
	}

	if (input.currentHash !== input.expectedBaseHash) {
		return {
			status: "rederive",
			message: "Current file hash differs from the expected base hash.",
			suggestedAction: "Re-derive the patch against the current file or block with PATCH_APPLY_FAILED.",
		};
	}

	return {
		status: "apply",
		message: "Current file hash matches the expected base hash; apply the edit attempt.",
	};
}

function evaluateFullFileOrBlocked(input: PawNextEditAttemptInput, reason: string): PawNextEditAttemptDecision {
	if (input.fileLineCount <= input.config.full_file_rewrite_max_lines) {
		return {
			status: "apply",
			method: "full_file",
			message: `${reason} File has ${input.fileLineCount} lines, within the ${input.config.full_file_rewrite_max_lines}-line full-file rewrite limit.`,
		};
	}

	return blockedPatchApplyFailed(input, reason);
}

function blockedPatchApplyFailed(input: PawNextEditAttemptInput, reason: string): PawNextEditAttemptDecision {
	const sizeMessage =
		input.fileLineCount > input.config.full_file_rewrite_max_lines
			? `File has ${input.fileLineCount} lines, above the ${input.config.full_file_rewrite_max_lines}-line full-file rewrite limit.`
			: `No edit fallback remains for a ${input.fileLineCount}-line file.`;
	const decision: PawNextEditAttemptDecision = {
		status: "blocked",
		method: "blocked",
		code: "PATCH_APPLY_FAILED",
		message: `${reason} ${sizeMessage}`,
		suggestedAction:
			"Re-derive the patch against the current file, split the edit, or ask for explicit user direction.",
		fileLineCount: input.fileLineCount,
		maxFullFileRewriteLines: input.config.full_file_rewrite_max_lines,
	};

	if (input.failingHunk !== undefined) {
		return {
			...decision,
			failingHunk: input.failingHunk,
		};
	}

	return decision;
}
