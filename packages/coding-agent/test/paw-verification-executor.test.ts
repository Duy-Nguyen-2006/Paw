
import { describe, expect, test } from "vitest";
import { createPawNativeSubprocessExecutor } from "../src/paw/verification-executor.ts";

describe("createPawNativeSubprocessExecutor", () => {
	test("captures stdout and exit code zero for a successful command", async () => {
		const executor = createPawNativeSubprocessExecutor();
		const result = await executor({
			gate: "test_gate",
			command: [process.execPath, "-e", "process.stdout.write('hello')"],
			timeoutSec: 10,
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("hello");
		expect(result.stderr).toBe("");
		expect(result.timedOut).toBeUndefined();
	});

	test("captures stderr and non-zero exit code for a failing command", async () => {
		const executor = createPawNativeSubprocessExecutor();
		const result = await executor({
			gate: "test_gate",
			command: [process.execPath, "-e", "process.stderr.write('oops'); process.exit(1)"],
			timeoutSec: 10,
		});

		expect(result.exitCode).toBe(1);
		expect(result.stdout).toBe("");
		expect(result.stderr).toBe("oops");
		expect(result.timedOut).toBeUndefined();
	});

	test("kills the process and sets timedOut when the timeout elapses", async () => {
		const executor = createPawNativeSubprocessExecutor();
		const result = await executor({
			gate: "test_gate",
			command: [process.execPath, "-e", "setTimeout(() => {}, 60000)"],
			timeoutSec: 0.2,
		});

		expect(result.exitCode).toBe(124);
		expect(result.timedOut).toBe(true);
	});

	test("truncates stdout to maxOutputBytes when output exceeds the limit", async () => {
		const executor = createPawNativeSubprocessExecutor({ maxOutputBytes: 10 });
		const result = await executor({
			gate: "test_gate",
			command: [process.execPath, "-e", "process.stdout.write('a'.repeat(100))"],
			timeoutSec: 10,
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("aaaaaaaaaa");
		expect(result.stdout.length).toBe(10);
	});

	test("truncates stderr to maxOutputBytes when output exceeds the limit", async () => {
		const executor = createPawNativeSubprocessExecutor({ maxOutputBytes: 5 });
		const result = await executor({
			gate: "test_gate",
			command: [process.execPath, "-e", "process.stderr.write('b'.repeat(50)); process.exit(1)"],
			timeoutSec: 10,
		});

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe("bbbbb");
		expect(result.stderr.length).toBe(5);
	});

	test("returns exitCode 127 and stderr message for a nonexistent command", async () => {
		const executor = createPawNativeSubprocessExecutor();
		const result = await executor({
			gate: "test_gate",
			command: ["nonexistent_command_xyz_12345"],
			timeoutSec: 10,
		});

		expect(result.exitCode).toBe(127);
		expect(result.stdout).toBe("");
		expect(result.stderr).toBeTruthy();
		expect(result.timedOut).toBeUndefined();
	});

	test("returns exitCode 127 for an empty command array", async () => {
		const executor = createPawNativeSubprocessExecutor();
		const result = await executor({
			gate: "test_gate",
			command: [],
			timeoutSec: 10,
		});

		expect(result.exitCode).toBe(127);
		expect(result.stderr).toBe("Cannot execute an empty command.");
	});

	test("passes cwd to the spawned process", async () => {
		const expectedCwd = process.cwd();
		const executor = createPawNativeSubprocessExecutor({ cwd: expectedCwd });
		const result = await executor({
			gate: "test_gate",
			command: [process.execPath, "-e", "process.stdout.write(process.cwd())"],
			timeoutSec: 10,
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe(expectedCwd);
	});

	test("merges custom env variables with the current environment", async () => {
		const executor = createPawNativeSubprocessExecutor({
			env: { PAW_TEST_VAR: "paw_value" },
		});
		const result = await executor({
			gate: "test_gate",
			command: [process.execPath, "-e", "process.stdout.write(process.env.PAW_TEST_VAR ?? 'missing')"],
			timeoutSec: 10,
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("paw_value");
	});
});
