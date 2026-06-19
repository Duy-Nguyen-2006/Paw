/**
 * Shell command config resolution (extracted from resolve-config-value.ts for S3776).
 */

import { execSync, spawnSync } from "node:child_process";
import { getShellConfig } from "../utils/shell.ts";

export function executeWithConfiguredShell(command: string): { executed: boolean; value: string | undefined } {
	try {
		const { shell, args } = getShellConfig();
		const result = spawnSync(shell, [...args, command], {
			encoding: "utf-8",
			timeout: 10000,
			stdio: ["ignore", "pipe", "ignore"],
			shell: false,
			windowsHide: true,
		});

		if (result.error) {
			const error = result.error as NodeJS.ErrnoException;
			if (error.code === "ENOENT") {
				return { executed: false, value: undefined };
			}
			return { executed: true, value: undefined };
		}

		if (result.status !== 0) {
			return { executed: true, value: undefined };
		}

		const value = (result.stdout ?? "").trim();
		return { executed: true, value: value || undefined };
	} catch {
		return { executed: false, value: undefined };
	}
}

export function executeWithDefaultShell(command: string): string | undefined {
	try {
		const output = execSync(command, {
			encoding: "utf-8",
			timeout: 10000,
			stdio: ["ignore", "pipe", "ignore"],
		});
		return output.trim() || undefined;
	} catch {
		return undefined;
	}
}

export function executeCommandOnPlatform(command: string): string | undefined {
	if (process.platform !== "win32") {
		return executeWithDefaultShell(command);
	}
	const configuredResult = executeWithConfiguredShell(command);
	return configuredResult.executed ? configuredResult.value : executeWithDefaultShell(command);
}
