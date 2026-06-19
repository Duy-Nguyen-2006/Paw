import { relative } from "node:path";
import { APP_NAME } from "../config.ts";
import { runPawApproveRetryCommand } from "./approve-retry-command.ts";
import { runPawBuildCommand } from "./build-command.ts";
import { runPawChatCommand } from "./chat-command.ts";
import { runPawCleanCommand } from "./clean-command.ts";
import { loadDefaultPawRuntimeConfig } from "./config.ts";
import { runPawCostCommand } from "./cost-command.ts";
import { runPawDiffCommand } from "./diff-command.ts";
import { runPawDoctorCommand } from "./doctor-command.ts";
import { runPawDrillCommand } from "./drill-command.ts";
import { runPawEvalLiveCommand } from "./eval-live-command.ts";
import { runPawExplainCommand } from "./explain-command.ts";
import { runPawFinalizeCommand } from "./finalize-command.ts";
import { initializePawProject } from "./persistence.ts";
import { runPawApprovePlanCommand } from "./plan-approval-command.ts";
import { runPawPlanCommand } from "./plan-command.ts";
import { runPawReportCommand } from "./report-command.ts";
import { runPawResumeCommand } from "./resume-command.ts";
import { runPawBlockReviewerCommand } from "./reviewer-blocked-command.ts";
import { runPawCompleteReviewerCommand } from "./reviewer-result-command.ts";
import { runPawRollbackCommand } from "./rollback-command.ts";
import { runPawPrepareCheckpointCommand } from "./slice-checkpoint-command.ts";
import { runPawBeginImplementationCommand } from "./slice-implementation-command.ts";
import { runPawSelectSliceCommand } from "./slice-selection-command.ts";
import { runPawStartCommand } from "./start-command.ts";
import { runPawStatusCommand } from "./status-command.ts";
import { runPawTimelineCommand } from "./timeline-command.ts";
import { runPawBlockVerifierCommand } from "./verifier-blocked-command.ts";
import { runPawCompleteVerificationCommand } from "./verifier-result-command.ts";
import { runPawVerifyCommand } from "./verify-command.ts";
import { runPawBlockWorkerCommand } from "./worker-blocked-command.ts";
import { runPawCompleteWorkerCommand } from "./worker-result-command.ts";

