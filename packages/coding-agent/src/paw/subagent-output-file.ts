import { readFile } from "node:fs/promises";
import { isPawFileSystemError } from "./cli-fs.ts";
import type { PawSubAgentOutput, PawValidationIssue } from "./contracts.ts";
import { parsePawSubAgentOutputJson } from "./subagent.ts";

export type PawSubAgentOutputFileReadResult =
	| { kind: "missing" }
	| { kind: "invalid"; issues: readonly PawValidationIssue[] }
	| { kind: "ok"; value: PawSubAgentOutput };

export async function readPawSubAgentOutputFile(outputFile: string): Promise<PawSubAgentOutputFileReadResult> {
	try {
		const content = await readFile(outputFile, "utf-8");
		const parsed = parsePawSubAgentOutputJson(content);
		if (!parsed.ok) {
			return { kind: "invalid", issues: parsed.issues };
		}
		return { kind: "ok", value: parsed.value };
	} catch (error) {
		if (isPawFileSystemError(error) && error.code === "ENOENT") {
			return { kind: "missing" };
		}
		throw error;
	}
}
