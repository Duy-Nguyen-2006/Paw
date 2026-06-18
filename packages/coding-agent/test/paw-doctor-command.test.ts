
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { main } from "../src/main.ts";
import { createPawDoctorReport, formatPawDoctorReport } from "../src/paw/doctor-command.ts";
import { loadDefaultPawRuntimeConfig } from "../src/paw/index.ts";
import { handlePawCommand } from "../src/paw/init-command.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");
const sourceConfigPath = join(repoRoot, "paw-spec", "config.yaml");
const tempRoots: string[] = [];

let originalCwd: string;
let originalExitCode: typeof process.exitCode;

async function createTempProject(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-doctor-command-"));
	tempRoots.push(root);
	await mkdir(join(root, "paw-spec"), { recursive: true });
	await writeFile(join(root, "paw-spec", "config.yaml"), await readFile(sourceConfigPath, "utf-8"), "utf-8");
	return root;
}

beforeEach(() => {
	originalCwd = process.cwd();
	originalExitCode = process.exitCode;
	process.exitCode = undefined;
});

afterEach(async () => {
	vi.restoreAllMocks();
	process.chdir(originalCwd);
	process.exitCode = originalExitCode;
	await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Paw doctor command", () => {
	test("formats an available sandbox report from injected probe facts", () => {
		const config = loadDefaultPawRuntimeConfig(repoRoot);
		const report = createPawDoctorReport({
			config,
			probeFacts: {
				bubblewrapAvailable: true,
				landlockAvailable: true,
				userNamespacesAvailable: true,
				distro: { name: "Fedora", version: "41" },
			},
		});

		expect(report).toMatchObject({
			status: "available",
			detectedPrimitives: ["bubblewrap_landlock", "bubblewrap_only", "userns_only"],
			warnings: [],
			remediation: [],
			egressAllowlist: ["provider_hosts", "package_registries", "localhost"],
		});
		expect(formatPawDoctorReport(report)).toContain("sandbox status: available");
		expect(formatPawDoctorReport(report)).toContain(
			"detected primitives: bubblewrap_landlock, bubblewrap_only, userns_only",
		);
		expect(formatPawDoctorReport(report)).toContain("warnings: none");
	});

	test("formats reduced and unavailable reports with warnings and remediation", () => {
		const config = loadDefaultPawRuntimeConfig(repoRoot);
		const reduced = createPawDoctorReport({
			config,
			probeFacts: {
				bubblewrapAvailable: true,
				landlockAvailable: false,
				userNamespacesAvailable: true,
			},
		});
		const unavailable = createPawDoctorReport({
			config,
			probeFacts: {
				bubblewrapAvailable: false,
				landlockAvailable: false,
				userNamespacesAvailable: false,
				distro: { name: "Ubuntu", version: "24.04" },
			},
		});

		expect(reduced.status).toBe("reduced");
		expect(formatPawDoctorReport(reduced)).toContain(
			"warning: Landlock is unavailable; Paw will fall back from bubblewrap+Landlock.",
		);
		expect(unavailable.status).toBe("unavailable");
		expect(formatPawDoctorReport(unavailable)).toContain("detected primitives: none");
		expect(formatPawDoctorReport(unavailable)).toContain(
			"remediation: Enable unprivileged user namespaces or run Paw in read-only mode.",
		);
		expect(formatPawDoctorReport(unavailable)).toContain(
			"remediation: On Linux systems that support it, enable unprivileged user namespaces with: sudo sysctl kernel.unprivileged_userns_clone=1",
		);
	});

	test("shows doctor help without loading config or creating .paw", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await expect(handlePawCommand(["paw", "doctor", "--help"])).resolves.toBe(true);

		const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
		expect(stdout).toContain("pi paw doctor");
		expect(stdout).toContain("read-only sandbox diagnostics");
		expect(existsSync(join(projectRoot, ".paw"))).toBe(false);
		expect(process.exitCode).toBeUndefined();
	});

	test("reports unknown doctor options without throwing", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await expect(handlePawCommand(["paw", "doctor", "--json"])).resolves.toBe(true);

		const stderr = errorSpy.mock.calls.map(([message]) => String(message)).join("\n");
		expect(stderr).toContain('Unknown option for "paw doctor": --json');
		expect(process.exitCode).toBe(1);
	});

	test("main routes paw doctor before normal agent runtime", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
			throw new Error(`process.exit(${code ?? ""})`);
		}) as typeof process.exit);

		await expect(main(["paw", "doctor"])).resolves.toBeUndefined();

		const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
		expect(stdout).toContain("Paw doctor sandbox report");
		expect(stdout).toContain("sandbox status:");
		expect(stdout).toContain("egress allowlist: provider_hosts, package_registries, localhost");
		expect(existsSync(join(projectRoot, ".paw"))).toBe(false);
		expect(process.exitCode).toBeUndefined();
	});
});
