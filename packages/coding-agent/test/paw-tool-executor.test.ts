
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { loadDefaultPawRuntimeConfig } from "../src/paw/config.ts";
import type { PawRuntimeConfig } from "../src/paw/contracts.ts";
import { createPawLocalSubprocessToolExecutor } from "../src/paw/tool-executor.ts";
import {
	executePawToolRuntimePlan,
	type PawToolExecutionAuthorization,
	type PawToolExecutionPlan,
	type PawToolExecutor,
} from "../src/paw/tool-runtime.ts";

const config: PawRuntimeConfig = loadDefaultPawRuntimeConfig(process.cwd());
const tempRoots: string[] = [];

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("createPawLocalSubprocessToolExecutor", () => {
	test("runs argv-only commands through executePawToolRuntimePlan after runtime gates pass", async () => {
		const cwd = await createTempRoot();
		const execution = await executePlanWithExecutor(
			planForPaths(["stdout.txt"]),
			createPawLocalSubprocessToolExecutor({
				cwd,
				argv: [process.execPath, "-e", "process.stdout.write(process.argv[1])", "hello argv"],
				timeoutSec: 10,
			}),
		);

		expect(execution).toMatchObject({
			status: "executed",
			executed: true,
			exitCode: 0,
			stdout: "hello argv",
			stderr: "",
			filesChanged: false,
		});
	});

	test("kills timed-out subprocesses and reports the timeout as executor failure", async () => {
		const cwd = await createTempRoot();
		const execution = await executePlanWithExecutor(
			planForPaths(["timeout.txt"]),
			createPawLocalSubprocessToolExecutor({
				cwd,
				argv: [process.execPath, "-e", "setTimeout(() => {}, 60000)"],
				timeoutSec: 0.2,
			}),
		);

		expect(execution).toMatchObject({
			status: "blocked",
			code: "EXECUTOR_FAILED",
			executed: true,
			exitCode: 124,
			filesChanged: false,
		});
		if (execution.status !== "blocked") return;
		expect(execution.stderr).toContain("timed out");
	});

	test("reports non-zero subprocess exits without hiding stdout or stderr", async () => {
		const cwd = await createTempRoot();
		const execution = await executePlanWithExecutor(
			planForPaths(["failure.txt"]),
			createPawLocalSubprocessToolExecutor({
				cwd,
				argv: [process.execPath, "-e", "process.stdout.write('out'); process.stderr.write('err'); process.exit(7)"],
				timeoutSec: 10,
			}),
		);

		expect(execution).toMatchObject({
			status: "blocked",
			code: "EXECUTOR_FAILED",
			executed: true,
			exitCode: 7,
			stdout: "out",
			stderr: "err",
			filesChanged: false,
		});
	});

	test("passes only allowlisted environment variables to the subprocess", async () => {
		const cwd = await createTempRoot();
		const execution = await executePlanWithExecutor(
			planForPaths(["env.txt"]),
			createPawLocalSubprocessToolExecutor({
				cwd,
				argv: [
					process.execPath,
					"-e",
					"process.stdout.write((process.env.PAW_ALLOWED ?? 'missing') + ':' + (process.env.PAW_BLOCKED ?? 'missing'))",
				],
				timeoutSec: 10,
				env: { PAW_ALLOWED: "yes", PAW_BLOCKED: "no" },
				envAllowlist: ["PAW_ALLOWED"],
			}),
		);

		expect(execution).toMatchObject({
			status: "executed",
			exitCode: 0,
			stdout: "yes:missing",
		});
	});

	test("does not interpret shell metacharacters in argv", async () => {
		const cwd = await createTempRoot();
		const markerPath = join(cwd, "shell-marker.txt");
		const execution = await executePlanWithExecutor(
			planForPaths(["shell-marker.txt"]),
			createPawLocalSubprocessToolExecutor({
				cwd,
				argv: [process.execPath, "-e", "process.stdout.write(process.argv[1])", `literal; touch ${markerPath}`],
				timeoutSec: 10,
			}),
		);

		expect(execution).toMatchObject({
			status: "executed",
			exitCode: 0,
			stdout: `literal; touch ${markerPath}`,
			filesChanged: false,
		});
		await expect(readFile(markerPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
	});

	test("reports filesChanged from declared expected file snapshots", async () => {
		const cwd = await createTempRoot();
		const changedPath = join(cwd, "changed.txt");
		await writeFile(changedPath, "before", "utf8");
		const execution = await executePlanWithExecutor(
			planForPaths(["changed.txt"]),
			createPawLocalSubprocessToolExecutor({
				cwd,
				argv: [process.execPath, "-e", "require('node:fs').writeFileSync('changed.txt', 'after')"],
				timeoutSec: 10,
			}),
		);

		expect(execution).toMatchObject({
			status: "executed",
			exitCode: 0,
			filesChanged: true,
		});
		expect(await readFile(changedPath, "utf8")).toBe("after");
	});

	test("uses an injected file change detector when provided", async () => {
		const cwd = await createTempRoot();
		const detectorCalls: string[][] = [];
		const execution = await executePlanWithExecutor(
			planForPaths(["detected.txt"]),
			createPawLocalSubprocessToolExecutor({
				cwd,
				argv: [process.execPath, "-e", "process.stdout.write('ok')"],
				timeoutSec: 10,
				detectFilesChanged: (input) => {
					detectorCalls.push([...input.expectedPaths]);
					return true;
				},
			}),
		);

		expect(detectorCalls).toEqual([["detected.txt"]]);
		expect(execution).toMatchObject({
			status: "executed",
			exitCode: 0,
			filesChanged: true,
		});
	});
});

async function createTempRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-tool-executor-"));
	tempRoots.push(root);
	return root;
}

function planForPaths(paths: readonly string[]): PawToolExecutionPlan {
	return {
		request: {
			toolName: "local_subprocess",
			riskLevel: "R1",
			runMode: "json",
			sandbox: { availablePrimitives: ["bubblewrap_landlock"] },
			paths,
		},
		description: "Run an explicitly injected local subprocess executor.",
		expectedFilesChanged: paths.length > 0,
	};
}

function authorizationForPlan(plan: PawToolExecutionPlan): PawToolExecutionAuthorization {
	return {
		status: "execute_authorized",
		toolName: plan.request.toolName,
		riskLevel: plan.request.riskLevel,
		source: "automatic_policy",
		reason: "Safe write authorized after runtime gates passed.",
	};
}

async function executePlanWithExecutor(plan: PawToolExecutionPlan, executor: PawToolExecutor) {
	return executePawToolRuntimePlan({
		config,
		plan,
		authorization: authorizationForPlan(plan),
		executor,
	});
}
