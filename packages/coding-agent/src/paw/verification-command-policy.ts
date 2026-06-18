
import type { PawNativeVerificationPlanEntry } from "./verification-plan.ts";
import type {
	PawNativeVerificationExecutor,
	PawNativeVerificationExecutorInput,
	PawNativeVerificationExecutorResult,
} from "./verification-runner.ts";

export type PawNativeVerificationCommandPolicy = {
	isAllowed(gate: string, command: readonly string[]): boolean;
};

function argvExactlyMatches(expected: readonly string[], actual: readonly string[]): boolean {
	if (expected.length !== actual.length) {
		return false;
	}
	for (let index = 0; index < expected.length; index++) {
		if (expected[index] !== actual[index]) {
			return false;
		}
	}
	return true;
}

export function createPawNativeVerificationCommandPolicy(
	plan: readonly PawNativeVerificationPlanEntry[],
): PawNativeVerificationCommandPolicy {
	const allowedEntries = new Map<string, readonly string[]>();
	for (const entry of plan) {
		if (entry.status === "planned") {
			allowedEntries.set(entry.gate, entry.command);
		}
	}

	return {
		isAllowed(gate: string, command: readonly string[]): boolean {
			const expectedCommand = allowedEntries.get(gate);
			if (expectedCommand === undefined) {
				return false;
			}
			return argvExactlyMatches(expectedCommand, command);
		},
	};
}

const POLICY_BLOCK_EXIT_CODE = 126;

export function createPawPolicyCheckedNativeVerificationExecutor(
	executor: PawNativeVerificationExecutor,
	policy: PawNativeVerificationCommandPolicy,
): PawNativeVerificationExecutor {
	return async (input: PawNativeVerificationExecutorInput): Promise<PawNativeVerificationExecutorResult> => {
		if (!policy.isAllowed(input.gate, input.command)) {
			return {
				exitCode: POLICY_BLOCK_EXIT_CODE,
				stdout: "",
				stderr: `Native verification command is not allowed by policy: gate=${input.gate} command=${input.command.join(" ")}`,
			};
		}
		return executor(input);
	};
}
