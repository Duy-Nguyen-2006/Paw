import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

export interface PawNativeVerificationPlanOptions {
	repoRoot?: string;
}

export function createPawNativeVerificationPlan(
	gates: readonly string[],
	options: PawNativeVerificationPlanOptions = {},
): PawNativeVerificationPlanEntry[] {
	const packageScripts = readPackageScripts(options.repoRoot);
	return gates.map((gate) => {
		const command = resolveNativeVerificationCommand(gate, packageScripts, options.repoRoot);
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
			reason: `Native verification command will execute through the native subprocess runner: ${formatCommand(command)}.`,
		};
	});
}

function resolveNativeVerificationCommand(
	gate: string,
	packageScripts: ReadonlySet<string> | null,
	repoRoot: string | undefined,
): readonly string[] | undefined {
	if (repoRoot === undefined) {
		return NATIVE_VERIFICATION_COMMANDS[gate];
	}
	if (gate === "tsc") {
		return npmScriptOrFallback(
			packageScripts,
			["check", "typecheck", "tsc"],
			createGenericSyntaxCheckCommand(repoRoot),
		);
	}
	if (gate === "eslint_ruff") {
		return npmScriptOrFallback(packageScripts, ["lint", "check"], createGenericSyntaxCheckCommand(repoRoot));
	}
	if (gate === "unit_tests") {
		if (existsSync(join(repoRoot, "test.sh"))) {
			return ["./test.sh"];
		}
		return npmScriptOrFallback(packageScripts, ["test", "test:paw"], createGenericSyntaxCheckCommand(repoRoot));
	}
	if (gate === "build") {
		return npmScriptOrFallback(packageScripts, ["build"], createGenericSyntaxCheckCommand(repoRoot));
	}
	if (gate === "a11y_lint_light") {
		return npmScriptOrFallback(
			packageScripts,
			["check:browser-smoke", "lint", "check"],
			createGenericSyntaxCheckCommand(repoRoot),
		);
	}
	return NATIVE_VERIFICATION_COMMANDS[gate];
}

function npmScriptOrFallback(
	packageScripts: ReadonlySet<string> | null,
	names: readonly string[],
	fallback: readonly string[],
): readonly string[] {
	const scriptName = names.find((name) => packageScripts?.has(name));
	if (scriptName !== undefined) {
		return ["npm", "run", scriptName];
	}
	return fallback;
}

function readPackageScripts(repoRoot: string | undefined): ReadonlySet<string> | null {
	if (repoRoot === undefined) {
		return null;
	}
	const packageJsonPath = join(repoRoot, "package.json");
	if (!existsSync(packageJsonPath)) {
		return null;
	}
	try {
		const parsed = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { scripts?: Record<string, unknown> };
		return new Set(
			Object.entries(parsed.scripts ?? {})
				.filter(([, value]) => typeof value === "string")
				.map(([key]) => key),
		);
	} catch {
		return null;
	}
}

function createGenericSyntaxCheckCommand(repoRoot: string): readonly string[] {
	if (existsSync(join(repoRoot, "requirements.txt")) || existsSync(join(repoRoot, "pyproject.toml"))) {
		return ["python3", "-m", "compileall", "."];
	}
	return createNodeSyntaxCheckCommand();
}

function createNodeSyntaxCheckCommand(): readonly string[] {
	return [
		"node",
		"-e",
		[
			"const {spawnSync}=require('node:child_process');",
			"const {readdirSync,statSync}=require('node:fs');",
			"const {join}=require('node:path');",
			"const skip=new Set(['.git','node_modules','.paw','dist','build','.next','coverage']);",
			"const files=[];",
			"function walk(d){for(const n of readdirSync(d)){if(skip.has(n))continue;const p=join(d,n);const s=statSync(p);if(s.isDirectory())walk(p);else if(/\\.(mjs|cjs|js)$/.test(n))files.push(p);}}",
			"walk(process.cwd());",
			"if(files.length===0){console.error('No JavaScript files available for native syntax check.');process.exit(78);}",
			"for(const f of files){const r=spawnSync(process.execPath,['--check',f],{stdio:'inherit'});if(r.status!==0)process.exit(r.status||1);}",
			"console.log('node syntax check passed for '+files.length+' file(s)');",
		].join(""),
	];
}

export function formatPawNativeVerificationCommand(command: readonly string[]): string {
	return formatCommand(command);
}

function formatCommand(command: readonly string[]): string {
	return command.join(" ");
}
