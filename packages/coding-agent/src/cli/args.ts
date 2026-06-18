/**
 * CLI argument parsing and help display
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import chalk from "chalk";
import { APP_NAME, CONFIG_DIR_NAME, ENV_AGENT_DIR, ENV_SESSION_DIR } from "../config.ts";
import type { ExtensionFlag } from "../core/extensions/types.ts";

export type Mode = "text" | "json" | "rpc";

export interface Args {
	provider?: string;
	model?: string;
	apiKey?: string;
	systemPrompt?: string;
	appendSystemPrompt?: string[];
	thinking?: ThinkingLevel;
	continue?: boolean;
	resume?: boolean;
	help?: boolean;
	version?: boolean;
	mode?: Mode;
	name?: string;
	noSession?: boolean;
	session?: string;
	sessionId?: string;
	fork?: string;
	sessionDir?: string;
	models?: string[];
	tools?: string[];
	excludeTools?: string[];
	noTools?: boolean;
	noBuiltinTools?: boolean;
	extensions?: string[];
	noExtensions?: boolean;
	print?: boolean;
	export?: string;
	noSkills?: boolean;
	skills?: string[];
	promptTemplates?: string[];
	noPromptTemplates?: boolean;
	themes?: string[];
	noThemes?: boolean;
	noContextFiles?: boolean;
	listModels?: string | true;
	offline?: boolean;
	verbose?: boolean;
	projectTrustOverride?: boolean;
	messages: string[];
	fileArgs: string[];
	/** Unknown flags (potentially extension flags) - map of flag name to value */
	unknownFlags: Map<string, boolean | string>;
	diagnostics: Array<{ type: "warning" | "error"; message: string }>;
}

const VALID_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

export function isValidThinkingLevel(level: string): level is ThinkingLevel {
	return VALID_THINKING_LEVELS.includes(level as ThinkingLevel);
}

/**
 * Split a comma-separated list into trimmed, non-empty entries.
 */
function splitCsvList(value: string): string[] {
	return value
		.split(",")
		.map((s) => s.trim())
		.filter((name) => name.length > 0);
}

/**
 * Consume the next arg as a value for a flag. Returns the new index, or -1 if
 * no value is available (caller should record a diagnostic).
 */
function consumeValueArg(args: string[], i: number): { value: string; nextIndex: number } | undefined {
	if (i + 1 >= args.length) return undefined;
	return { value: args[i + 1], nextIndex: i + 1 };
}

/**
 * Try to consume the next arg as a strict flag value: a value is taken when
 * the following arg exists and does not start with "-" or "@". Used for
 * unknown long flags and --list-models.
 */
function consumeOptionalValueArg(args: string[], i: number): { value: string; nextIndex: number } | undefined {
	const next = args[i + 1];
	if (next === undefined || next.startsWith("-") || next.startsWith("@")) return undefined;
	return { value: next, nextIndex: i + 1 };
}

/**
 * Try to consume the next arg as a permissive value: a value is taken unless
 * it is missing, starts with "@", or starts with "-" without also being a
 * "---" triple-dash form. Used by --print, which intentionally accepts
 * user-supplied values that look like extra "dash" words.
 */
function consumePermissiveValueArg(args: string[], i: number): { value: string; nextIndex: number } | undefined {
	const next = args[i + 1];
	if (next === undefined || next.startsWith("@")) return undefined;
	if (next.startsWith("-") && !next.startsWith("---")) return undefined;
	return { value: next, nextIndex: i + 1 };
}

/** Set a boolean field on the result. */
function setBoolean<K extends keyof Args>(result: Args, key: K, value: Args[K]): void {
	result[key] = value;
}

/** Append a value to a (possibly uninitialised) array field on the result. */
function appendArrayField(
	result: Args,
	key: "appendSystemPrompt" | "extensions" | "skills" | "promptTemplates" | "themes",
	value: string,
): void {
	const list = (result[key] as string[] | undefined) ?? [];
	list.push(value);
	(result as unknown as Record<string, string[]>)[key] = list;
}

export function parseArgs(args: string[]): Args {
	const result: Args = {
		messages: [],
		fileArgs: [],
		unknownFlags: new Map(),
		diagnostics: [],
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		const next = dispatchArg(arg, args, i, result);
		if (next !== undefined) {
			i = next;
			continue;
		}

		if (arg.startsWith("@")) {
			result.fileArgs.push(arg.slice(1)); // Remove @ prefix
		} else if (arg.startsWith("--")) {
			i = handleUnknownLongFlag(arg, args, i, result);
		} else if (arg.startsWith("-") && !arg.startsWith("--")) {
			result.diagnostics.push({ type: "error", message: `Unknown option: ${arg}` });
		} else if (!arg.startsWith("-")) {
			result.messages.push(arg);
		}
	}

	return result;
}

