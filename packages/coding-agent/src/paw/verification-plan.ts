
export type PawNativeVerificationGateStatus = "planned" | "unsupported";

export type PawNativeVerificationPlanEntry =
	| {
			status: "planned";
			gate: string;
			command: readonly string[];
			executed: false;
			reason: string;
	  }
	| {
			status: "unsupported";
			gate: string;
			executed: false;
			reason: string;
	  };

const NATIVE_VERIFICATION_COMMANDS: Readonly<Record<string, readonly string[]>> = {
	working_tree_baseline: ["git", "status", "--short"],
	dep_diff: ["git", "diff", "--", "package.json", "package-lock.json", "packages/coding-agent/npm-shrinkwrap.json"],
	tsc: ["npm", "run", "check"],
	eslint_ruff: ["npm", "run", "check"],
	unit_tests: ["./test.sh"],
	build: ["npm", "run", "build"],
	reviewer_diff: ["git", "diff", "--check"],
	a11y_lint_light: ["npm", "run", "check:browser-smoke"],
};

export function createPawNativeVerificationPlan(gates: readonly string[]): PawNativeVerificationPlanEntry[] {
	return gates.map((gate) => {
		const command = NATIVE_VERIFICATION_COMMANDS[gate];
		if (command === undefined) {
			return {
				status: "unsupported",
				gate,
				executed: false,
				reason: `No native command mapping is defined for verification gate ${gate}.`,
			};
		}

		return {
			status: "planned",
			gate,
			command,
			executed: false,
			reason: `Native verification command is planned but not executed in this foundation slice: ${formatCommand(command)}.`,
		};
	});
}

export function formatPawNativeVerificationCommand(command: readonly string[]): string {
	return formatCommand(command);
}

function formatCommand(command: readonly string[]): string {
	return command.join(" ");
}
