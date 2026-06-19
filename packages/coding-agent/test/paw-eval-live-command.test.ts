import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { PawBuildParsedInput } from "../src/paw/build-command.ts";
import {
	createPawEvalLiveCommandResult,
	formatPawEvalLiveCommandResult,
	parsePawEvalLiveArgs,
	writePawSessionState,
	writePawVerificationEvidence,
} from "../src/paw/index.ts";

const tempRoots: string[] = [];
const sourceRoot = join(import.meta.dirname, "..", "..", "..");

async function createTempRepo(name = "repo"): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), `paw-eval-live-${name}-`));
	tempRoots.push(root);
	await mkdir(join(root, "paw-spec"), { recursive: true });
	await writeFile(
		join(root, "paw-spec/config.yaml"),
		await readFile(join(sourceRoot, "paw-spec/config.yaml"), "utf-8"),
	);
	return root;
}

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("parsePawEvalLiveArgs", () => {
	test("parses repos and validation options", () => {
		expect(parsePawEvalLiveArgs(["--repo", "a", "--repo", "b", "--install", "--keep-workdir"])).toEqual({
			kind: "ok",
			input: { repos: ["a", "b"], install: true, keepWorkdir: true, maxSteps: 6 },
		});
		expect(parsePawEvalLiveArgs([])).toEqual({
			kind: "error",
			message: 'Missing required option for "paw eval-live": --repo <url-or-path>',
		});
		expect(parsePawEvalLiveArgs(["--help"])).toEqual({ kind: "help" });
	});
});

describe("createPawEvalLiveCommandResult", () => {
	test("runs the official live-eval state sequence and summarizes persisted evidence", async () => {
		const repoRoot = await createTempRepo("local");
		await writeFile(
			join(repoRoot, "package.json"),
			JSON.stringify({ scripts: { "build:executor": "node build.js" } }),
		);
		await writeFile(join(repoRoot, "requirements.txt"), "pyinstaller\nortools\n");
		const commandCalls: string[] = [];
		const calls: PawBuildParsedInput[] = [];
		const result = await createPawEvalLiveCommandResult(
			{ repos: [repoRoot], install: true, keepWorkdir: true, maxSteps: 3 },
			{
				configSourceRoot: sourceRoot,
				commandRunner: async (input) => {
					commandCalls.push([input.command, ...input.args].join(" "));
					return { exitCode: 0, stdout: "ok", stderr: "" };
				},
				buildRunner: async (root, sessionId, input) => {
					calls.push(input);
					if ("once" in input && input.native) {
						await writePawVerificationEvidence(root, sessionId, [
							{
								status: "verified",
								gate: "unit_tests",
								verified: true,
								executed: true,
								command: ["npm", "test"],
								exitCode: 0,
								stdout: "ok",
								stderr: "",
							},
						]);
					}
					await writePawSessionState(root, {
						session_id: sessionId,
						name: "FINAL_REPORT",
						current_slice_id: null,
						pending_slice_ids: [],
						completed_slice_ids: ["live-slice-1"],
						blocked_reason: null,
					});
					return {
						status: "completed",
						sessionId,
						selectedSliceId: "live-slice-1",
						previousStateName: "VERIFYING",
						nextStateName: "SLICE_DONE",
						verifiedGateCount: 1,
						unverifiedGateCount: 0,
						nativeVerificationPlan: [],
						nativeVerificationRunResults: [],
						verifyDecisions: [],
						unverifiedDecisions: [],
						lockReleased: true,
					} as never;
				},
			},
		);

		expect(result.status).toBe("completed");
		expect(result.results[0]).toMatchObject({ status: "done", evidenceCount: 1, verifiedGates: ["unit_tests"] });
		expect(commandCalls).toEqual([
			"npm install",
			`python3 -m venv ${join(repoRoot, ".venv-paw-eval")}`,
			`${join(repoRoot, ".venv-paw-eval", "bin", "python")} -m pip install -r requirements.txt`,
			"npm run build:executor",
		]);
		expect(calls.map((call) => ("once" in call ? `once:${call.native === true}` : `loop:${call.maxSteps}`))).toEqual([
			"once:false",
			"once:false",
			"once:false",
			"once:false",
			"once:true",
			"loop:3",
		]);
		expect(formatPawEvalLiveCommandResult(result)).toContain("Paw eval-live");
	});
});
