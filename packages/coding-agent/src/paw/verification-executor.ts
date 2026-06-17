import { spawn } from "node:child_process";
import type {
	PawNativeVerificationExecutor,
	PawNativeVerificationExecutorInput,
	PawNativeVerificationExecutorResult,
} from "./verification-runner.ts";

export type PawNativeSubprocessExecutorOptions = {
	cwd?: string;
	env?: Record<string, string>;
	maxOutputBytes?: number;
};

const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;
const TIMEOUT_EXIT_CODE = 124;
const COMMAND_NOT_FOUND_EXIT_CODE = 127;

type ChunkAccumulator = {
	chunks: Buffer[];
	bytes: number;
};

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

export function createPawNativeSubprocessExecutor(
	options?: PawNativeSubprocessExecutorOptions,
): PawNativeVerificationExecutor {
	const cwd = options?.cwd;
	const env = options?.env;
	const maxOutputBytes = options?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

	return async (input: PawNativeVerificationExecutorInput): Promise<PawNativeVerificationExecutorResult> => {
		const executable = input.command[0];
		if (executable === undefined) {
			return {
				exitCode: COMMAND_NOT_FOUND_EXIT_CODE,
				stdout: "",
				stderr: "Cannot execute an empty command.",
			};
		}

		const args = input.command.slice(1);
		const stdoutState: ChunkAccumulator = { chunks: [], bytes: 0 };
		const stderrState: ChunkAccumulator = { chunks: [], bytes: 0 };

		const child = spawn(executable, args, {
			cwd,
			env: env !== undefined ? { ...process.env, ...env } : undefined,
			stdio: ["ignore", "pipe", "pipe"],
		});

		child.stdout?.on("data", (data: Buffer) => {
			collectChunk(stdoutState, data, maxOutputBytes);
		});

		child.stderr?.on("data", (data: Buffer) => {
			collectChunk(stderrState, data, maxOutputBytes);
		});

		return new Promise<PawNativeVerificationExecutorResult>((resolve) => {
			let timedOut = false;
			let timeoutHandle: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
				timedOut = true;
				timeoutHandle = undefined;
				child.kill("SIGKILL");
			}, input.timeoutSec * 1000);

			child.on("error", (err: Error) => {
				if (timeoutHandle !== undefined) {
					clearTimeout(timeoutHandle);
					timeoutHandle = undefined;
				}
				resolve({
					exitCode: COMMAND_NOT_FOUND_EXIT_CODE,
					stdout: resolveBufferedOutput(stdoutState),
					stderr: err.message,
				});
			});

			child.on("close", (code) => {
				if (timeoutHandle !== undefined) {
					clearTimeout(timeoutHandle);
					timeoutHandle = undefined;
				}
				resolve({
					exitCode: timedOut ? TIMEOUT_EXIT_CODE : (code ?? 1),
					stdout: resolveBufferedOutput(stdoutState),
					stderr: resolveBufferedOutput(stderrState),
					...(timedOut ? { timedOut: true } : {}),
				});
			});
		});
	};
}
