import type { TLocalizedValidationError } from "typebox/error";
import type { PawValidationIssue } from "./contracts.ts";

type TypeboxErrorWithInstancePath = TLocalizedValidationError & {
	instancePath?: string;
	path?: string;
};

export function formatTypeboxIssues(errors: Iterable<TLocalizedValidationError>): PawValidationIssue[] {
	return Array.from(errors).map((error) => ({
		path: (error as TypeboxErrorWithInstancePath).instancePath || (error as TypeboxErrorWithInstancePath).path || "/",
		message: error.message,
	}));
}

export function formatIssuesForError(prefix: string, issues: PawValidationIssue[]): Error {
	const details = issues.map((issue) => `  - ${issue.path}: ${issue.message}`).join("\n");
	return new Error(`${prefix}:\n${details}`);
}
