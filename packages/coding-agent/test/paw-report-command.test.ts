
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { main } from "../src/main.ts";
import { handlePawCommand } from "../src/paw/init-command.ts";
import {
	createPawReportCommandResult,
	createPawReportJsonCommandResult,
	formatPawReportCommandResult,
	formatPawReportJsonCommandResult,
} from "../src/paw/report-command.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");
const sourceConfigPath = join(repoRoot, "paw-spec", "config.yaml");
const tempRoots: string[] = [];

let originalCwd: string;
let originalExitCode: typeof process.exitCode;

async function createTempProject(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-report-command-"));
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

describe("Paw report command", () => {
	test("prints an existing final report summary without changing files", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "log").mockImplementation(() => {});

		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await mkdir(join(projectRoot, ".paw", "sessions", "session-1"), { recursive: true });
		await writeFile(
			join(projectRoot, ".paw", "sessions", "session-1", "summary.md"),
			"## Summary\n\nDone\n",
			"utf-8",
		);

		const result = await createPawReportCommandResult(projectRoot, "session-1");

		expect(result).toEqual({ status: "found", sessionId: "session-1", markdown: "## Summary\n\nDone\n" });
		expect(formatPawReportCommandResult(result)).toBe("## Summary\n\nDone\n");
		expect(await readFile(join(projectRoot, ".paw", "sessions", "session-1", "summary.md"), "utf-8")).toBe(
			"## Summary\n\nDone\n",
		);
	});

	test("reports missing .paw and missing summary without creating files", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);

		const missingProject = await createPawReportCommandResult(projectRoot, "session-1");
		expect(missingProject).toEqual({ status: "missing_project", pawDir: ".paw" });
		expect(formatPawReportCommandResult(missingProject)).toContain("Paw is not initialized");
		expect(existsSync(join(projectRoot, ".paw"))).toBe(false);

		vi.spyOn(console, "log").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		const missingReport = await createPawReportCommandResult(projectRoot, "session-1");
		expect(missingReport).toEqual({
			status: "missing_report",
			sessionId: "session-1",
			summaryFile: ".paw/sessions/session-1/summary.md",
		});
		expect(formatPawReportCommandResult(missingReport)).toContain("No final report found for session session-1");
	});

	test("routes paw report and validates command arguments", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await mkdir(join(projectRoot, ".paw", "sessions", "session-1"), { recursive: true });
		await writeFile(
			join(projectRoot, ".paw", "sessions", "session-1", "summary.md"),
			"## Summary\n\nDone\n",
			"utf-8",
		);
		await expect(handlePawCommand(["paw", "report", "session-1"])).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "report"])).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "report", "session-1", "extra"])).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "report", "--help"])).resolves.toBe(true);

		const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
		const stderr = errorSpy.mock.calls.map(([message]) => String(message)).join("\n");
		expect(stdout).toContain("## Summary\n\nDone");
		expect(stdout).toContain("pi paw report <session-id>");
		expect(stderr).toContain('Missing required session id for "paw report".');
		expect(stderr).toContain('Unknown option for "paw report": extra');
		expect(process.exitCode).toBe(1);
	});

	test("main routes paw report before normal agent runtime", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
			throw new Error(`process.exit(${code ?? ""})`);
		}) as typeof process.exit);

		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await mkdir(join(projectRoot, ".paw", "sessions", "session-1"), { recursive: true });
		await writeFile(
			join(projectRoot, ".paw", "sessions", "session-1", "summary.md"),
			"## Summary\n\nDone\n",
			"utf-8",
		);

		await expect(main(["paw", "report", "session-1"])).resolves.toBeUndefined();

		expect(process.exitCode).toBeUndefined();
	});
});

describe("Paw report --json command", () => {
	test("reads and returns an existing JSON report artifact", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);

		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await mkdir(join(projectRoot, ".paw", "sessions", "session-1"), { recursive: true });
		const reportJson = JSON.stringify(
			{
				session_id: "session-1",
				summary: "Done",
				status: "done",
				evidence: [],
				risks: [],
				verified_gates: [],
				unverified_gates: [],
				degraded_steps: [],
				next_actions: [],
				native_verification_run_results: [],
			},
			null,
			2,
		);
		await writeFile(join(projectRoot, ".paw", "sessions", "session-1", "report.json"), reportJson, "utf-8");

		const result = await createPawReportJsonCommandResult(projectRoot, "session-1");

		expect(result.status).toBe("found_json");
		if (result.status !== "found_json") return;
		expect(result.sessionId).toBe("session-1");
		expect(result.reportJson).toBe(reportJson);
		expect(formatPawReportJsonCommandResult(result)).toBe(result.reportJson);
	});

	test("returns missing_report_json when report.json is absent", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);

		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await mkdir(join(projectRoot, ".paw", "sessions", "session-1"), { recursive: true });
		await writeFile(
			join(projectRoot, ".paw", "sessions", "session-1", "summary.md"),
			"## Summary\n\nDone\n",
			"utf-8",
		);

		const result = await createPawReportJsonCommandResult(projectRoot, "session-1");

		expect(result).toEqual({
			status: "missing_report_json",
			sessionId: "session-1",
			reportJsonFile: ".paw/sessions/session-1/report.json",
		});
		expect(formatPawReportJsonCommandResult(result)).toBe(
			"No final report JSON artifact found for session session-1 at .paw/sessions/session-1/report.json. Run the task to completion first.",
		);
	});

	test("returns missing_project for uninitialized project with --json", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);

		const result = await createPawReportJsonCommandResult(projectRoot, "session-1");

		expect(result).toEqual({ status: "missing_project", pawDir: ".paw" });
		expect(formatPawReportJsonCommandResult(result)).toContain("Paw is not initialized");
	});

	test("runPawReportCommand handles --json flag and validates arguments", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		await mkdir(join(projectRoot, ".paw", "sessions", "session-1"), { recursive: true });
		const reportJson = JSON.stringify(
			{
				session_id: "session-1",
				summary: "Done",
				status: "done",
				evidence: [],
				risks: [],
				verified_gates: [],
				unverified_gates: [],
				degraded_steps: [],
				next_actions: [],
				native_verification_run_results: [],
			},
			null,
			2,
		);
		await writeFile(join(projectRoot, ".paw", "sessions", "session-1", "report.json"), reportJson, "utf-8");

		await expect(handlePawCommand(["paw", "report", "session-1", "--json"])).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "report", "--json"])).resolves.toBe(true);
		await expect(handlePawCommand(["paw", "report", "session-1", "--json", "extra"])).resolves.toBe(true);

		const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
		const stderr = errorSpy.mock.calls.map(([message]) => String(message)).join("\n");
		expect(stdout).toContain('"session_id": "session-1"');
		expect(stderr).toContain('Missing required session id for "paw report".');
		expect(stderr).toContain('Unknown option for "paw report": extra');
		expect(process.exitCode).toBe(1);
	});

	test("help text includes --json option", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await expect(handlePawCommand(["paw", "report", "--help"])).resolves.toBe(true);

		const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
		expect(stdout).toContain("--json");
		expect(stdout).toContain("paw report <session-id> --json");
	});
});