/**
 * Dispatch a recognised argument to the matching handler.
 * @returns the new index when the handler consumes extra args, or undefined
 *          when the argument is not a known flag and should fall through to
 *          the unknown-flag/positional handling below.
 */
type ArgHandler = (args: string[], i: number, result: Args) => number | undefined;

const BOOLEAN_FLAGS: Record<string, [keyof Args, boolean]> = {
	"--help": ["help", true],
	"-h": ["help", true],
	"--version": ["version", true],
	"-v": ["version", true],
	"--continue": ["continue", true],
	"-c": ["continue", true],
	"--resume": ["resume", true],
	"-r": ["resume", true],
	"--no-session": ["noSession", true],
	"--no-tools": ["noTools", true],
	"-nt": ["noTools", true],
	"--no-builtin-tools": ["noBuiltinTools", true],
	"-nbt": ["noBuiltinTools", true],
	"--no-extensions": ["noExtensions", true],
	"-ne": ["noExtensions", true],
	"--no-skills": ["noSkills", true],
	"-ns": ["noSkills", true],
	"--no-prompt-templates": ["noPromptTemplates", true],
	"-np": ["noPromptTemplates", true],
	"--no-themes": ["noThemes", true],
	"--no-context-files": ["noContextFiles", true],
	"-nc": ["noContextFiles", true],
	"--verbose": ["verbose", true],
	"--offline": ["offline", true],
	"--approve": ["projectTrustOverride", true],
	"-a": ["projectTrustOverride", true],
	"--no-approve": ["projectTrustOverride", false],
	"-na": ["projectTrustOverride", false],
};

const VALUE_HANDLERS: Record<string, ArgHandler> = {
	"--mode": handleMode,
	"--provider": (args, i, result) => handleStringValue(args, i, result, "provider"),
	"--model": (args, i, result) => handleStringValue(args, i, result, "model"),
	"--api-key": (args, i, result) => handleStringValue(args, i, result, "apiKey"),
	"--system-prompt": (args, i, result) => handleStringValue(args, i, result, "systemPrompt"),
	"--append-system-prompt": (args, i, result) => handleAppendList(args, i, result, "appendSystemPrompt"),
	"--name": handleName,
	"-n": handleName,
	"--session": (args, i, result) => handleStringValue(args, i, result, "session"),
	"--session-id": (args, i, result) => handleStringValue(args, i, result, "sessionId"),
	"--fork": (args, i, result) => handleStringValue(args, i, result, "fork"),
	"--session-dir": (args, i, result) => handleStringValue(args, i, result, "sessionDir"),
	"--models": (args, i, result) =>
		handleStringValue(args, i, result, "models", (v) => v.split(",").map((s) => s.trim())),
	"--tools": (args, i, result) => handleStringValue(args, i, result, "tools", splitCsvList),
	"-t": (args, i, result) => handleStringValue(args, i, result, "tools", splitCsvList),
	"--exclude-tools": (args, i, result) => handleStringValue(args, i, result, "excludeTools", splitCsvList),
	"-xt": (args, i, result) => handleStringValue(args, i, result, "excludeTools", splitCsvList),
	"--thinking": handleThinking,
	"--print": handlePrint,
	"-p": handlePrint,
	"--export": (args, i, result) => handleStringValue(args, i, result, "export"),
	"--extension": (args, i, result) => handleAppendList(args, i, result, "extensions"),
	"-e": (args, i, result) => handleAppendList(args, i, result, "extensions"),
	"--skill": (args, i, result) => handleAppendList(args, i, result, "skills"),
	"--prompt-template": (args, i, result) => handleAppendList(args, i, result, "promptTemplates"),
	"--theme": (args, i, result) => handleAppendList(args, i, result, "themes"),
	"--list-models": handleListModels,
};

function dispatchArg(arg: string, args: string[], i: number, result: Args): number | undefined {
	const booleanEntry = BOOLEAN_FLAGS[arg];
	if (booleanEntry) {
		const [key, value] = booleanEntry;
		return finishBoolean(result, key, value, i);
	}
	const valueHandler = VALUE_HANDLERS[arg];
	if (valueHandler) {
		return valueHandler(args, i, result);
	}
	return undefined;
}

/** Set a boolean field and return the unchanged index. */
function finishBoolean<K extends keyof Args>(result: Args, key: K, value: Args[K], i: number): number {
	setBoolean(result, key, value);
	return i;
}