function printPawHelp(): void {
	console.log(`Usage:
  ${APP_NAME} paw init
  ${APP_NAME} paw status
  ${APP_NAME} paw start <session-id>
  ${APP_NAME} paw resume <session-id>
  ${APP_NAME} paw verify <session-id>
  ${APP_NAME} paw build <session-id> --once
  ${APP_NAME} paw drill <name> [--json]
  ${APP_NAME} paw diff [scope] [--session <id>] [--stat]
  ${APP_NAME} paw plan <session-id> [--queue|--completed] [--acceptance]
  ${APP_NAME} paw timeline <session-id> [--limit <n>] [--no-journal]
  ${APP_NAME} paw cost <session-id> [--class trivial|standard|high_risk] [--json]
  ${APP_NAME} paw explain [<session-id>] [--verbose]
  ${APP_NAME} paw chat <session-id> [--json]
  ${APP_NAME} paw approve <session-id> [--reason <text>]
  ${APP_NAME} paw reject <session-id> --reason <text>
  ${APP_NAME} paw retry <session-id>
  ${APP_NAME} paw approve-plan <session-id> --slice <slice-id>[:<title>]...
  ${APP_NAME} paw select-slice <session-id>
  ${APP_NAME} paw begin-implementation <session-id>
  ${APP_NAME} paw complete-worker <session-id> --output-file <path> [--timestamp <iso>]
  ${APP_NAME} paw block-worker <session-id> --output-file <path>
  ${APP_NAME} paw block-reviewer <session-id> --output-file <path>
  ${APP_NAME} paw block-verifier <session-id> --decision-file <path>
  ${APP_NAME} paw complete-reviewer <session-id> --output-file <path>
  ${APP_NAME} paw complete-verification <session-id> --decision-file <path>
  ${APP_NAME} paw prepare-checkpoint <session-id> --base-tree <tree> --short-id <id> --timestamp <iso> --changed-file <path>=<hash|null>
  ${APP_NAME} paw rollback <session-id> --dry-run [--checkpoint <name>]
  ${APP_NAME} paw finalize <session-id> --summary <text>
  ${APP_NAME} paw report <session-id>
  ${APP_NAME} paw clean --dry-run
  ${APP_NAME} paw doctor [--fix-suggestions]
  ${APP_NAME} paw eval-live --repo <url-or-path> [--repo <url-or-path>...] [--install]

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
  ${APP_NAME} paw build <session-id> --once Run one worker orchestration step
  ${APP_NAME} paw build --help Show build help
  ${APP_NAME} paw drill <name>    Run a Paw drill (crash-resume, secret-redaction, provider-failover, patch-robustness, reviewer-diff)
  ${APP_NAME} paw drill --help    Show drill help
  ${APP_NAME} paw diff [scope]    Show working tree or session diff
  ${APP_NAME} paw diff --help     Show diff help
  ${APP_NAME} paw plan <session-id>  Inspect the current plan state
  ${APP_NAME} paw plan --help     Show plan help
  ${APP_NAME} paw timeline <session-id>  Show session timeline (events + state + journal)
  ${APP_NAME} paw timeline --help  Show timeline help
  ${APP_NAME} paw cost <session-id>  Show session cost aggregation
  ${APP_NAME} paw cost --help     Show cost help
  ${APP_NAME} paw explain [<session-id>]  Explain current state, blocked reason, sandbox
  ${APP_NAME} paw explain --help   Show explain help
  ${APP_NAME} paw chat <session-id>  Start an interactive Paw chat session
  ${APP_NAME} paw chat --help    Show chat help
  ${APP_NAME} paw approve <session-id>  Advance from SPEC_DRAFTED, PLAN_DRAFTED, or BLOCKED_NEEDS_USER_DECISION
  ${APP_NAME} paw reject <session-id>  Move session to BLOCKED_NEEDS_USER_DECISION with a reason
  ${APP_NAME} paw retry <session-id>  Resume from a blocked state or restart the current slice step
  ${APP_NAME} paw approve-plan <session-id> --slice <id>[:<title>]... Approve plan slices from PLAN_DRAFTED
  ${APP_NAME} paw approve-plan --help               Show approve-plan help
  ${APP_NAME} paw select-slice <session-id>          Select next pending plan slice
  ${APP_NAME} paw begin-implementation <session-id>   Begin implementing selected slice from SLICE_SELECT
  ${APP_NAME} paw complete-worker <session-id> --output-file <path>  Complete worker pass from IMPLEMENTING to REVIEWING
  ${APP_NAME} paw block-worker <session-id> --output-file <path>  Record worker blocked result from IMPLEMENTING to BLOCKED_*
  ${APP_NAME} paw block-reviewer <session-id> --output-file <path>  Record reviewer blocked result from REVIEWING to BLOCKED_*
  ${APP_NAME} paw block-verifier <session-id> --decision-file <path>  Record verifier blocked result from VERIFYING to BLOCKED_*
  ${APP_NAME} paw complete-reviewer <session-id> --output-file <path>  Complete reviewer pass from REVIEWING to VERIFYING
  ${APP_NAME} paw complete-verification <session-id> --decision-file <path>  Complete verification from VERIFYING to SLICE_DONE
  ${APP_NAME} paw select-slice --help                Show select-slice help
  ${APP_NAME} paw begin-implementation --help          Show begin-implementation help
  ${APP_NAME} paw complete-worker --help                   Show complete-worker help
  ${APP_NAME} paw block-worker --help                     Show block-worker help
  ${APP_NAME} paw block-reviewer --help                     Show block-reviewer help
  ${APP_NAME} paw block-verifier --help                     Show block-verifier help
  ${APP_NAME} paw complete-reviewer --help                   Show complete-reviewer help
  ${APP_NAME} paw complete-verification --help                   Show complete-verification help
  ${APP_NAME} paw prepare-checkpoint <session-id> ... Prepare slice checkpoint metadata from SLICE_SELECT
  ${APP_NAME} paw prepare-checkpoint --help           Show prepare-checkpoint help
  ${APP_NAME} paw rollback <session-id> --dry-run     Inspect checkpoint metadata without changing files
  ${APP_NAME} paw rollback --help                     Show rollback help
  ${APP_NAME} paw verify <session-id> Record configured verification decisions
  ${APP_NAME} paw verify --help Show verify help
  ${APP_NAME} paw finalize <session-id> --summary <text> Emit final report for SLICE_DONE session
  ${APP_NAME} paw finalize --help               Show finalize help
  ${APP_NAME} paw report <session-id>         Show persisted final report markdown
  ${APP_NAME} paw report <session-id> --json  Show persisted final report JSON
  ${APP_NAME} paw report --help                Show report help
  ${APP_NAME} paw clean --dry-run Show read-only Paw retention plan
  ${APP_NAME} paw clean --help  Show clean help
  ${APP_NAME} paw doctor                       Show read-only sandbox diagnostics
  ${APP_NAME} paw doctor --fix-suggestions     Include actionable fix commands
  ${APP_NAME} paw doctor --help Show doctor help
  ${APP_NAME} paw eval-live --repo <url-or-path> Run live full-slice validation on real repos
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

async function handlePawInit(rest: string[]): Promise<void> {
	if (rest.length === 1 && (rest[0] === "--help" || rest[0] === "-h")) {
		printPawHelp();
		return;
	}
	if (rest.length > 0) {
		printPawCommandError(`Unknown option for "paw init": ${rest[0]}`);
		return;
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
}

async function handlePawDoctor(rest: string[]): Promise<void> {
	try {
		await runPawDoctorCommand(rest, () => loadDefaultPawRuntimeConfig(process.cwd()));
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		printPawCommandError(message);
	}
}

async function handlePawStatus(rest: string[]): Promise<void> {
	try {
		await runPawStatusCommand(rest);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		printPawCommandError(message);
	}
}

async function handlePawClean(rest: string[]): Promise<void> {
	try {
		await runPawCleanCommand(rest);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		printPawCommandError(message);
	}
}

type PawSubcommandHandler = (rest: string[]) => Promise<void>;

const PAW_SUBCOMMAND_HANDLERS: Record<string, PawSubcommandHandler> = {
	init: handlePawInit,
	doctor: handlePawDoctor,
	"eval-live": async (rest) => {
		await runPawEvalLiveCommand(rest);
	},
	drill: async (rest) => {
		await runPawDrillCommand(rest);
	},
	diff: async (rest) => {
		await runPawDiffCommand(rest);
	},
	plan: async (rest) => {
		await runPawPlanCommand(rest);
	},
	timeline: async (rest) => {
		await runPawTimelineCommand(rest);
	},
	cost: async (rest) => {
		await runPawCostCommand(rest);
	},
	explain: async (rest) => {
		await runPawExplainCommand(rest);
	},
	chat: async (rest) => {
		await runPawChatCommand(rest);
	},
	approve: async (rest) => {
		await runPawApproveRetryCommand(["approve", ...rest]);
	},
	reject: async (rest) => {
		await runPawApproveRetryCommand(["reject", ...rest]);
	},
	retry: async (rest) => {
		await runPawApproveRetryCommand(["retry", ...rest]);
	},
	status: handlePawStatus,
	report: async (rest) => {
		await runPawReportCommand(rest);
	},
	start: async (rest) => {
		await runPawStartCommand(rest);
	},
	resume: async (rest) => {
		await runPawResumeCommand(rest);
	},
	verify: async (rest) => {
		await runPawVerifyCommand(rest);
	},
	build: async (rest) => {
		await runPawBuildCommand(rest);
	},
	"approve-plan": async (rest) => {
		await runPawApprovePlanCommand(rest);
	},
	"select-slice": async (rest) => {
		await runPawSelectSliceCommand(rest);
	},
	"begin-implementation": async (rest) => {
		await runPawBeginImplementationCommand(rest);
	},
	"complete-worker": async (rest) => {
		await runPawCompleteWorkerCommand(rest);
	},
	"block-worker": async (rest) => {
		await runPawBlockWorkerCommand(rest);
	},
	"block-reviewer": async (rest) => {
		await runPawBlockReviewerCommand(rest);
	},
	"complete-reviewer": async (rest) => {
		await runPawCompleteReviewerCommand(rest);
	},
	"block-verifier": async (rest) => {
		await runPawBlockVerifierCommand(rest);
	},
	"complete-verification": async (rest) => {
		await runPawCompleteVerificationCommand(rest);
	},
	"prepare-checkpoint": async (rest) => {
		await runPawPrepareCheckpointCommand(rest);
	},
	rollback: async (rest) => {
		await runPawRollbackCommand(rest);
	},
	finalize: async (rest) => {
		await runPawFinalizeCommand(rest);
	},
	clean: handlePawClean,
};

export async function handlePawCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "paw") {
		return false;
	}

	const [, subcommand, ...rest] = args;

	if (subcommand === "--help" || subcommand === "-h") {
		printPawHelp();
		return true;
	}

	const handler = PAW_SUBCOMMAND_HANDLERS[subcommand ?? ""];
	if (!handler) {
		const command = subcommand ?? "(missing)";
		printPawCommandError(`Unknown Paw command: ${command}`);
		return true;
	}

	await handler(rest);
	return true;
}
