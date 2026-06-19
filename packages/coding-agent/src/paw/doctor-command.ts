import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { APP_NAME } from "../config.ts";
import type { PawRuntimeConfig } from "./contracts.ts";
import {
	detectPawSandboxPrimitives,
	type PawSandboxDetectionStatus,
	type PawSandboxPrimitiveName,
	type PawSandboxProbeFacts,
} from "./sandbox-detector.ts";

export type PawDoctorReport = {
	status: PawSandboxDetectionStatus;
	detectedPrimitives: readonly PawSandboxPrimitiveName[];
	warnings: readonly string[];
	remediation: readonly string[];
	egressAllowlist: readonly string[];
	evidence: string;
	probeNote: string;
	fixSuggestions: readonly PawDoctorFixSuggestion[];
};

export type PawDoctorReportInput = {
	config: PawRuntimeConfig;
	probeFacts: PawSandboxProbeFacts;
	includeFixSuggestions?: boolean;
};

export interface PawDoctorFixSuggestion {
	area: string;
	issue: string;
	command: string;
	manualSteps: string;
	severity: "info" | "warn" | "block";
}

export function createPawDoctorReport(input: PawDoctorReportInput): PawDoctorReport {
	const detection = detectPawSandboxPrimitives(input.probeFacts);
	const remediation = [...detection.remediation];

	if (!input.probeFacts.userNamespacesAvailable) {
		remediation.push(
			"On Linux systems that support it, enable unprivileged user namespaces with: sudo sysctl kernel.unprivileged_userns_clone=1",
		);
	}

	const fixSuggestions = input.includeFixSuggestions === true ? buildPawDoctorFixSuggestions(input) : [];

	return {
		status: detection.status,
		detectedPrimitives: detection.detectedPrimitives,
		warnings: detection.warnings,
		remediation,
		egressAllowlist: input.config.sandbox.egress_allowlist,
		evidence: detection.evidence,
		probeNote: "Live platform probing is read-only and is not complete cross-distro validation.",
		fixSuggestions,
	};
}

export function formatPawDoctorReport(report: PawDoctorReport): string {
	const lines = [
		"Paw doctor sandbox report",
		`sandbox status: ${report.status}`,
		`detected primitives: ${formatList(report.detectedPrimitives)}`,
	];

	if (report.warnings.length === 0) {
		lines.push("warnings: none");
	} else {
		lines.push(...report.warnings.map((warning) => `warning: ${warning}`));
	}

	if (report.remediation.length === 0) {
		lines.push("remediation: none");
	} else {
		lines.push(...report.remediation.map((remediation) => `remediation: ${remediation}`));
	}

	if (report.fixSuggestions.length > 0) {
		lines.push("fix suggestions:");
		for (const suggestion of report.fixSuggestions) {
			lines.push(`  [${suggestion.severity}] ${suggestion.area}: ${suggestion.issue}`);
			lines.push(`    command: ${suggestion.command}`);
			lines.push(`    manual: ${suggestion.manualSteps}`);
		}
	}

	lines.push(
		`egress allowlist: ${formatList(report.egressAllowlist)}`,
		`evidence: ${report.evidence}`,
		`note: ${report.probeNote}`,
	);
	return lines.join("\n");
}

export async function runPawDoctorCommand(args: string[], loadConfig: () => PawRuntimeConfig): Promise<void> {
	if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
		printPawDoctorHelp();
		return;
	}

	const fixSuggestions = args.includes("--fix-suggestions");
	const filtered = args.filter((arg) => arg !== "--fix-suggestions");

	if (filtered.length > 0) {
		printPawDoctorCommandError(`Unknown option for "paw doctor": ${filtered[0]}`);
		return;
	}

	const config = loadConfig();
	const report = createPawDoctorReport({
		config,
		probeFacts: collectPawSandboxProbeFacts(),
		includeFixSuggestions: fixSuggestions,
	});
	console.log(formatPawDoctorReport(report));
}

function collectPawSandboxProbeFacts(): PawSandboxProbeFacts {
	return {
		bubblewrapAvailable: isExecutableOnPath("bwrap"),
		landlockAvailable: existsSync("/sys/kernel/security/landlock"),
		userNamespacesAvailable: readUserNamespacesAvailable(),
		distro: readDistroFacts(),
	};
}

