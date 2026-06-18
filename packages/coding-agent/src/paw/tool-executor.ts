
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type {
	PawToolExecutionPlan,
	PawToolExecutor,
	PawToolExecutorInput,
	PawToolExecutorResult,
	PawToolRuntimeRequest,
} from "./tool-runtime.ts";

export type PawLocalSubprocessFileChangeDetectorInput = {
	cwd: string;
	expectedPaths: readonly string[];
	plan: PawToolExecutionPlan;
	approvedRequest: PawToolRuntimeRequest;
};

export type PawLocalSubprocessFileChangeDetector = (
	input: PawLocalSubprocessFileChangeDetectorInput,
) => Promise<boolean> | boolean;

export type PawLocalSubprocessToolExecutorOptions = {
	cwd: string;
	argv: readonly string[];
	timeoutSec: number;
	env?: Readonly<Record<string, string | undefined>>;
	envAllowlist?: readonly string[];
	detectFilesChanged?: PawLocalSubprocessFileChangeDetector;
	maxOutputBytes?: number;
};

type ChunkAccumulator = {
	chunks: Buffer[];
	bytes: number;
};

type PathSnapshot =
	| {
			exists: false;
	  }
	| {
			exists: true;
			kind: "file" | "directory" | "other";
			size: number;
			mtimeMs: number;
			hash?: string;
	  };

const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;
const TIMEOUT_EXIT_CODE = 124;
const COMMAND_NOT_FOUND_EXIT_CODE = 127;

export function createPawLocalSubprocessToolExecutor(options: PawLocalSubprocessToolExecutorOptions): PawToolExecutor {
	const cwd = resolveRequiredCwd(options.cwd);
	const argv = [...options.argv];
	const timeoutSec = options.timeoutSec;
	const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

	if (argv.length === 0 || argv[0]?.trim().length === 0) {
		throw new Error("Paw local subprocess tool executor requires a non-empty argv array.");
	}
	if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) {
		throw new Error("Paw local subprocess tool executor requires a positive timeoutSec.");
	}
	if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 0) {
		throw new Error("Paw local subprocess tool executor requires a non-negative integer maxOutputBytes.");
	}

	const env = createAllowedEnvironment(options.env, options.envAllowlist);

	return async (input: PawToolExecutorInput): Promise<PawToolExecutorResult> => {
		const expectedPaths = input.plan.request.paths ?? [];
		const beforeSnapshots =
			options.detectFilesChanged === undefined ? await snapshotExpectedPaths(cwd, expectedPaths) : undefined;
		const execution = await runArgvOnlySubprocess({ argv, cwd, env, timeoutSec, maxOutputBytes });
		const filesChanged =
			options.detectFilesChanged === undefined
				? await didExpectedPathsChange(cwd, expectedPaths, beforeSnapshots ?? [])
				: await options.detectFilesChanged({
						cwd,
						expectedPaths,
						plan: input.plan,
						approvedRequest: input.approvedRequest,
					});

		return {
			exitCode: execution.exitCode,
			stdout: execution.stdout,
			stderr: execution.stderr,
			filesChanged,
		};
	};
}

function resolveRequiredCwd(cwd: string): string {
	if (cwd.trim().length === 0) {
		throw new Error("Paw local subprocess tool executor requires an explicit working directory.");
	}
	return resolve(cwd);
}

function createAllowedEnvironment(
	env: Readonly<Record<string, string | undefined>> | undefined,
	envAllowlist: readonly string[] | undefined,
): Record<string, string> {
	const allowed = envAllowlist === undefined ? undefined : new Set(envAllowlist);
	const result: Record<string, string> = {};

	if (allowed !== undefined) {
		for (const name of allowed) {
			const value = process.env[name];
			if (value !== undefined) {
				result[name] = value;
			}
		}
	}

	for (const [name, value] of Object.entries(env ?? {})) {
		if (value !== undefined && (allowed === undefined || allowed.has(name))) {
			result[name] = value;
		}
	}

	return result;
}

