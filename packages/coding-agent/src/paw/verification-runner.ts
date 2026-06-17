import type { PawNativeVerificationPlanEntry } from "./verification-plan.ts";

export type PawNativeVerificationExecutorInput = {
	gate: string;
	command: readonly string[];
	timeoutSec: number;
};

export type PawNativeVerificationExecutorResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
	timedOut?: boolean;
};

export type PawNativeVerificationExecutor = (
	input: PawNativeVerificationExecutorInput,
) => Promise<PawNativeVerificationExecutorResult>;

export type PawNativeVerificationRunOptions = {
	timeoutSec: number;
	outputMaxChars: number;
};

export type PawNativeVerificationRunResult =
	| {
			status: "verified";
			gate: string;
			verified: true;
			executed: true;
			command: readonly string[];
			exitCode: number;
			stdout: string;
			stderr: string;
	  }
	| {
			status: "unverified";
			gate: string;
			verified: false;
			executed: boolean;
			command?: readonly string[];
			exitCode?: number;
			stdout?: string;
			stderr?: string;
			reason: string;
	  };

export async function runPawNativeVerificationPlan(
	plan: readonly PawNativeVerificationPlanEntry[],
	executor: PawNativeVerificationExecutor,
	options: PawNativeVerificationRunOptions,
): Promise<PawNativeVerificationRunResult[]> {
	const results: PawNativeVerificationRunResult[] = [];
	for (const entry of plan) {
		if (entry.status === "unsupported") {
			results.push({
				status: "unverified",
				gate: entry.gate,
				verified: false,
				executed: false,
				reason: entry.reason,
			});
			continue;
		}

		const execution = await executor({
			gate: entry.gate,
			command: entry.command,
			timeoutSec: options.timeoutSec,
		});
		const stdout = summarizeNativeVerificationOutput(execution.stdout, options.outputMaxChars);
		const stderr = summarizeNativeVerificationOutput(execution.stderr, options.outputMaxChars);

		if (execution.timedOut === true) {
			results.push({
				status: "unverified",
				gate: entry.gate,
				verified: false,
				executed: true,
				command: entry.command,
				exitCode: execution.exitCode,
				stdout,
				stderr,
				reason: `Native verification command timed out after ${options.timeoutSec} seconds.`,
			});
			continue;
		}

		if (execution.exitCode === 0) {
			results.push({
				status: "verified",
				gate: entry.gate,
				verified: true,
				executed: true,
				command: entry.command,
				exitCode: execution.exitCode,
				stdout,
				stderr,
			});
			continue;
		}

		results.push({
			status: "unverified",
			gate: entry.gate,
			verified: false,
			executed: true,
			command: entry.command,
			exitCode: execution.exitCode,
			stdout,
			stderr,
			reason: `Native verification command failed with exit code ${execution.exitCode}: ${firstNonEmpty(stdout, stderr, "no output")}`,
		});
	}
	return results;
}

export function summarizeNativeVerificationOutput(output: string, maxChars: number): string {
	if (output.length <= maxChars) {
		return output;
	}

	if (maxChars <= 3) {
		return output.slice(0, maxChars);
	}

	return `${output.slice(0, maxChars - 3)}...`;
}

function firstNonEmpty(first: string, second: string, fallback: string): string {
	if (first.length > 0) {
		return first;
	}
	if (second.length > 0) {
		return second;
	}
	return fallback;
}
