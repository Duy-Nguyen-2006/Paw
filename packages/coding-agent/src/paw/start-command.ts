
import { APP_NAME } from "../config.ts";
import {
	type PawSessionLock,
	type PawSessionLockOptions,
	type PawSessionLockStaleReason,
	releasePawSessionLock,
} from "./session-store.ts";
import type { PawSessionStateName } from "./state.ts";
import { startPawTaskSession } from "./task-session.ts";

export type PawStartCommandResult =
	| PawStartCommandStartedResult
	| PawStartCommandExistingResult
	| PawStartCommandLockedResult;

export interface PawStartCommandInput {
	lockOptions?: PawSessionLockOptions;
}

export interface PawStartCommandStartedResult {
	status: "started";
	sessionId: string;
	stateName: PawSessionStateName;
	created: number;
	existing: number;
	reclaimed: PawStartCommandReclaimedLock | null;
	lockReleased: boolean;
}

export interface PawStartCommandExistingResult {
	status: "existing";
	sessionId: string;
	stateName: PawSessionStateName;
	created: number;
	existing: number;
	reclaimed: PawStartCommandReclaimedLock | null;
	lockReleased: boolean;
}

export interface PawStartCommandLockedResult {
	status: "locked";
	sessionId: string;
	created: number;
	existing: number;
	lock: PawSessionLock;
}

export interface PawStartCommandReclaimedLock {
	reason: PawSessionLockStaleReason;
	lock: PawSessionLock;
}

export async function createPawStartCommandResult(
	repoRoot: string,
	sessionId: string,
	input: PawStartCommandInput = {},
): Promise<PawStartCommandResult> {
	const startResult = await startPawTaskSession({
		repoRoot,
		sessionId,
		lockOptions: input.lockOptions,
	});

	const created = startResult.init.created.length;
	const existing = startResult.init.existing.length;

	if (startResult.status === "locked") {
		return {
			status: "locked",
			sessionId,
			created,
			existing,
			lock: startResult.lock,
		};
	}

	const lockReleased = await releasePawSessionLock(repoRoot, sessionId, input.lockOptions);
	const reclaimed = mapReclaimedLock(startResult.reclaimed);

	if (startResult.status === "started") {
		return {
			status: "started",
			sessionId,
			stateName: startResult.state.name,
			created,
			existing,
			reclaimed,
			lockReleased,
		};
	}

	return {
		status: "existing",
		sessionId,
		stateName: startResult.state.name,
		created,
		existing,
		reclaimed,
		lockReleased,
	};
}

export function formatPawStartCommandResult(result: PawStartCommandResult): string {
	switch (result.status) {
		case "started":
		case "existing":
			return [
				"Paw start",
				`status: ${result.status}`,
				`session: ${result.sessionId}`,
				`state: ${result.stateName}`,
				`created: ${result.created}`,
				`existing: ${result.existing}`,
				`reclaimed lock: ${formatReclaimedLock(result.reclaimed)}`,
				`lock released: ${result.lockReleased ? "yes" : "no"}`,
			].join("\n");
		case "locked":
			return [
				"Paw start",
				"status: locked",
				`session: ${result.sessionId}`,
				`created: ${result.created}`,
				`existing: ${result.existing}`,
				`lock: pid ${result.lock.pid} on ${result.lock.host}`,
				"lock released: no",
			].join("\n");
	}
}

export async function runPawStartCommand(args: string[]): Promise<void> {
	if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
		printPawStartHelp();
		return;
	}

	if (args.length === 0) {
		printPawStartCommandError('Missing required session id for "paw start".');
		return;
	}

	const sessionId = args[0];
	if (sessionId.startsWith("-")) {
		printPawStartCommandError('Missing required session id for "paw start".');
		return;
	}

	if (args.length > 1) {
		printPawStartCommandError(`Unknown option for "paw start": ${args[1]}`);
		return;
	}

	try {
		console.log(formatPawStartCommandResult(await createPawStartCommandResult(process.cwd(), sessionId)));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		printPawStartCommandError(message);
	}
}

function mapReclaimedLock(
	reclaimed: { reason: PawSessionLockStaleReason; lock: PawSessionLock } | null,
): PawStartCommandReclaimedLock | null {
	if (reclaimed === null) {
		return null;
	}
	return {
		reason: reclaimed.reason,
		lock: reclaimed.lock,
	};
}

function formatReclaimedLock(reclaimed: PawStartCommandReclaimedLock | null): string {
	if (reclaimed === null) {
		return "no";
	}
	return `${reclaimed.reason} from pid ${reclaimed.lock.pid} on ${reclaimed.lock.host}`;
}

function printPawStartHelp(): void {
	console.log(`Usage:
  ${APP_NAME} paw start <session-id>

Initialize .paw when needed, acquire the session lock, and start or resume a Paw task session.

Commands:
  ${APP_NAME} paw start <session-id> Start a new session in INTAKE or report an existing session
  ${APP_NAME} paw start --help       Show this help
`);
}

function printPawStartCommandError(message: string): void {
	console.error(`Error: ${message}`);
	process.exitCode = 1;
}
