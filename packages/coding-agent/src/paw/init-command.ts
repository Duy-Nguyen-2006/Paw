import { relative } from "node:path";
import { APP_NAME } from "../config.ts";
import { runPawCleanCommand } from "./clean-command.ts";
import { loadDefaultPawRuntimeConfig } from "./config.ts";
import { runPawDoctorCommand } from "./doctor-command.ts";
import { initializePawProject } from "./persistence.ts";
import { runPawStatusCommand } from "./status-command.ts";

function printPawHelp(): void {
	console.log(`Usage:
  ${APP_NAME} paw init
  ${APP_NAME} paw status
  ${APP_NAME} paw clean --dry-run
  ${APP_NAME} paw doctor

Run bounded Paw project commands.

Commands:
  ${APP_NAME} paw init          Initialize .paw from paw-spec/config.yaml
  ${APP_NAME} paw init --help   Show init help
  ${APP_NAME} paw status        Show read-only Paw project and session summary
  ${APP_NAME} paw status --help Show status help
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
