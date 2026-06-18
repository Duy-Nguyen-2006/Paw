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
};

export type PawDoctorReportInput = {
	config: PawRuntimeConfig;
	probeFacts: PawSandboxProbeFacts;
};

export function createPawDoctorReport(input: PawDoctorReportInput): PawDoctorReport {
	const detection = detectPawSandboxPrimitives(input.probeFacts);
	const remediation = [...detection.remediation];

	if (!input.probeFacts.userNamespacesAvailable) {
		remediation.push(
			"On Linux systems that support it, enable unprivileged user namespaces with: sudo sysctl kernel.unprivileged_userns_clone=1",
		);
	}

	return {
		status: detection.status,
		detectedPrimitives: detection.detectedPrimitives,
		warnings: detection.warnings,
		remediation,
		egressAllowlist: input.config.sandbox.egress_allowlist,
		evidence: detection.evidence,
		probeNote: "Live platform probing is read-only and is not complete cross-distro validation.",
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

	if (args.length > 0) {
		printPawDoctorCommandError(`Unknown option for "paw doctor": ${args[0]}`);
		return;
	}

	const config = loadConfig();
	const report = createPawDoctorReport({
		config,
		probeFacts: collectPawSandboxProbeFacts(),
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

function formatList(values: readonly string[]): string {
	return values.length === 0 ? "none" : values.join(", ");
}

function printPawDoctorHelp(): void {
	console.log(`Usage:
  ${APP_NAME} paw doctor

Print read-only sandbox diagnostics for Paw.

Commands:
  ${APP_NAME} paw doctor        Show read-only sandbox diagnostics
  ${APP_NAME} paw doctor --help Show this help
`);
}

function printPawDoctorCommandError(message: string): void {
	console.error(`Error: ${message}`);
	process.exitCode = 1;
}
