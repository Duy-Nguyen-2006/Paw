
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { main } from "../src/main.ts";
import { handlePawCommand } from "../src/paw/init-command.ts";
import { createPawStatusReport, formatPawStatusReport } from "../src/paw/status-command.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");
const sourceConfigPath = join(repoRoot, "paw-spec", "config.yaml");
const tempRoots: string[] = [];

let originalCwd: string;
let originalExitCode: typeof process.exitCode;

async function createTempProject(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-status-command-"));
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

describe("Paw status command", () => {
	test("reports missing .paw without creating project files", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await expect(handlePawCommand(["paw", "status"])).resolves.toBe(true);

		const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
		expect(stdout).toContain("Paw status");
		expect(stdout).toContain(".paw path: .paw");
		expect(stdout).toContain("initialized: no");
		expect(stdout).toContain("Paw is not initialized. Run `pi paw init`.");
		expect(existsSync(join(projectRoot, ".paw"))).toBe(false);
		expect(process.exitCode).toBeUndefined();
	});

	test("reports initialized project with no sessions", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "log").mockImplementation(() => {});

		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		const report = await createPawStatusReport(projectRoot);

		expect(report).toMatchObject({
			initialized: true,
			sessionDirectoryCount: 0,
			invalidSessionCount: 0,
		});
		expect(report.config.status).toBe("ok");
		expect(report.version.status).toBe("present");
		expect(formatPawStatusReport(report)).toContain("sessions: 0");
		expect(formatPawStatusReport(report)).toContain("state counts: none");
		expect(formatPawStatusReport(report)).not.toContain("invalid sessions:");
	});

	test("counts valid session states and invalid session state files", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "log").mockImplementation(() => {});
		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);

		await mkdir(join(projectRoot, ".paw", "sessions", "session-idle"), { recursive: true });
		await writeFile(
			join(projectRoot, ".paw", "sessions", "session-idle", "state.json"),
			JSON.stringify(
				{
					session_id: "session-idle",
					name: "IDLE",
					current_slice_id: null,
					pending_slice_ids: [],
					completed_slice_ids: [],
					blocked_reason: null,
				},
				null,
				"\t",
			),
			"utf-8",
		);
		await mkdir(join(projectRoot, ".paw", "sessions", "session-reviewing"), { recursive: true });
		await writeFile(
			join(projectRoot, ".paw", "sessions", "session-reviewing", "state.json"),
			JSON.stringify(
				{
					session_id: "session-reviewing",
					name: "REVIEWING",
					current_slice_id: "slice-1",
					pending_slice_ids: [],
					completed_slice_ids: [],
					blocked_reason: null,
				},
				null,
				"\t",
			),
			"utf-8",
		);
		await mkdir(join(projectRoot, ".paw", "sessions", "session-invalid"), { recursive: true });
		await writeFile(join(projectRoot, ".paw", "sessions", "session-invalid", "state.json"), "{", "utf-8");

		const report = await createPawStatusReport(projectRoot);
		const formatted = formatPawStatusReport(report);

		expect(report.sessionDirectoryCount).toBe(3);
		expect(report.stateCounts).toEqual({ IDLE: 1, REVIEWING: 1 });
		expect(report.invalidSessionCount).toBe(1);
		expect(formatted).toContain("sessions: 3");
		expect(formatted).toContain("state IDLE: 1");
		expect(formatted).toContain("state REVIEWING: 1");
		expect(formatted).toContain("invalid sessions: 1");
	});

	test("shows status help without creating .paw", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await expect(handlePawCommand(["paw", "status", "--help"])).resolves.toBe(true);

		const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
		expect(stdout).toContain("pi paw status");
		expect(stdout).toContain("read-only Paw project and session summary");
		expect(existsSync(join(projectRoot, ".paw"))).toBe(false);
		expect(process.exitCode).toBeUndefined();
	});

	test("reports unknown status options without throwing", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await expect(handlePawCommand(["paw", "status", "--json"])).resolves.toBe(true);

		const stderr = errorSpy.mock.calls.map(([message]) => String(message)).join("\n");
		expect(stderr).toContain('Unknown option for "paw status": --json');
		expect(process.exitCode).toBe(1);
	});

	test("main routes paw status before normal agent runtime", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
			throw new Error(`process.exit(${code ?? ""})`);
		}) as typeof process.exit);

		await expect(main(["paw", "status"])).resolves.toBeUndefined();

		const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
		expect(stdout).toContain("Paw status");
		expect(stdout).toContain("initialized: no");
		expect(existsSync(join(projectRoot, ".paw"))).toBe(false);
		expect(process.exitCode).toBeUndefined();
	});
});