async function runArgvOnlySubprocess(input: {
	argv: readonly string[];
	cwd: string;
	env: Record<string, string>;
	timeoutSec: number;
	maxOutputBytes: number;
}): Promise<Pick<PawToolExecutorResult, "exitCode" | "stdout" | "stderr">> {
	const executable = input.argv[0];
	if (executable === undefined) {
		return {
			exitCode: COMMAND_NOT_FOUND_EXIT_CODE,
			stdout: "",
			stderr: "Cannot execute an empty argv array.",
		};
	}

	const stdoutState: ChunkAccumulator = { chunks: [], bytes: 0 };
	const stderrState: ChunkAccumulator = { chunks: [], bytes: 0 };
	const child = spawn(executable, input.argv.slice(1), {
		cwd: input.cwd,
		env: input.env,
		shell: false,
		stdio: ["ignore", "pipe", "pipe"],
	});

	child.stdout?.on("data", (data: Buffer) => {
		collectChunk(stdoutState, data, input.maxOutputBytes);
	});
	child.stderr?.on("data", (data: Buffer) => {
		collectChunk(stderrState, data, input.maxOutputBytes);
	});

	return new Promise((resolveResult) => {
		let timedOut = false;
		let settled = false;
		let timeoutHandle: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
			timedOut = true;
			timeoutHandle = undefined;
			child.kill("SIGKILL");
		}, input.timeoutSec * 1000);

		child.on("error", (error: Error) => {
			if (settled) {
				return;
			}
			settled = true;
			if (timeoutHandle !== undefined) {
				clearTimeout(timeoutHandle);
				timeoutHandle = undefined;
			}
			resolveResult({
				exitCode: COMMAND_NOT_FOUND_EXIT_CODE,
				stdout: resolveBufferedOutput(stdoutState),
				stderr: error.message,
			});
		});

		child.on("close", (code) => {
			if (settled) {
				return;
			}
			settled = true;
			if (timeoutHandle !== undefined) {
				clearTimeout(timeoutHandle);
				timeoutHandle = undefined;
			}
			const stderr = resolveBufferedOutput(stderrState);
			resolveResult({
				exitCode: timedOut ? TIMEOUT_EXIT_CODE : (code ?? 1),
				stdout: resolveBufferedOutput(stdoutState),
				stderr: timedOut ? appendTimeoutMessage(stderr, input.timeoutSec) : stderr,
			});
		});
	});
}

function collectChunk(accumulator: ChunkAccumulator, data: Buffer, maxBytes: number): void {
	const remaining = maxBytes - accumulator.bytes;
	if (remaining <= 0) {
		return;
	}
	if (data.length > remaining) {
		accumulator.chunks.push(data.subarray(0, remaining));
		accumulator.bytes = maxBytes;
	} else {
		accumulator.chunks.push(data);
		accumulator.bytes += data.length;
	}
}

function resolveBufferedOutput(accumulator: ChunkAccumulator): string {
	return Buffer.concat(accumulator.chunks).toString("utf8");
}

function appendTimeoutMessage(stderr: string, timeoutSec: number): string {
	const timeoutMessage = `Paw local subprocess timed out after ${timeoutSec} seconds.`;
	return stderr.length === 0 ? timeoutMessage : `${stderr}\n${timeoutMessage}`;
}

async function snapshotExpectedPaths(cwd: string, paths: readonly string[]): Promise<PathSnapshot[]> {
	return Promise.all(paths.map((path) => snapshotPath(resolveDeclaredPath(cwd, path))));
}

async function didExpectedPathsChange(
	cwd: string,
	paths: readonly string[],
	beforeSnapshots: readonly PathSnapshot[],
): Promise<boolean> {
	const afterSnapshots = await snapshotExpectedPaths(cwd, paths);
	return afterSnapshots.some((snapshot, index) => !snapshotsEqual(beforeSnapshots[index], snapshot));
}

function resolveDeclaredPath(cwd: string, path: string): string {
	const resolvedPath = resolve(cwd, path);
	if (resolvedPath !== cwd && !resolvedPath.startsWith(`${cwd}${sep}`)) {
		throw new Error(`Declared expected file path escapes the executor working directory: ${path}.`);
	}
	return resolvedPath;
}

async function snapshotPath(path: string): Promise<PathSnapshot> {
	try {
		const pathStat = await stat(path);
		if (pathStat.isFile()) {
			return {
				exists: true,
				kind: "file",
				size: pathStat.size,
				mtimeMs: pathStat.mtimeMs,
				hash: createHash("sha256")
					.update(await readFile(path))
					.digest("hex"),
			};
		}
		return {
			exists: true,
			kind: pathStat.isDirectory() ? "directory" : "other",
			size: pathStat.size,
			mtimeMs: pathStat.mtimeMs,
		};
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return { exists: false };
		}
		throw error;
	}
}

function snapshotsEqual(left: PathSnapshot | undefined, right: PathSnapshot | undefined): boolean {
	if (left === undefined || right === undefined) {
		return left === right;
	}
	if (!left.exists || !right.exists) {
		return left.exists === right.exists;
	}
	return (
		left.kind === right.kind && left.size === right.size && left.mtimeMs === right.mtimeMs && left.hash === right.hash
	);
}