/** Consume a string value for a flag, recording a diagnostic if missing. */
function handleStringValue<K extends keyof Args>(
	args: string[],
	i: number,
	result: Args,
	key: K,
	transform?: (value: string) => Args[K],
): number {
	const consumed = consumeValueArg(args, i);
	if (!consumed) return i;
	const value = transform ? transform(consumed.value) : (consumed.value as unknown as Args[K]);
	(result as unknown as Record<string, unknown>)[key as string] = value;
	return consumed.nextIndex;
}

/** Consume a value and append it to a list-style field. */
function handleAppendList(
	args: string[],
	i: number,
	result: Args,
	key: "appendSystemPrompt" | "extensions" | "skills" | "promptTemplates" | "themes",
): number {
	const consumed = consumeValueArg(args, i);
	if (!consumed) return i;
	appendArrayField(result, key, consumed.value);
	return consumed.nextIndex;
}

/** --name requires a value; emit a diagnostic if missing. */
function handleName(args: string[], i: number, result: Args): number {
	const consumed = consumeValueArg(args, i);
	if (!consumed) {
		result.diagnostics.push({ type: "error", message: "--name requires a value" });
		return i;
	}
	result.name = consumed.value;
	return consumed.nextIndex;
}

/** --mode accepts only a known value; silently ignored when invalid. */
function handleMode(args: string[], i: number, result: Args): number {
	const consumed = consumeValueArg(args, i);
	if (!consumed) return i;
	const mode = consumed.value;
	if (mode === "text" || mode === "json" || mode === "rpc") {
		result.mode = mode;
	}
	return consumed.nextIndex;
}

/** --thinking validates the value and emits a warning on invalid input. */
function handleThinking(args: string[], i: number, result: Args): number {
	const consumed = consumeValueArg(args, i);
	if (!consumed) return i;
	const level = consumed.value;
	if (isValidThinkingLevel(level)) {
		result.thinking = level;
	} else {
		result.diagnostics.push({
			type: "warning",
			message: `Invalid thinking level "${level}". Valid values: ${VALID_THINKING_LEVELS.join(", ")}`,
		});
	}
	return consumed.nextIndex;
}

/**
 * --print enables print mode and may consume the next arg as the prompt
 * when it doesn't look like a flag or @file.
 */
function handlePrint(args: string[], i: number, result: Args): number {
	result.print = true;
	const consumed = consumePermissiveValueArg(args, i);
	if (consumed) {
		result.messages.push(consumed.value);
		return consumed.nextIndex;
	}
	return i;
}

/**
 * --list-models accepts an optional search pattern; without one it acts as a
 * boolean flag.
 */
function handleListModels(args: string[], i: number, result: Args): number {
	const consumed = consumeOptionalValueArg(args, i);
	if (consumed) {
		result.listModels = consumed.value;
		return consumed.nextIndex;
	}
	result.listModels = true;
	return i;
}

/**
 * Handle an unknown long flag: parse the flag name, optional =value, and
 * optional following positional value. Returns the new index.
 */
function handleUnknownLongFlag(arg: string, args: string[], i: number, result: Args): number {
	const eqIndex = arg.indexOf("=");
	if (eqIndex !== -1) {
		result.unknownFlags.set(arg.slice(2, eqIndex), arg.slice(eqIndex + 1));
		return i;
	}
	const flagName = arg.slice(2);
	const consumed = consumeOptionalValueArg(args, i);
	if (consumed) {
		result.unknownFlags.set(flagName, consumed.value);
		return consumed.nextIndex;
	}
	result.unknownFlags.set(flagName, true);
	return i;
}

