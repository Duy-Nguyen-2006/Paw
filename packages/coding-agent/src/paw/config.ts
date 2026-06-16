import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Compile } from "typebox/compile";
import { parse } from "yaml";
import { type PawRuntimeConfig, PawRuntimeConfigSchema, type PawValidationResult } from "./contracts.ts";
import { formatIssuesForError, formatTypeboxIssues } from "./validation.ts";

const validateRuntimeConfig = Compile(PawRuntimeConfigSchema);

export function findDefaultPawConfigPath(startDir = process.cwd()): string {
	let currentDir = resolve(startDir);

	while (true) {
		const candidate = join(currentDir, "paw-spec", "config.yaml");
		if (existsSync(candidate)) {
			return candidate;
		}

		const parentDir = dirname(currentDir);
		if (parentDir === currentDir) {
			throw new Error(`Could not find paw-spec/config.yaml from ${resolve(startDir)}`);
		}
		currentDir = parentDir;
	}
}

export function parsePawRuntimeConfigYaml(content: string): PawValidationResult<PawRuntimeConfig> {
	let parsed: unknown;
	try {
		parsed = parse(content);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			ok: false,
			issues: [{ path: "/", message: `Invalid YAML: ${message}` }],
		};
	}

	if (!validateRuntimeConfig.Check(parsed)) {
		return {
			ok: false,
			issues: formatTypeboxIssues(validateRuntimeConfig.Errors(parsed)),
		};
	}

	return { ok: true, value: parsed as PawRuntimeConfig };
}

export function loadPawRuntimeConfig(configPath: string): PawRuntimeConfig {
	const result = parsePawRuntimeConfigYaml(readFileSync(configPath, "utf-8"));
	if (!result.ok) {
		throw formatIssuesForError(`Invalid Paw runtime config at ${configPath}`, result.issues);
	}
	return result.value;
}

export function loadDefaultPawRuntimeConfig(startDir = process.cwd()): PawRuntimeConfig {
	return loadPawRuntimeConfig(findDefaultPawConfigPath(startDir));
}