function isExecutableOnPath(name: string): boolean {
	const pathValue = process.env.PATH ?? "";
	return pathValue.split(delimiter).some((pathEntry) => {
		if (pathEntry === "") {
			return false;
		}

		try {
			accessSync(join(pathEntry, name), constants.X_OK);
			return true;
		} catch {
			return false;
		}
	});
}

function readUserNamespacesAvailable(): boolean {
	if (process.platform !== "linux") {
		return false;
	}

	try {
		return readFileSync("/proc/sys/kernel/unprivileged_userns_clone", "utf-8").trim() !== "0";
	} catch {
		return true;
	}
}

function readDistroFacts(): PawSandboxProbeFacts["distro"] {
	if (!existsSync("/etc/os-release")) {
		return undefined;
	}

	const fields = new Map<string, string>();
	for (const line of readFileSync("/etc/os-release", "utf-8").split("\n")) {
		const match = /^([A-Z_]+)=(.*)$/.exec(line);
		if (match === null) {
			continue;
		}
		fields.set(match[1], stripOsReleaseQuotes(match[2]));
	}

	const name = fields.get("NAME");
	if (name === undefined) {
		return undefined;
	}

	return {
		name,
		version: fields.get("VERSION_ID") ?? fields.get("VERSION"),
	};
}

function stripOsReleaseQuotes(value: string): string {
	if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
		return value.slice(1, -1);
	}
	return value;
}

function buildPawDoctorFixSuggestions(input: PawDoctorReportInput): PawDoctorFixSuggestion[] {
	const suggestions: PawDoctorFixSuggestion[] = [];
	if (!input.probeFacts.bubblewrapAvailable) {
		suggestions.push({
			area: "sandbox",
			issue: "bubblewrap (bwrap) is not on PATH",
			command: "sudo apt-get install -y bubblewrap   # or: sudo dnf install -y bubblewrap",
			manualSteps:
				"Install bubblewrap via your package manager, or set --no-sandbox-i-understand for trusted runs only.",
			severity: "warn",
		});
	}
	if (!input.probeFacts.landlockAvailable) {
		suggestions.push({
			area: "sandbox",
			issue: "Landlock kernel support is missing",
			command: "uname -r   # verify >= 5.13; upgrade kernel or use bwrap-only fallback",
			manualSteps:
				"Upgrade to a Linux kernel that exposes /sys/kernel/security/landlock, or rely on the bwrap-only fallback.",
			severity: "info",
		});
	}
	if (!input.probeFacts.userNamespacesAvailable) {
		suggestions.push({
			area: "sandbox",
			issue: "Unprivileged user namespaces are disabled",
			command: "sudo sysctl -w kernel.unprivileged_userns_clone=1",
			manualSteps: "Enable user namespaces or run with --no-sandbox-i-understand (unsafe override).",
			severity: "block",
		});
	}
	if (input.config.sandbox.network === "default_deny" && input.config.sandbox.egress_allowlist.length === 0) {
		suggestions.push({
			area: "network",
			issue: "default_deny network is active but egress_allowlist is empty",
			command: "paw doctor --help   # then add provider_hosts and package_registries to paw-spec/config.yaml",
			manualSteps: "Add at least provider_hosts and package_registries to sandbox.egress_allowlist.",
			severity: "warn",
		});
	}
	if (input.config.approval.default_mode !== "strict" && input.config.kpi.pr_hard_gates.length === 0) {
		suggestions.push({
			area: "kpi",
			issue: "PR hard gates are not configured",
			command:
				"add kpi.pr_hard_gates [schema_validation, redteam_injection, secret_leak, liveness_resume, budget_timeout_enforcement]",
			manualSteps: "Add PR hard gates to paw-spec/config.yaml under kpi.pr_hard_gates.",
			severity: "info",
		});
	}
	return suggestions;
}

function formatList(values: readonly string[]): string {
	return values.length === 0 ? "none" : values.join(", ");
}

function printPawDoctorHelp(): void {
	console.log(`Usage:
  ${APP_NAME} paw doctor [--fix-suggestions]

Print read-only sandbox diagnostics for Paw. Use --fix-suggestions to include actionable remediation steps.

Commands:
  ${APP_NAME} paw doctor                  Show read-only sandbox diagnostics
  ${APP_NAME} paw doctor --fix-suggestions Include actionable fix commands
  ${APP_NAME} paw doctor --help           Show this help
`);
}

function printPawDoctorCommandError(message: string): void {
	console.error(`Error: ${message}`);
	process.exitCode = 1;
}