export function printHelp(extensionFlags?: ExtensionFlag[]): void {
	const extensionFlagsText =
		extensionFlags && extensionFlags.length > 0
			? `\n${chalk.bold("Extension CLI Flags:")}\n${extensionFlags
					.map((flag) => {
						const value = flag.type === "string" ? " <value>" : "";
						const description = flag.description ?? `Registered by ${flag.extensionPath}`;
						return `  --${flag.name}${value}`.padEnd(30) + description;
					})
					.join("\n")}\n`
			: "";
	console.log(`${chalk.bold(APP_NAME)} - AI coding assistant with read, bash, edit, write tools

${chalk.bold("Usage:")}
  ${APP_NAME} [options] [@files...] [messages...]

${chalk.bold("Commands:")}
  ${APP_NAME} install <source> [-l]     Install extension source and add to settings
  ${APP_NAME} remove <source> [-l]      Remove extension source from settings
  ${APP_NAME} uninstall <source> [-l]   Alias for remove
  ${APP_NAME} update [source|self|pi]   Update pi and installed extensions
  ${APP_NAME} list                      List installed extensions from settings
  ${APP_NAME} config                    Open TUI to enable/disable package resources
  ${APP_NAME} paw init                  Initialize Paw durable project files under .paw
  ${APP_NAME} <command> --help          Show help for install/remove/uninstall/update/list

${chalk.bold("Options:")}
  --provider <name>              Provider name (default: google)
  --model <pattern>              Model pattern or ID (supports "provider/id" and optional ":<thinking>")
  --api-key <key>                API key (defaults to env vars)
  --system-prompt <text>         System prompt (default: coding assistant prompt)
  --append-system-prompt <text>  Append text or file contents to the system prompt (can be used multiple times)
  --mode <mode>                  Output mode: text (default), json, or rpc
  --print, -p                    Non-interactive mode: process prompt and exit
  --continue, -c                 Continue previous session
  --resume, -r                   Select a session to resume
  --session <path|id>            Use specific session file or partial UUID
  --session-id <id>              Use exact project session ID, creating it if missing
  --fork <path|id>               Fork specific session file or partial UUID into a new session
  --session-dir <dir>            Directory for session storage and lookup
  --no-session                   Don't save session (ephemeral)
  --name, -n <name>              Set session display name
  --models <patterns>            Comma-separated model patterns for Ctrl+P cycling
                                 Supports globs (anthropic/*, *sonnet*) and fuzzy matching
  --no-tools, -nt                Disable all tools by default (built-in and extension)
  --no-builtin-tools, -nbt       Disable built-in tools by default but keep extension/custom tools enabled
  --tools, -t <tools>            Comma-separated allowlist of tool names to enable
                                 Applies to built-in, extension, and custom tools
  --exclude-tools, -xt <tools>   Comma-separated denylist of tool names to disable
                                 Applies to built-in, extension, and custom tools
  --thinking <level>             Set thinking level: off, minimal, low, medium, high, xhigh
  --extension, -e <path>         Load an extension file (can be used multiple times)
  --no-extensions, -ne           Disable extension discovery (explicit -e paths still work)
  --skill <path>                 Load a skill file or directory (can be used multiple times)
  --no-skills, -ns               Disable skills discovery and loading
  --prompt-template <path>       Load a prompt template file or directory (can be used multiple times)
  --no-prompt-templates, -np     Disable prompt template discovery and loading
  --theme <path>                 Load a theme file or directory (can be used multiple times)
  --no-themes                    Disable theme discovery and loading
  --no-context-files, -nc        Disable AGENTS.md and CLAUDE.md discovery and loading
  --export <file>                Export session file to HTML and exit
  --list-models [search]         List available models (with optional fuzzy search)
  --verbose                      Force verbose startup (overrides quietStartup setting)
  --approve, -a                  Trust project-local files for this run
  --no-approve, -na              Ignore project-local files for this run
  --offline                      Disable startup network operations (same as PI_OFFLINE=1)
  --help, -h                     Show this help
  --version, -v                  Show version number

Extensions can register additional flags (e.g., --plan from plan-mode extension).${extensionFlagsText}

${chalk.bold("Examples:")}
  # Interactive mode
  ${APP_NAME}

  # Interactive mode with initial prompt
  ${APP_NAME} "List all .ts files in src/"

  # Include files in initial message
  ${APP_NAME} @prompt.md @image.png "What color is the sky?"

  # Non-interactive mode (process and exit)
  ${APP_NAME} -p "List all .ts files in src/"

  # Multiple messages (interactive)
  ${APP_NAME} "Read package.json" "What dependencies do we have?"

  # Continue previous session
  ${APP_NAME} --continue "What did we discuss?"

  # Start a named session
  ${APP_NAME} --name "Refactor auth module"

  # Use different model
  ${APP_NAME} --provider openai --model gpt-4o-mini "Help me refactor this code"

  # Use model with provider prefix (no --provider needed)
  ${APP_NAME} --model openai/gpt-4o "Help me refactor this code"

  # Use model with thinking level shorthand
  ${APP_NAME} --model sonnet:high "Solve this complex problem"

  # Limit model cycling to specific models
  ${APP_NAME} --models claude-sonnet,claude-haiku,gpt-4o

  # Limit to a specific provider with glob pattern
  ${APP_NAME} --models "github-copilot/*"

  # Cycle models with fixed thinking levels
  ${APP_NAME} --models sonnet:high,haiku:low

  # Start with a specific thinking level
  ${APP_NAME} --thinking high "Solve this complex problem"

  # Read-only mode (no file modifications possible)
  ${APP_NAME} --tools read,grep,find,ls -p "Review the code in src/"

  # Disable one tool while keeping the rest available
  ${APP_NAME} --exclude-tools ask_question

  # Export a session file to HTML
  ${APP_NAME} --export ~/${CONFIG_DIR_NAME}/agent/sessions/--path--/session.jsonl
  ${APP_NAME} --export session.jsonl output.html

${chalk.bold("Environment Variables:")}
  ANTHROPIC_API_KEY                - Anthropic Claude API key
  ANTHROPIC_OAUTH_TOKEN            - Anthropic OAuth token (alternative to API key)
  ANT_LING_API_KEY                 - Ant Ling API key
  OPENAI_API_KEY                   - OpenAI GPT API key
  AZURE_OPENAI_API_KEY             - Azure OpenAI API key
  AZURE_OPENAI_BASE_URL            - Azure OpenAI/Cognitive Services base URL (e.g. https://{resource}.openai.azure.com)
  AZURE_OPENAI_RESOURCE_NAME       - Azure OpenAI resource name (alternative to base URL)
  AZURE_OPENAI_API_VERSION         - Azure OpenAI API version (default: v1)
  AZURE_OPENAI_DEPLOYMENT_NAME_MAP - Azure OpenAI model=deployment map (comma-separated)
  DEEPSEEK_API_KEY                 - DeepSeek API key
  NVIDIA_API_KEY                   - NVIDIA NIM API key
  GEMINI_API_KEY                   - Google Gemini API key
  GROQ_API_KEY                     - Groq API key
  CEREBRAS_API_KEY                 - Cerebras API key
  XAI_API_KEY                      - xAI Grok API key
  FIREWORKS_API_KEY                - Fireworks API key
  TOGETHER_API_KEY                 - Together AI API key
  OPENROUTER_API_KEY               - OpenRouter API key
  AI_GATEWAY_API_KEY               - Vercel AI Gateway API key
  ZAI_API_KEY                      - ZAI API key
  ZAI_CODING_CN_API_KEY            - ZAI Coding Plan API key (China)
  MISTRAL_API_KEY                  - Mistral API key
  MINIMAX_API_KEY                  - MiniMax API key
  MOONSHOT_API_KEY                 - Moonshot AI API key
  OPENCODE_API_KEY                 - OpenCode Zen/OpenCode Go API key
  KIMI_API_KEY                     - Kimi For Coding API key
  CLOUDFLARE_API_KEY               - Cloudflare API token (Workers AI and AI Gateway)
  CLOUDFLARE_ACCOUNT_ID            - Cloudflare account id (required for both)
  CLOUDFLARE_GATEWAY_ID            - Cloudflare AI Gateway slug (required for AI Gateway)
  XIAOMI_API_KEY                   - Xiaomi MiMo API key (api.xiaomimimo.com billing)
  XIAOMI_TOKEN_PLAN_CN_API_KEY     - Xiaomi MiMo Token Plan API key (China region)
  XIAOMI_TOKEN_PLAN_AMS_API_KEY    - Xiaomi MiMo Token Plan API key (Amsterdam region)
  XIAOMI_TOKEN_PLAN_SGP_API_KEY    - Xiaomi MiMo Token Plan API key (Singapore region)
  AWS_PROFILE                      - AWS profile for Amazon Bedrock
  AWS_ACCESS_KEY_ID                - AWS access key for Amazon Bedrock
  AWS_SECRET_ACCESS_KEY            - AWS secret key for Amazon Bedrock
  AWS_BEARER_TOKEN_BEDROCK         - Bedrock API key (bearer token)
  AWS_REGION                       - AWS region for Amazon Bedrock (e.g., us-east-1)
  ${ENV_AGENT_DIR.padEnd(32)} - Config directory (default: ~/${CONFIG_DIR_NAME}/agent)
  ${ENV_SESSION_DIR.padEnd(32)} - Session storage directory (overridden by --session-dir)
  PI_PACKAGE_DIR                   - Override package directory (for Nix/Guix store paths)
  PI_OFFLINE                       - Disable startup network operations when set to 1/true/yes
  PI_TELEMETRY                     - Override install telemetry when set to 1/true/yes or 0/false/no
  PI_SHARE_VIEWER_URL              - Base URL for /share command (default: https://pi.dev/session/)

${chalk.bold("Built-in Tool Names:")}
  read   - Read file contents
  bash   - Execute bash commands
  edit   - Edit files with find/replace
  write  - Write files (creates/overwrites)
  grep   - Search file contents (read-only, off by default)
  find   - Find files by glob pattern (read-only, off by default)
  ls     - List directory contents (read-only, off by default)
`);
}
