import { stat } from "node:fs/promises";
import type { PawValidationIssue } from "./contracts.ts";

interface FileSystemError extends Error {
	code?: string;
}

export function isPawFileSystemError(error: unknown): error is FileSystemError {
	return error instanceof Error;
}

export async function pawCliIsDirectory(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory();
	} catch (error) {
		if (isPawFileSystemError(error) && error.code === "ENOENT") {
			return false;
		}
		throw error;
	}
}

export async function pawCliIsFile(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isFile();
	} catch (error) {
		if (isPawFileSystemError(error) && error.code === "ENOENT") {
			return false;
		}
		throw error;
	}
}

export function formatPawCliValidationIssues(issues: readonly PawValidationIssue[]): string {
	return issues.map((issue) => `${issue.path} ${issue.message}`).join("; ");
}
