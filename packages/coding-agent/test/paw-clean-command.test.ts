
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { main } from "../src/main.ts";
import { createPawCleanDryRunReport, formatPawCleanDryRunReport } from "../src/paw/clean-command.ts";
import { handlePawCommand } from "../src/paw/init-command.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");
const sourceConfigPath = join(repoRoot, "paw-spec", "config.yaml");
const tempRoots: string[] = [];

let originalCwd: string;
let originalExitCode: typeof process.exitCode;

async function createTempProject(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-clean-command-"));
	tempRoots.push(root);
	await mkdir(join(root, "paw-spec"), { recursive: true });
	await writeFile(join(root, "paw-spec", "config.yaml"), await readFile(sourceConfigPath, "utf-8"), "utf-8");
	return root;
}

async function touchDirectory(path: string, isoTimestamp: string): Promise<void> {
	const date = new Date(isoTimestamp);
	await utimes(path, date, date);
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

describe("Paw clean command", () => {
	test("dry-run reports zero candidates when .paw is missing without creating files", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await expect(handlePawCommand(["paw", "clean", "--dry-run"])).resolves.toBe(true);

		const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
		expect(stdout).toContain("Paw clean dry-run");
		expect(stdout).toContain(".paw path: .paw");
		expect(stdout).toContain("candidates: 0 sessions, 0 artifacts");
		expect(stdout).toContain("No files were deleted.");
		expect(existsSync(join(projectRoot, ".paw"))).toBe(false);
		expect(process.exitCode).toBeUndefined();
	});

	test("dry-run scans sessions and artifacts and formats retention removal reasons", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		vi.spyOn(console, "log").mockImplementation(() => {});

		await expect(handlePawCommand(["paw", "init"])).resolves.toBe(true);
		const oldSession = join(projectRoot, ".paw", "sessions", "old-session");
		const newSession = join(projectRoot, ".paw", "sessions", "new-session");
		const oldArtifact = join(projectRoot, ".paw", "artifacts", "old-artifact");
		const newArtifact = join(projectRoot, ".paw", "artifacts", "new-artifact");
		await mkdir(oldSession, { recursive: true });
		await mkdir(newSession, { recursive: true });
		await mkdir(oldArtifact, { recursive: true });
		await mkdir(newArtifact, { recursive: true });
		await touchDirectory(oldSession, "2026-06-01T00:00:00.000Z");
		await touchDirectory(newSession, "2026-06-16T00:00:00.000Z");
		await touchDirectory(oldArtifact, "2026-06-01T00:00:00.000Z");
		await touchDirectory(newArtifact, "2026-06-15T00:00:00.000Z");
		const config = await readFile(join(projectRoot, "paw-spec", "config.yaml"), "utf-8");
		await writeFile(
			join(projectRoot, "paw-spec", "config.yaml"),
			config.replace("keep_last_sessions: 20", "keep_last_sessions: 1"),
			"utf-8",
		);

		const report = await createPawCleanDryRunReport(projectRoot, new Date("2026-06-16T00:00:00.000Z"));
		const formatted = formatPawCleanDryRunReport(report);

		expect(report.sessionCandidateCount).toBe(2);
		expect(report.artifactCandidateCount).toBe(2);
		expect(report.plan.keep_sessions.map((record) => record.session_id)).toEqual(["new-session"]);
		expect(report.plan.remove_sessions).toEqual([
			{
				kind: "session",
				id: "old-session",
				path: ".paw/sessions/old-session",
				reason: "exceeds keep_last_sessions=1",
			},
		]);
		expect(report.plan.keep_artifacts.map((record) => record.artifact_name)).toEqual(["new-artifact"]);
		expect(report.plan.remove_artifacts).toEqual([
			{
				kind: "artifact",
				id: "old-artifact",
				path: ".paw/artifacts/old-artifact",
				reason: "older than artifact_days=7",
			},
		]);
		expect(formatted).toContain("sessions: keep 1, remove 1");
		expect(formatted).toContain("remove old-session (.paw/sessions/old-session): exceeds keep_last_sessions=1");
		expect(formatted).toContain("artifacts: keep 1, remove 1");
		expect(formatted).toContain("remove old-artifact (.paw/artifacts/old-artifact): older than artifact_days=7");
		expect(formatted).toContain("No files were deleted.");
	});

	test("bare clean is rejected without deleting", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await expect(handlePawCommand(["paw", "clean"])).resolves.toBe(true);

		const stderr = errorSpy.mock.calls.map(([message]) => String(message)).join("\n");
		expect(stderr).toContain('Only "paw clean --dry-run" is implemented; no files were deleted.');
		expect(process.exitCode).toBe(1);
	});

	test("shows clean help without creating .paw", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await expect(handlePawCommand(["paw", "clean", "--help"])).resolves.toBe(true);

		const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
		expect(stdout).toContain("pi paw clean --dry-run");
		expect(stdout).toContain("read-only Paw retention plan");
		expect(existsSync(join(projectRoot, ".paw"))).toBe(false);
		expect(process.exitCode).toBeUndefined();
	});

	test("main routes paw clean dry-run before normal agent runtime", async () => {
		const projectRoot = await createTempProject();
		process.chdir(projectRoot);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
			throw new Error(`process.exit(${code ?? ""})`);
		}) as typeof process.exit);

		await expect(main(["paw", "clean", "--dry-run"])).resolves.toBeUndefined();

		const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
		expect(stdout).toContain("Paw clean dry-run");
		expect(stdout).toContain("candidates: 0 sessions, 0 artifacts");
		expect(existsSync(join(projectRoot, ".paw"))).toBe(false);
		expect(process.exitCode).toBeUndefined();
	});
});
