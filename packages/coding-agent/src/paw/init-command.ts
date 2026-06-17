import { relative } from "node:path";
import { APP_NAME } from "../config.ts";
import { runPawCleanCommand } from "./clean-command.ts";
import { loadDefaultPawRuntimeConfig } from "./config.ts";
import { runPawDoctorCommand } from "./doctor-command.ts";
import { runPawFinalizeCommand } from "./finalize-command.ts";
import { initializePawProject } from "./persistence.ts";
import { runPawApprovePlanCommand } from "./plan-approval-command.ts";
import { runPawReportCommand } from "./report-command.ts";
import { runPawResumeCommand } from "./resume-command.ts";
import { runPawPrepareCheckpointCommand } from "./slice-checkpoint-command.ts";
import { runPawBeginImplementationCommand } from "./slice-implementation-command.ts";
import { runPawSelectSliceCommand } from "./slice-selection-command.ts";
import { runPawStartCommand } from "./start-command.ts";
import { runPawStatusCommand } from "./status-command.ts";
import { runPawVerifyCommand } from "./verify-command.ts";

function printPawHelp(): void {
	console.log(`Usage:
  ${APP_NAME} paw init
  ${APP_NAME} paw status
  ${APP_NAME} paw start <session-id>
  ${APP_NAME} paw resume <session-id>
  ${APP_NAME} paw verify <session-id>
  ${APP_NAME} paw approve-plan <session-id> --slice <slice-id>[:<title>]...
  ${APP_NAME} paw select-slice <session-id>
  ${APP_NAME} paw begin-implementation <session-id>
  ${APP_NAME} paw prepare-checkpoint <session-id> --base-tree <tree> --short-id <id> --timestamp <iso> --changed-file <path>=<hash|null>
  ${APP_NAME} paw finalize <session-id> --summary <text>
  ${APP_NAME} paw report <session-id>
  ${APP_NAME} paw clean --dry-run
  ${APP_NAME} paw doctor

Run bounded Paw project commands.

Commands:
  ${APP_NAME} paw init          Initialize .paw from paw-spec/config.yaml
  ${APP_NAME} paw init --help   Show init help
  ${APP_NAME} paw status        Show read-only Paw project and session summary
  ${APP_NAME} paw status --help Show status help
  ${APP_NAME} paw start <session-id>      Start or resume a Paw task session
  ${APP_NAME} paw start --help           Show start help
  ${APP_NAME} paw resume <session-id> Show resumable session state and lock status
  ${APP_NAME} paw resume --help Show resume help
  ${APP_NAME} paw approve-plan <session-id> --slice <id>[:<title>]... Approve plan slices from PLAN_DRAFTED
  ${APP_NAME} paw approve-plan --help               Show approve-plan help
  ${APP_NAME} paw select-slice <session-id>          Select next pending plan slice
  ${APP_NAME} paw begin-implementation <session-id>   Begin implementing selected slice from SLICE_SELECT
  ${APP_NAME} paw select-slice --help                Show select-slice help
  ${APP_NAME} paw begin-implementation --help          Show begin-implementation help
  ${APP_NAME} paw prepare-checkpoint <session-id> ... Prepare slice checkpoint metadata from SLICE_SELECT
  ${APP_NAME} paw prepare-checkpoint --help           Show prepare-checkpoint help
  ${APP_NAME} paw verify <session-id> Record configured verification decisions
  ${APP_NAME} paw verify --help Show verify help
  ${APP_NAME} paw finalize <session-id> --summary <text> Emit final report for SLICE_DONE session
  ${APP_NAME} paw finalize --help               Show finalize help
  ${APP_NAME} paw report <session-id>         Show persisted final report markdown
  ${APP_NAME} paw report <session-id> --json  Show persisted final report JSON
  ${APP_NAME} paw report --help                Show report help
  ${APP_NAME} paw clean --dry-run Show read-only Paw retention plan
  ${APP_NAME} paw clean --help  Show clean help
  ${APP_NAME} paw doctor        Show read-only sandbox diagnostics
  ${APP_NAME} paw doctor --help Show doctor help
`);
}

function printPawInitSummary(pawDir: string, created: number, existing: number): void {
	console.log(`${pawDir} initialized`);
	console.log(`created: ${created}`);
	console.log(`existing: ${existing}`);
}

function printPawCommandError(message: string): void {
	console.error(`Error: ${message}`);
	process.exitCode = 1;
}

export async function handlePawCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "paw") {
		return false;
	}

	const [, subcommand, ...rest] = args;
	if (subcommand === "init") {
		if (rest.length === 1 && (rest[0] === "--help" || rest[0] === "-h")) {
			printPawHelp();
			return true;
		}
		if (rest.length > 0) {
			printPawCommandError(`Unknown option for "paw init": ${rest[0]}`);
			return true;
		}

		try {
			const cwd = process.cwd();
			const config = loadDefaultPawRuntimeConfig(cwd);
			const result = await initializePawProject(cwd, config);
			const pawDir = relative(cwd, result.paths.pawDir) || ".paw";
			printPawInitSummary(pawDir, result.created.length, result.existing.length);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			printPawCommandError(message);
		}
		return true;
	}

	if (subcommand === "doctor") {
		try {
			await runPawDoctorCommand(rest, () => loadDefaultPawRuntimeConfig(process.cwd()));
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			printPawCommandError(message);
		}
		return true;
	}

	if (subcommand === "status") {
		try {
			await runPawStatusCommand(rest);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			printPawCommandError(message);
		}
		return true;
	}

	if (subcommand === "report") {
		await runPawReportCommand(rest);
		return true;
	}

	if (subcommand === "start") {
		await runPawStartCommand(rest);
		return true;
	}

	if (subcommand === "resume") {
		await runPawResumeCommand(rest);
		return true;
	}

	if (subcommand === "verify") {
		await runPawVerifyCommand(rest);
		return true;
	}

	if (subcommand === "approve-plan") {
		await runPawApprovePlanCommand(rest);
		return true;
	}

	if (subcommand === "select-slice") {
		await runPawSelectSliceCommand(rest);
		return true;
	}

	if (subcommand === "begin-implementation") {
		await runPawBeginImplementationCommand(rest);
		return true;
	}

	if (subcommand === "prepare-checkpoint") {
		await runPawPrepareCheckpointCommand(rest);
		return true;
	}

	if (subcommand === "finalize") {
		await runPawFinalizeCommand(rest);
		return true;
	}

	if (subcommand === "clean") {
		try {
			await runPawCleanCommand(rest);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			printPawCommandError(message);
		}
		return true;
	}

	if (subcommand === "--help" || subcommand === "-h") {
		printPawHelp();
		return true;
	}

	const command = subcommand ?? "(missing)";
	printPawCommandError(`Unknown Paw command: ${command}`);
	return true;
}
