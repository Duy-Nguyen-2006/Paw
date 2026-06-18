
# Changelog

## [Unreleased]

### Fixed

- Fixed inherited Google and `google-vertex` Gemini model metadata to map `latest` aliases to the current models, add Gemini 3.5 Flash for Vertex, correct Gemini 2.5 Flash Vertex cache pricing, and remove shut-down Vertex preview models ([#5761](https://github.com/earendil-works/pi/issues/5761)).
- Fixed the session selector to stay open and show the all-sessions empty state when both current-folder and all-scope session lists are empty ([#5747](https://github.com/earendil-works/pi/issues/5747)).
- Fixed inherited Moonshot AI China model metadata to include Kimi K2.7 Code, and omitted unsupported thinking-off payloads for Kimi K2.7 Code models ([#5760](https://github.com/earendil-works/pi/issues/5760)).

## [0.79.4] - 2026-06-15

### New Features

- **Automatic first-run theme selection** - pi detects the terminal background on first run and defaults to the `dark` or `light` theme. See [Selecting a Theme](docs/themes.md#selecting-a-theme).
- **Standalone binary integrity checksums** - GitHub release assets now include `SHA256SUMS` files for verifying standalone binary downloads. See [Quickstart Install](docs/quickstart.md#install).

### Added

- Added `SHA256SUMS` integrity files to standalone binary GitHub release assets ([#5739](https://github.com/earendil-works/pi/issues/5739)).
- Added first-run interactive theme detection from the terminal background ([#5385](https://github.com/earendil-works/pi/pull/5385) by [@vegarsti](https://github.com/vegarsti)).

### Fixed

- Fixed bash tool output collection to keep draining stdout/stderr after the child exits while descendants still write, avoiding truncated late output ([#5753](https://github.com/earendil-works/pi/pull/5753) by [@Mearman](https://github.com/Mearman)).
- Fixed `/tree` help rendering to show compact wrapped controls instead of truncating them on narrow terminals ([#5055](https://github.com/earendil-works/pi/issues/5055)).
- Fixed SIGTERM/SIGHUP interactive shutdown to keep signal handlers installed until terminal cleanup completes, preventing `signal-exit` from re-sending the signal and leaving the terminal in raw/Kitty keyboard mode ([#5724](https://github.com/earendil-works/pi/issues/5724)).
- Fixed extensions documentation to clarify that `pi.getActiveTools()` returns active tool names while `pi.getAllTools()` returns tool metadata ([#5729](https://github.com/earendil-works/pi/issues/5729)).
- Fixed question and questionnaire extension examples to wrap long prompt, option, and help text instead of truncating it ([#5708](https://github.com/earendil-works/pi/pull/5708) by [@xl0](https://github.com/xl0)).
- Fixed package commands such as `pi list`, `pi install`, and `pi update` to terminate after completing even if an extension leaves background handles open ([#5687](https://github.com/earendil-works/pi/issues/5687)).
- Fixed `pi update` for pnpm global installs whose configured `global-bin-dir` no longer matches the active pnpm home ([#5689](https://github.com/earendil-works/pi/issues/5689)).
- Fixed npm package specs that use ranges or tags (for example `@^1.2.7`) so installed package resources still load instead of being treated as mismatched exact pins ([#5695](https://github.com/earendil-works/pi/issues/5695)).
- Fixed inherited Anthropic 1-hour prompt-cache write cost accounting to price 1-hour cache writes at 2x input instead of the 5-minute cache-write rate ([#5738](https://github.com/earendil-works/pi/pull/5738) by [@theBucky](https://github.com/theBucky)).
- Fixed inherited GitHub Copilot Claude adaptive-thinking effort metadata to match manually checked Copilot model capabilities ([#4637](https://github.com/earendil-works/pi/issues/4637)).
- Fixed inherited OpenCode/OpenCode Go completion model metadata to omit long-retention cache fields for routes that reject `prompt_cache_retention` ([#5702](https://github.com/earendil-works/pi/issues/5702)).
- Fixed inherited overlay compositing over CJK wide characters so borders stay aligned when an overlay starts inside a full-width cell ([#5297](https://github.com/earendil-works/pi/issues/5297)).
- Fixed inherited WezTerm inline Kitty image rendering during full redraw fallbacks so image padding rows are reserved before the placement is drawn without regressing tall-image placement ([#5618](https://github.com/earendil-works/pi/issues/5618), [#4415](https://github.com/earendil-works/pi/issues/4415)).
- Fixed custom provider config so plain uppercase API key and header values remain literals instead of being treated as legacy environment references; use explicit `$ENV_VAR` syntax for environment variables ([#5661](https://github.com/earendil-works/pi/issues/5661)).

## [0.79.3] - 2026-06-13

### Fixed

- Fixed inherited OpenAI GPT-5.4/GPT-5.5 and OpenAI Codex GPT-5.4/GPT-5.4 mini/GPT-5.5 context window metadata to use the observed 272k-token Codex backend limit, avoiding a billing hazard from prompts above Codex's accepted limit (reported by [@trethore](https://github.com/trethore)).

## [0.79.2] - 2026-06-12

### New Features

- **Clearer Bedrock validation guidance** - Amazon Bedrock data retention validation errors now link to AWS data retention documentation. See [Amazon Bedrock](docs/providers.md#amazon-bedrock).

### Added

- Added an experimental first-time setup flow behind `PI_EXPERIMENTAL=1` that asks for a dark/light theme choice (preselecting the detected appearance) and opt-in analytics data sharing on first launch with the default agent directory; opting in stores a `trackingId` in `settings.json` ([#5587](https://github.com/earendil-works/pi/pull/5587) by [@vegarsti](https://github.com/vegarsti)).
- Added AWS data retention documentation links to inherited Amazon Bedrock unsupported data retention mode validation errors ([#5561](https://github.com/earendil-works/pi/pull/5561) by [@unexge](https://github.com/unexge)).

### Fixed

- Fixed project trust detection to ignore global `~/.pi/agent` state when running from `$HOME`, and made `pi update` use only saved or explicit project trust without prompting ([#5619](https://github.com/earendil-works/pi/issues/5619)).
- Fixed experimental first-time setup to skip forked sessions instead of rerunning the setup prompts ([#5627](https://github.com/earendil-works/pi/pull/5627) by [@vegarsti](https://github.com/vegarsti)).
- Fixed inherited OpenAI-compatible context overflow detection for parenthesized `maximum context length (N)` errors ([#5677](https://github.com/earendil-works/pi/issues/5677)).
- Fixed inherited OpenAI GPT-5.4/GPT-5.5 and OpenAI Codex GPT-5.4/GPT-5.4 mini/GPT-5.5 context window metadata to match current OpenAI limits ([#5644](https://github.com/earendil-works/pi/issues/5644)).
- Fixed inherited Anthropic refusal stops to preserve provider `stop_details` explanations in error messages ([#5666](https://github.com/earendil-works/pi/pull/5666) by [@rwachtler](https://github.com/rwachtler)).
- Increased the inherited OpenAI Codex Responses SSE response-header timeout to 20 seconds to reduce false-positive stalls while retaining the bounded wait introduced for zero-event hangs ([#4945](https://github.com/earendil-works/pi/issues/4945)).
- Fixed inherited Claude Fable 5 thinking-off requests to omit Anthropic's unsupported `thinking.type: "disabled"` payload ([#5567](https://github.com/earendil-works/pi/pull/5567) by [@tmustier](https://github.com/tmustier)).
- Fixed inherited late tool progress callbacks after tool settlement to be ignored instead of emitting stale `tool_execution_update` events ([#5573](https://github.com/earendil-works/pi/issues/5573)).
- Fixed inherited user-message transcript rendering so standalone `+` messages no longer render as `-` ([#5657](https://github.com/earendil-works/pi/issues/5657)).
- Fixed inherited slash-separated fuzzy queries so provider/model completions remain matchable after insertion.
- Fixed inherited WezTerm inline Kitty image rendering so reserved row clears do not erase all but the top strip of tool image previews ([#5618](https://github.com/earendil-works/pi/issues/5618)).
- Fixed inherited editor wrapping for CJK text to break at character boundaries instead of leaving large trailing gaps ([#5585](https://github.com/earendil-works/pi/pull/5585) by [@haoqixu](https://github.com/haoqixu)).
- Fixed inherited loose Markdown list rendering to preserve blank-line separation between list items ([#5562](https://github.com/earendil-works/pi/pull/5562) by [@Perlence](https://github.com/Perlence)).
- Fixed `--model` resolution for authenticated custom model IDs whose slash prefix matches an unauthenticated built-in provider ([#5643](https://github.com/earendil-works/pi/issues/5643)).
- Fixed `/fork` to keep session parent chains connected when the forked path contains labels ([#5669](https://github.com/earendil-works/pi/issues/5669)).
- Fixed `/share` and `/export` HTML exports to use the active fallback theme when the configured custom theme no longer exists ([#5596](https://github.com/earendil-works/pi/issues/5596)).
- Fixed custom fallback model IDs with `:<thinking>` suffixes to preserve the requested thinking level when the provider template model does not advertise reasoning ([#5560](https://github.com/earendil-works/pi/pull/5560) by [@haoqixu](https://github.com/haoqixu)).

## [0.79.1] - 2026-06-09

### New Features

- **Claude Fable 5** - Claude Fable 5 is now available on the Anthropic and Amazon Bedrock providers, with adaptive thinking and `xhigh` effort support.
- **Prompt template defaults** - Prompt templates can use default positional arguments such as `${1:-7}` for optional values. See [Prompt Template Arguments](docs/prompt-templates.md#arguments).
- **Configurable project trust defaults** - `defaultProjectTrust` lets users choose whether unresolved project trust asks, always trusts, or never trusts by default, and extensions can inspect effective trust decisions. See [Project Trust](docs/security.md#project-trust) and [`ctx.isProjectTrusted()`](docs/extensions.md#ctxisprojecttrusted).
- **Natural extension autocomplete triggers** - Extension autocomplete providers can declare trigger characters such as `#` or `$` so suggestions open without slash-command prefixes. See [Autocomplete Providers](docs/extensions.md#autocomplete-providers).

### Added

- Added default-value expansion for prompt template positional arguments, e.g. `${1:-7}` ([#5553](https://github.com/earendil-works/pi/pull/5553) by [@dannote](https://github.com/dannote)).
- Added `areExperimentalFeaturesEnabled` feature guard to allow users to opt in to early features ([#5547](https://github.com/earendil-works/pi/pull/5547) by [@vegarsti](https://github.com/vegarsti)).
- Added `ctx.isProjectTrusted()` for extensions to observe the effective project trust decision, including temporary trust decisions ([#5523](https://github.com/earendil-works/pi/issues/5523)).
- Added a global `defaultProjectTrust` setting to choose whether unresolved project trust asks, always trusts, or never trusts by default.
- Added extension autocomplete trigger character support for `ctx.ui.addAutocompleteProvider()` wrappers ([#4703](https://github.com/earendil-works/pi/issues/4703)).
- Added Claude Fable 5 model support inherited from `@earendil-works/pi-ai` for the Anthropic and Amazon Bedrock providers, with adaptive thinking and `xhigh` effort support.

### Fixed

- Fixed inherited Amazon Bedrock inference profile ARN region resolution to prefer the ARN's embedded region over `AWS_REGION` ([#5527](https://github.com/earendil-works/pi/pull/5527) by [@AJM10565](https://github.com/AJM10565)).
- Fixed inherited IME hardware cursor positioning while slash-command autocomplete is visible ([#5283](https://github.com/earendil-works/pi/pull/5283) by [@smoosex](https://github.com/smoosex)).
- Fixed inherited z.ai thinking-off requests to send the provider's `thinking: { type: "disabled" }` compatibility parameter ([#5330](https://github.com/earendil-works/pi/issues/5330)).
- Fixed inherited OpenCode completions model metadata to send explicit `maxTokens` as `max_tokens` ([#5331](https://github.com/earendil-works/pi/issues/5331)).
- Fixed inherited Moonshot Kimi thinking-off requests to send the provider's `thinking: { type: "disabled" }` compatibility parameter ([#5531](https://github.com/earendil-works/pi/issues/5531)).
- Fixed inherited Azure OpenAI Responses requests to disable server-side response storage ([#5530](https://github.com/earendil-works/pi/issues/5530)).
- Fixed inherited Azure GPT-5.4 and GPT-5.5 context window metadata to 1,050,000 tokens, matching Azure Foundry deployments instead of OpenAI's 272k limit ([#5559](https://github.com/earendil-works/pi/issues/5559)).
- Fixed inherited OpenAI and Azure GPT-5 Pro `maxTokens` metadata to 128,000, correcting an upstream value that duplicated the input sub-limit as the output limit ([#5559](https://github.com/earendil-works/pi/issues/5559)).
- Fixed inherited prompt history navigation to restore the current draft when returning from history browsing ([#5494](https://github.com/earendil-works/pi/issues/5494)).
- Fixed inherited wrapping for mixed Latin and CJK text so unspaced CJK runs can break at grapheme boundaries without leaving large trailing gaps ([#5495](https://github.com/earendil-works/pi/issues/5495)).
- Fixed extension OAuth login prompts to keep previous submitted prompt rows stable instead of mirroring the active input value ([#5433](https://github.com/earendil-works/pi/issues/5433)).
- Fixed `/reload` to apply updated `steeringMode` and `followUpMode` settings to the current session ([#5377](https://github.com/earendil-works/pi/issues/5377)).
- Fixed invalid `models.json` syntax to skip startup config migrations and report the normal file-path-aware models error instead of a raw JSON parse stack trace ([#5418](https://github.com/earendil-works/pi/issues/5418)).
- Fixed GitHub release notes and interactive changelog links to resolve package-relative documentation URLs correctly ([#5516](https://github.com/earendil-works/pi/issues/5516)).
- Fixed CLI help and version output, including plain redirected `--help`/`--version` output and simplified `list`/`config` help text.
- Fixed `/new` from ephemeral sessions to keep the new session ephemeral instead of persisting it by default ([#5045](https://github.com/earendil-works/pi/issues/5045)).
- Clarified custom model docs that `name` and `modelOverrides.name` do not replace model IDs in the footer or primary model lists ([#4841](https://github.com/earendil-works/pi/issues/4841)).

## [0.79.0] - 2026-06-08

### New Features

- **Project trust for local inputs** - Pi now asks before loading project-local settings, resources, instructions, and packages, with saved decisions and `--approve` / `--no-approve` controls for non-interactive modes. See [Project Trust](README.md#project-trust).
- **Extension-controlled trust decisions** - Global and CLI extensions can handle `project_trust`, decide, remember, or defer project trust before project-local resources load. See [`project_trust`](docs/extensions.md#project_trust).
- **Cache-hit visibility in the footer** - The interactive footer now shows the latest prompt cache hit rate (`CH`). See [Interactive Mode](README.md#interactive-mode).
- **Richer SDK and RPC extension surfaces** - Public exports now include RPC extension UI request/response types and package asset path helpers. See [Extension UI Protocol](docs/rpc.md#extension-ui-protocol) and [SDK Exports](docs/sdk.md#exports).

### Added

- Added a `project_trust` extension event so global and CLI extensions can decide or defer project trust during startup and runtime cwd switches.
- Added project trust gating for project-local settings, resources, instructions, and packages ([#5332](https://github.com/earendil-works/pi/pull/5332)).
- Added the latest prompt cache hit rate to the interactive footer.
- Exported RPC extension UI request and response types from the public API ([#5455](https://github.com/earendil-works/pi/issues/5455)).
- Exported coding-agent package asset path helpers from the public API ([#5415](https://github.com/earendil-works/pi/issues/5415)).

### Fixed

- Fixed package exports by removing the stale `./hooks` subpath that pointed at non-existent build output.
- Fixed inherited TUI rendering to clear stale lines when content shrinks to zero.
- Fixed inherited autocomplete suggestions to refresh after editor cursor movement ([#5499](https://github.com/earendil-works/pi/pull/5499) by [@Roman-Galeev](https://github.com/Roman-Galeev)).
- Fixed `/reload` to persist project trust when an implicitly trusted session creates a project `.pi` directory.
- Fixed project trust input discovery to traverse parent directories portably.
- Fixed inherited intermittent Shift+Enter handling by making Kitty keyboard protocol fallback response-driven instead of timeout-driven ([#5188](https://github.com/earendil-works/pi/issues/5188)).
- Fixed the compaction summarization system prompt to use neutral AI assistant wording for non-coding agents ([#5401](https://github.com/earendil-works/pi/issues/5401)).
- Fixed `models.json` schema support and inherited OpenAI Responses custom-provider handling for `compat.supportsDeveloperRole: false` ([#5456](https://github.com/earendil-works/pi/issues/5456)).
- Fixed inherited prompt history navigation to place the cursor at the start when browsing upward and at the end when browsing downward ([#5454](https://github.com/earendil-works/pi/issues/5454)).
- Fixed tmux setup documentation to require tmux 3.5 for `extended-keys-format csi-u` and document the tmux 3.2-3.4 fallback ([#5432](https://github.com/earendil-works/pi/issues/5432)).
- Fixed inherited OpenRouter routing preferences on OpenAI-compatible custom providers to work when the custom provider base URL does not point directly at OpenRouter ([#5347](https://github.com/earendil-works/pi/issues/5347)).
- Fixed built-in tool expand hints to style closing parentheses consistently ([#5359](https://github.com/earendil-works/pi/issues/5359)).
- Fixed skill-wrapped prompts to insert spacing between skill instructions and the user message ([#5371](https://github.com/earendil-works/pi/pull/5371) by [@Perlence](https://github.com/Perlence)).

## [0.78.1] - 2026-06-04

### New Features

- **More built-in provider coverage** - Added Ant Ling and NVIDIA NIM provider setup, plus MiniMax-M3 support for the direct MiniMax providers. See [Providers](docs/providers.md).
- **Richer extension context** - Extensions can use `ctx.mode` and `ctx.getSystemPromptOptions()` to adapt behavior across TUI, RPC, JSON, and print modes and inspect base system prompt inputs. See [Extensions](docs/extensions.md).

### Added

- Added containerization documentation and a Gondolin extension example for routing built-in tools into a local micro-VM.
- Added Ant Ling provider selection and setup documentation.
- Added MiniMax-M3 model support inherited from `@earendil-works/pi-ai` for the `minimax` and `minimax-cn` direct providers ([#5313](https://github.com/earendil-works/pi/issues/5313)).
- Added NVIDIA NIM provider selection, setup documentation, and direct NIM request attribution headers.
- Added `ctx.mode` to extension contexts so extensions can distinguish TUI, RPC, JSON, and print mode.
- Added `ctx.getSystemPromptOptions()` for extension commands to inspect the current base system prompt inputs ([#5306](https://github.com/earendil-works/pi/pull/5306) by [@xl0](https://github.com/xl0)).

### Fixed

- Fixed temporary extension package installs to use a private `~/.pi/agent/tmp/extensions` directory with `0700` permissions instead of `os.tmpdir()/pi-extensions`.
- Fixed git package source handling to reject unsafe host/path components and keep managed clone paths inside install roots.
- Fixed stored XSS in HTML session exports by sanitizing Markdown link and image URLs with a scheme allow-list after stripping control characters.
- Fixed SDK embedding in bundled Node apps failing with `ENOENT` when `package.json` is not present next to the bundle entrypoint. The package metadata reader now gracefully handles missing `package.json` by using defaults, enabling `createAgentSession()` without requiring package-adjacent files at runtime ([#5226](https://github.com/earendil-works/pi/issues/5226)).
- Fixed HTTP timeout setting not being respected for non-Codex providers (e.g., llama.cpp via OpenAI-compatible API). The `httpIdleTimeoutMs` setting (set via `/settings` HTTP timeout) now applies as the default SDK request timeout for all providers that support it, not just OpenAI Codex Responses. Disabling the timeout (HTTP timeout = false) now correctly disables SDK timeouts for all supported providers by sending a maximum int32 value (effectively infinite) instead of 0, since SDKs treat timeout=0 as an immediate timeout ([#5294](https://github.com/earendil-works/pi/issues/5294)).
- Fixed inherited Amazon Bedrock requests to replace blank required user/tool-result text with a placeholder and skip blank replay text blocks ([#4975](https://github.com/earendil-works/pi/issues/4975)).
- Fixed inherited Anthropic Claude Opus 4.7+ requests to suppress deprecated temperature parameters ([#5251](https://github.com/earendil-works/pi/pull/5251) by [@yzhg1983](https://github.com/yzhg1983)).
- Fixed inherited OpenAI GPT-5.5 generated metadata to omit unsupported minimal thinking ([#5243](https://github.com/earendil-works/pi/issues/5243)).
- Fixed inherited OpenRouter Kimi K2.6 thinking replay and developer-role instruction handling ([#5309](https://github.com/earendil-works/pi/issues/5309)).
- Fixed inherited OpenRouter reasoning instruction requests to preserve the system role when required ([#5221](https://github.com/earendil-works/pi/pull/5221) by [@PriNova](https://github.com/PriNova)).
- Fixed inherited overlay focus restoration so non-capturing overlays remain interactive after UI rerenders and explicit focus release ([#5235](https://github.com/earendil-works/pi/pull/5235) by [@nicobailon](https://github.com/nicobailon)).
- Fixed inherited tab width accounting in column slicing and overlay compositing so tab-containing output cannot exceed the terminal width ([#5218](https://github.com/earendil-works/pi/issues/5218)).
- Fixed opening and listing very large JSONL session files by reading session entries line-by-line instead of materializing the full file as one string ([#5231](https://github.com/earendil-works/pi/issues/5231)).
- Fixed the footer branch display in WSL `/mnt/...` repositories to refresh after branch changes ([#5264](https://github.com/earendil-works/pi/pull/5264) by [@psoukie](https://github.com/psoukie)).
- Fixed `renderShell: "self"` tool renderers that emit no component lines leaving a blank chat row ([#5299](https://github.com/earendil-works/pi/issues/5299)).
- Restored inherited NVIDIA Qwen 3.5 122B NIM model support.

## [0.78.0] - 2026-05-29

### New Features

- **Named startup sessions** - `--name` / `-n` sets the session display name before startup across interactive, print, JSON, and RPC modes. See [Naming Sessions](docs/sessions.md#naming-sessions) and [Session Options](docs/usage.md#session-options).
- **Clickable file tool paths** - built-in file tool titles render OSC 8 `file://` hyperlinks when the terminal supports them, including supported tmux clients.

### Added

- Exported `convertToPng` for extension authors ([#5167](https://github.com/earendil-works/pi-mono/pull/5167) by [@xl0](https://github.com/xl0)).
- Exported `parseArgs` and type `Args` for extension authors ([#5202](https://github.com/earendil-works/pi-mono/pull/5202) by [@xl0](https://github.com/xl0)).
- Added `--name` / `-n` to set the session display name at startup ([#5153](https://github.com/earendil-works/pi-mono/issues/5153)).
- Added a resume command hint when exiting interactive sessions ([#5176](https://github.com/earendil-works/pi-mono/pull/5176) by [@yzhg1983](https://github.com/yzhg1983)).
- Added OSC 8 `file://` hyperlinks to file paths shown in built-in file tool titles ([#5189](https://github.com/earendil-works/pi-mono/pull/5189) by [@mpazik](https://github.com/mpazik)).
- Added custom Amazon Bedrock request header support inherited from `@earendil-works/pi-ai` ([#5178](https://github.com/earendil-works/pi-mono/pull/5178) by [@stephanmck](https://github.com/stephanmck)).

### Fixed

- Clarified the WezTerm/WSL IME hardware cursor docs to state that cursor visibility remains opt-in ([#5200](https://github.com/earendil-works/pi-mono/issues/5200)).
- Fixed the GitLab Duo custom provider example to use adaptive thinking for Claude models, expose xhigh thinking, and include newer verified model IDs ([#5201](https://github.com/earendil-works/pi-mono/issues/5201)).
- Fixed Bun release archive creation to install and copy the matching `@mariozechner/clipboard` base package and native sidecars ([#5184](https://github.com/earendil-works/pi-mono/issues/5184)).
- Fixed early interactive input typed before the prompt loop starts so it is buffered instead of dropped ([#5195](https://github.com/earendil-works/pi-mono/pull/5195) by [@yzhg1983](https://github.com/yzhg1983)).
- Fixed OpenRouter Moonshot Kimi K2.6 requests to use `system` instead of unsupported `developer` messages ([#5159](https://github.com/earendil-works/pi-mono/issues/5159)).
- Fixed OpenCode Go Kimi K2.6 thinking requests to send `thinking` objects instead of invalid string values, and fixed OpenCode Zen Grok Build thinking requests to omit unsupported `reasoning_effort` ([#5169](https://github.com/earendil-works/pi-mono/issues/5169)).
- Fixed OpenAI Codex Responses SSE streams to abort response body reads after terminal events.
- Fixed OpenCode Kimi K2.6 generated metadata to use Anthropic-style thinking metadata instead of invalid reasoning-effort parameters.
- Fixed OSC 8 hyperlinks to pass through tmux when the client supports them ([#5189](https://github.com/earendil-works/pi-mono/pull/5189) by [@mpazik](https://github.com/mpazik)).
- Fixed ANSI text wrapping to avoid stack overflows on very long wrapped lines ([#5185](https://github.com/earendil-works/pi-mono/issues/5185)).

## [0.77.0] - 2026-05-28

### New Features

- **Claude Opus 4.8 support** - Adds Anthropic Claude Opus 4.8 metadata and updates Opus adaptive-thinking coverage.
- **Selective tool disablement** - `--exclude-tools` / `-xt` disables specific built-in, extension, or custom tools while leaving the rest available. See [Tool Options](docs/usage.md#tool-options).
- **Headless Codex subscription login** - `/login` can use device-code auth for ChatGPT Plus/Pro Codex subscriptions. See [Subscriptions](docs/providers.md#subscriptions) and [OpenAI Codex](docs/providers.md#openai-codex).
- **Streaming-aware extension input** - extensions can distinguish idle prompts, mid-stream steers, and queued follow-ups with `InputEvent.streamingBehavior`. See [Input Events](docs/extensions.md#input-events).

### Added

- Added `--exclude-tools` / `-xt` to disable specific built-in, extension, or custom tools while leaving the rest available ([#5109](https://github.com/earendil-works/pi/issues/5109)).
- Added OpenAI Codex subscription device-code login as a selectable headless alternative while keeping browser login as the default ([#4911](https://github.com/earendil-works/pi/pull/4911) by [@vegarsti](https://github.com/vegarsti)).
- Added `streamingBehavior` to extension input events so extensions can distinguish idle prompts from mid-stream steers and queued follow-ups ([#5107](https://github.com/earendil-works/pi/pull/5107) by [@DanielThomas](https://github.com/DanielThomas)).
- Added Claude Opus 4.8 model metadata for Anthropic and updated Opus adaptive-thinking coverage to use it.

### Fixed

- Fixed startup timing output so `readPipedStdin` no longer includes `createAgentSessionRuntime` work ([#4829](https://github.com/earendil-works/pi/issues/4829)).
- Fixed OpenRouter DeepSeek V4 `xhigh` reasoning metadata to preserve OpenRouter's native effort instead of sending DeepSeek's `max` effort ([#4801](https://github.com/earendil-works/pi/issues/4801)).
- Fixed custom session directories so current-folder resume/continue lookups stay scoped to the active cwd while all-session listings cover the custom directory.
- Fixed SIGTERM/SIGHUP exits to run extension `session_shutdown` cleanup and restore the terminal: signal-triggered shutdown now emits `session_shutdown` before any terminal writes, and SIGHUP no longer hard-exits, so extension resources (e.g. sockets) are released even when the terminal is gone ([#5080](https://github.com/earendil-works/pi/issues/5080)).
- Fixed keyboard protocol negotiation to ignore mismatched or delayed terminal responses, avoiding false Kitty keyboard protocol detection ([#5091](https://github.com/earendil-works/pi/pull/5091) by [@mitsuhiko](https://github.com/mitsuhiko)).
- Fixed Windows startup crashes under MSYS2 ucrt64 Node.js by updating the native clipboard addon to napi-rs 3.x ([#5028](https://github.com/earendil-works/pi/issues/5028)).
- Fixed API key and header config resolution to treat plain strings as literals, support `$ENV_VAR` / `${ENV_VAR}` interpolation and `$!` bang escaping, and require explicit env syntax for config files, avoiding Windows case-insensitive env matches corrupting literal keys ([#5095](https://github.com/earendil-works/pi/issues/5095)).
- Fixed session disposal to abort in-flight agent, compaction, branch summary, retry, and bash work ([#5029](https://github.com/earendil-works/pi/pull/5029) by [@TerminallyChilI](https://github.com/TerminallyChilI)).
- Fixed `pi.getAllTools()` to expose each tool's `promptGuidelines` for extensions that need per-tool guideline attribution ([#4879](https://github.com/earendil-works/pi/issues/4879)).
- Fixed OpenAI Codex Responses replay after switching from Anthropic extended-thinking sessions by generating unique fallback message item IDs for converted thinking/text blocks ([#5148](https://github.com/earendil-works/pi/issues/5148)).
- Fixed Anthropic-compatible replay for providers that return empty thinking signatures by adding an opt-in `allowEmptySignature` compatibility flag ([#4464](https://github.com/earendil-works/pi/issues/4464)).
- Fixed OpenAI and OpenRouter GPT-5.5 Pro thinking level metadata to expose only supported medium, high, and xhigh efforts.
- Fixed OpenCode Go Kimi K2.6 thinking-off requests to send `thinking: "none"` ([#5078](https://github.com/earendil-works/pi/issues/5078)).
- Fixed Xiaomi Token Plan model metadata to omit unsupported `mimo-v2-flash` variants ([#5075](https://github.com/earendil-works/pi/issues/5075)).
- Fixed follow-up messages queued by `agent_end` extension handlers to drain before the agent becomes idle ([#5115](https://github.com/earendil-works/pi/pull/5115) by [@DanielThomas](https://github.com/DanielThomas)).
- Fixed extension input events to report `streamingBehavior` only for prompts actually queued during streaming ([#5107](https://github.com/earendil-works/pi/pull/5107) by [@DanielThomas](https://github.com/DanielThomas)).
- Fixed system prompt tool-selection guidance to avoid preferring unavailable file exploration tools ([#5132](https://github.com/earendil-works/pi/issues/5132)).
- Fixed fenced `diff` code blocks and other highlight.js scopes to keep theme-aware syntax colors after the `cli-highlight` replacement ([#5092](https://github.com/earendil-works/pi/issues/5092)).

## [0.76.0] - 2026-05-27

### New Features

- **Explicit session IDs for automation** - `--session-id <id>` lets scripts create or resume an exact project-local session. See [Sessions](docs/usage.md#sessions).
- **RPC bash output can stay out of model context** - RPC clients can pass `excludeFromContext` to `bash` for commands whose output should not be sent with the next prompt. See [RPC mode](docs/rpc.md#bash).
- **More predictable provider retries and timeouts** - Codex WebSocket/SSE waits are bounded, and `retry.provider.maxRetries` controls provider retries instead of hidden SDK defaults. See [Retry settings](docs/settings.md#retry).
- **Better terminal editing across environments** - Apple Terminal Shift+Enter, Windows/JetBrains capability detection, and Unicode-aware word navigation improve interactive editing. See [Terminal setup](docs/terminal-setup.md) and [Keybindings](docs/keybindings.md).

### Added

- Added `--session-id` to let CLI callers use an exact project-local session ID, creating it if missing ([#4874](https://github.com/earendil-works/pi/issues/4874)).
- Added `excludeFromContext` flag to the `bash` RPC command for parity with the internal `executeBash` API ([#5039](https://github.com/earendil-works/pi/issues/5039)).

### Fixed

- Fixed user message transcript rendering to preserve user-authored ordered-list markers ([#5013](https://github.com/earendil-works/pi/issues/5013)).
- Fixed self-update commands to bypass npm, pnpm, and Bun minimum release age gates for explicit `pi update` runs ([#4929](https://github.com/earendil-works/pi/issues/4929)).
- Fixed context token estimates to count user image attachments consistently with tool result images ([#4983](https://github.com/earendil-works/pi/issues/4983)).
- Fixed `httpIdleTimeoutMs` to apply to OpenAI Codex Responses WebSocket idle waits, added `websocketConnectTimeoutMs` for bounded WebSocket connect waits, and added a 10s Codex SSE response-header timeout ([#4945](https://github.com/earendil-works/pi/issues/4945)).
- Fixed `RpcClient` to reject pending requests and consume stdin pipe errors when the child process exits unexpectedly ([#4764](https://github.com/earendil-works/pi/issues/4764)).
- Fixed managed npm extension updates to avoid package managers installing or resolving pi host packages as peer dependencies ([#4907](https://github.com/earendil-works/pi/issues/4907)).
- Fixed RPC mode raw stdout writes to retry transient backpressure errors and flush queued protocol output during shutdown ([#4897](https://github.com/earendil-works/pi/issues/4897)).
- Fixed OpenAI Codex Responses cache-affinity headers to send `session-id` instead of proxy-incompatible `session_id` ([#4967](https://github.com/earendil-works/pi/issues/4967)).
- Fixed `openai-codex/gpt-5.3-codex-spark` model metadata to use its 128k context window ([#4969](https://github.com/earendil-works/pi/issues/4969)).
- Fixed OpenRouter/Poolside context overflow detection for `maximum allowed input length` errors ([#4943](https://github.com/earendil-works/pi/issues/4943)).
- Fixed provider retry controls so `retry.provider.maxRetries` is honored, SDK retries default to `0`, and quota/billing 429s are not retried behind Pi's retry handling ([#4991](https://github.com/earendil-works/pi-mono/pull/4991) by [@mitsuhiko](https://github.com/mitsuhiko)).
- Fixed Apple Terminal `Shift+Enter` by detecting local macOS modifier state when Terminal.app sends plain Return.
- Fixed Windows Terminal capability detection to enable OSC 8 hyperlinks, preserving clickable long URLs across wrapped lines ([#4923](https://github.com/earendil-works/pi/issues/4923)).
- Fixed JetBrains terminal capability detection to enable truecolor while disabling unsupported OSC 8 hyperlinks ([#5037](https://github.com/earendil-works/pi-mono/pull/5037) by [@Perlence](https://github.com/Perlence)).
- Fixed editor and input word navigation/deletion to use Unicode word boundaries while preserving ASCII punctuation boundaries ([#5022](https://github.com/earendil-works/pi-mono/pull/5022) by [@haoqixu](https://github.com/haoqixu), [#5067](https://github.com/earendil-works/pi-mono/pull/5067) by [@haoqixu](https://github.com/haoqixu), [#5068](https://github.com/earendil-works/pi-mono/pull/5068) by [@haoqixu](https://github.com/haoqixu)).
- Fixed the development docs `AGENTS.md` link to point at the pi-mono guidelines ([#5041](https://github.com/earendil-works/pi/issues/5041)).

## [0.75.5] - 2026-05-23

### New Features

- **Cleaner read tool output** - Collapsed `read` tool cards now show only the read line by default, while `Ctrl+O` still expands the full file content.
- **Faster file tools on Windows** - Built-in file tools now use async filesystem operations during streaming, and image resizes run off the main TUI thread in a worker.
- **More reliable package updates** - `pi update` and git package installs now reconcile pinned git refs and keep package settings intact. See [Packages](docs/packages.md).
- **Custom Anthropic-compatible adaptive thinking** - Custom provider model configs can opt into adaptive-thinking Claude behavior with `compat.forceAdaptiveThinking`. See [Custom providers](docs/custom-provider.md) and [Models](docs/models.md).

### Added

- Added `compat.forceAdaptiveThinking` support to custom Anthropic-compatible model configuration docs and validation ([#4797](https://github.com/earendil-works/pi-mono/pull/4797) by [@mbazso](https://github.com/mbazso)).
- Added a standard unified patch to edit tool result details for SDK consumers ([#4821](https://github.com/earendil-works/pi/issues/4821)).
- Added a Codex subscription login method selector with device-code auth for headless environments.

### Changed

- Changed collapsed read tool cards to show only the read line until expanded ([#4916](https://github.com/earendil-works/pi/issues/4916)).
- Replaced the inherited optional `koffi` dependency for Windows VT input with a tiny vendored native helper, reducing install size while preserving Shift+Tab handling ([#4480](https://github.com/earendil-works/pi/issues/4480)).
- Changed the root development install documentation to use `npm install --ignore-scripts` ([#4868](https://github.com/earendil-works/pi/issues/4868)).

### Fixed

- Fixed `pi update` to reconcile git-pinned packages to their configured ref ([#4869](https://github.com/earendil-works/pi/issues/4869)).
- Fixed package/resource path handling for Windows and glob/pattern resolution ([#4873](https://github.com/earendil-works/pi-mono/pull/4873) by [@mitsuhiko](https://github.com/mitsuhiko)).
- Fixed config pattern matching to resolve patterns from the correct base directory ([#4898](https://github.com/earendil-works/pi-mono/pull/4898) by [@haoqixu](https://github.com/haoqixu)).
- Fixed theme pickers to list themes by their content name instead of file stem ([#4830](https://github.com/earendil-works/pi-mono/pull/4830) by [@Perlence](https://github.com/Perlence)).
- Fixed OpenCode Zen/Go requests to send per-session OpenCode routing headers ([#4847](https://github.com/earendil-works/pi/issues/4847)).
- Fixed Amazon Bedrock provider loading under strict package managers by inheriting the declared `@smithy/node-http-handler` dependency from `@earendil-works/pi-ai` ([#4842](https://github.com/earendil-works/pi/issues/4842)).
- Fixed inherited Amazon Bedrock Claude requests to send the model output token cap by default, avoiding Bedrock's 4096-token default truncation ([#4848](https://github.com/earendil-works/pi/issues/4848)).
- Fixed exported session HTML to escape quote characters in attribute values ([#4832](https://github.com/earendil-works/pi/issues/4832)).
- Fixed GitHub Copilot device-code login to keep opening the verification URL in browser-capable environments while ignoring browser launch failures for headless use ([#4788](https://github.com/earendil-works/pi-mono/pull/4788) by [@vegarsti](https://github.com/vegarsti)).
- Fixed git package installs to reconcile existing checkouts to the requested ref and update package settings without losing filters ([#4870](https://github.com/earendil-works/pi/issues/4870)).
- Published a 0.74.2 rescue release that tells Node 20 users to upgrade Node before updating to newer Pi versions ([#4876](https://github.com/earendil-works/pi/issues/4876)).
- Fixed final bash tool cards to avoid rendering duplicate full-output truncation paths ([#4819](https://github.com/earendil-works/pi/issues/4819)).
- Fixed bash tool truncation line counts to ignore the trailing newline as an extra output line ([#4818](https://github.com/earendil-works/pi/issues/4818)).
- Fixed footer home-directory abbreviation to avoid shortening sibling paths that only share the same prefix ([#4878](https://github.com/earendil-works/pi/issues/4878)).
- Fixed macOS Bun release binaries to resolve the native clipboard sidecar so Ctrl+V image paste can load `@mariozechner/clipboard` ([#4307](https://github.com/earendil-works/pi/issues/4307)).
- Fixed coding-agent tools to avoid synchronous filesystem operations during streaming and moved image resizing off the main TUI thread ([#4756](https://github.com/earendil-works/pi-mono/pull/4756) by [@mitsuhiko](https://github.com/mitsuhiko)).

## [0.75.4] - 2026-05-20

### New Features

- **Hardened npm install and release path** - Pi now ships the CLI with a generated shrinkwrap for transitive dependencies, blocks accidental lockfile changes, verifies dependency pinning and lifecycle-script allowlists in checks, disables lifecycle scripts for self-update and local release installs where supported, and smoke-tests isolated npm and Bun installs before release. See [Supply-chain hardening](../../README.md#supply-chain-hardening).

### Added

- Added interactive update notes after `pi update` runs, so users can see the installed version's changelog before continuing ([#4724](https://github.com/earendil-works/pi-mono/pull/4724) by [@mitsuhiko](https://github.com/mitsuhiko)).
- Exported image resize utilities from the package root for SDK consumers ([#4775](https://github.com/earendil-works/pi-mono/pull/4775) by [@xl0](https://github.com/xl0)).

### Changed

- Changed source syntax to avoid TypeScript constructs that require JavaScript emit, keeping core sources compatible with Node.js strip-only TypeScript checks.
- Removed web UI workspace references from the CLI package and dropped the package-level development watch script.
- Published npm installs now include an `npm-shrinkwrap.json` to lock transitive dependencies for the CLI package.
- Improved terminal theme detection for light/dark and truecolor handling.
- Changed self-update package-manager commands to disable lifecycle scripts during reinstall.

### Fixed

- Fixed the system prompt to tell models to resolve pi docs and examples under the absolute package paths before reading topic-specific relative references ([#4752](https://github.com/earendil-works/pi/issues/4752)).
- Fixed extension `ctx.abort()` during tool-call preflight to stop later confirmations and restore queued interactive input like Escape ([#4276](https://github.com/earendil-works/pi/issues/4276)).
- Fixed AgentSession retry, compaction, and event settlement to use the awaited agent lifecycle instead of a separate event queue, and added `willRetry` to `agent_end` session events.
- Fixed forked session runtime state to keep the active session id aligned with the fork target ([#4799](https://github.com/earendil-works/pi-mono/pull/4799) by [@Perlence](https://github.com/Perlence)).
- Fixed the subagent extension's parallel mode to return useful per-task output and failed-task diagnostics to the parent model instead of 100-character previews ([#4710](https://github.com/earendil-works/pi/issues/4710)).
- Fixed Windows local bash execution to hide helper console windows when launched from background SDK processes ([#4699](https://github.com/earendil-works/pi/issues/4699)).
- Fixed managed npm extension folders to set cloud-sync ignore metadata where supported ([#4763](https://github.com/earendil-works/pi/issues/4763)).
- Fixed HTTP idle timeout configuration so long-running provider streams can avoid premature idle disconnects ([#4759](https://github.com/earendil-works/pi-mono/pull/4759) by [@mitsuhiko](https://github.com/mitsuhiko)).
- Fixed default system prompt boundaries to use explicit XML tags for clearer file separation ([#4709](https://github.com/earendil-works/pi-mono/pull/4709) by [@herrnel](https://github.com/herrnel)).
- Fixed HTML share/export sidebar clicks for shared tool entries to scroll to the rendered tool call ([#4664](https://github.com/earendil-works/pi-mono/pull/4664) by [@yzhg1983](https://github.com/yzhg1983)).
- Fixed theme palettes to set explicit text colors and avoid terminal-default color drift.
- Fixed truecolor detection to align terminal image rendering and interactive theme decisions.
- Fixed loader indicator startup inherited from `@earendil-works/pi-tui` so initialization cannot run before frames are available.
- Fixed OpenAI-compatible default output token requests inherited from `@earendil-works/pi-ai` to avoid reserving impossible context windows on servers such as vLLM ([#4675](https://github.com/earendil-works/pi/issues/4675)).
- Fixed OpenAI prompt cache keys inherited from `@earendil-works/pi-ai` to stay within the 64-character provider limit ([#4720](https://github.com/earendil-works/pi/issues/4720)).
- Fixed Windows npm-family package commands for fnm-managed Node.js installs that expose both extensionless Unix scripts and `.cmd` shims ([#4793](https://github.com/earendil-works/pi/issues/4793)).

## [0.75.3] - 2026-05-18

### Fixed

- Fixed undici 8 HTTP/2 destroyed-session races crashing the Node CLI by preserving the previous HTTP/1.1-only fetch dispatcher behavior ([#4681](https://github.com/earendil-works/pi/issues/4681)).

## [0.75.2] - 2026-05-18

### Fixed

- Fixed Bun-compiled release binaries failing to start when Bun's built-in undici shim lacks npm undici's `install` export ([#4661](https://github.com/earendil-works/pi-mono/pull/4661) by [@dmasiero](https://github.com/dmasiero)).
- Fixed Xiaomi MiMo generated model metadata to replay assistant tool-call messages with `reasoning_content` for thinking-mode multi-turn requests, inherited from `@earendil-works/pi-ai` ([#4678](https://github.com/earendil-works/pi/issues/4678)).
- Fixed Windows external editor handoff so vim/nvim can receive input after opening from the TUI ([#4612](https://github.com/earendil-works/pi/issues/4612)).
- Fixed Windows npm self-updates to move loaded native dependency packages out of the active install before reinstalling pi ([#4157](https://github.com/earendil-works/pi/issues/4157)).
- Fixed `pi update --self` detection for pnpm v11 global installs whose package path resolves through the pnpm store ([#4647](https://github.com/earendil-works/pi/issues/4647)).
- Fixed Windows pnpm self-updates to resolve pnpm command shims and run through pnpm instead of requiring manual updates ([#4157](https://github.com/earendil-works/pi/issues/4157)).
- Fixed Windows npm-family command execution to use cross-spawn instead of parsing `.cmd` shim internals ([#4665](https://github.com/earendil-works/pi/issues/4665)).

## [0.75.1] - 2026-05-18

### Fixed

- Fixed config selectors to scale their visible row count to terminal height ([#4243](https://github.com/earendil-works/pi-mono/pull/4243) by [@samjonester](https://github.com/samjonester)).
- Fixed Anthropic-compatible API-key requests to ignore unrelated `ANTHROPIC_AUTH_TOKEN` environment values, avoiding invalid bearer credentials for providers such as Xiaomi MiMo inherited from `@earendil-works/pi-ai` ([#4342](https://github.com/earendil-works/pi/issues/4342)).
- Fixed Amazon Bedrock message conversion to skip unknown content blocks instead of failing the stream, inherited from `@earendil-works/pi-ai` ([#4223](https://github.com/earendil-works/pi/issues/4223)).
- Fixed Azure OpenAI Responses and OpenAI Responses error formatting to prefix HTTP status codes onto `errorMessage`, so transient 5xx and 429 errors are correctly matched by the agent-level auto-retry classifier inherited from `@earendil-works/pi-ai` ([#4232](https://github.com/earendil-works/pi/issues/4232)).
- Fixed OpenCode Go Kimi reasoning replay by normalizing streamed `reasoning` fields back to `reasoning_content` for OpenCode Go only, inherited from `@earendil-works/pi-ai` ([#4251](https://github.com/earendil-works/pi/issues/4251)).
- Fixed Xiaomi MiMo model metadata to use the OpenAI-compatible endpoints and `openai-completions` API, restoring multi-turn thinking/tool-call sessions inherited from `@earendil-works/pi-ai` ([#4505](https://github.com/earendil-works/pi/issues/4505)).
- Fixed JSON parse failures for compressed fetch responses under Node 26.0 by installing undici fetch globals alongside pi's global dispatcher ([#4650](https://github.com/earendil-works/pi/issues/4650), [#4652](https://github.com/earendil-works/pi/issues/4652), [#4653](https://github.com/earendil-works/pi/issues/4653)).
- Fixed npm-family package commands on Windows to avoid shell argument splitting when install prefixes contain spaces ([#4623](https://github.com/earendil-works/pi/issues/4623)).

### Removed

- Removed non-working OpenAI Codex fast model variants inherited from `@earendil-works/pi-ai`.

## [0.75.0] - 2026-05-17

### Breaking Changes

- Raised the minimum supported Node.js version to 22.19.0.

### Fixed

- Fixed compaction summary calls to use custom agent stream functions, preserving proxy-backed LLM routing ([#4484](https://github.com/earendil-works/pi/issues/4484)).
- Fixed system prompt and context file boundaries to use explicit XML tags instead of Markdown headings, reducing inconsistent boundary ingestion by models ([#4541](https://github.com/earendil-works/pi-mono/pull/4541) by [@herrnel](https://github.com/herrnel)).
- Fixed OpenAI Codex generated model metadata to use the current upstream model list inherited from `@earendil-works/pi-ai` ([#4603](https://github.com/earendil-works/pi-mono/pull/4603) by [@mattiacerutti](https://github.com/mattiacerutti)).
- Fixed GitHub Copilot GPT model thinking metadata inherited from `@earendil-works/pi-ai` to map unsupported minimal thinking to low ([#4622](https://github.com/earendil-works/pi-mono/pull/4622) by [@mattiacerutti](https://github.com/mattiacerutti)).
- Fixed user-scoped npm pi packages to install under `~/.pi/agent/npm/` instead of npm's global package root, avoiding permission errors with system-managed Node installs ([#4587](https://github.com/earendil-works/pi/issues/4587)).
- Fixed Mistral requests failing after the global fetch proxy/timeout workaround by removing the custom fetch override and using undici 8 dispatcher support instead ([#4619](https://github.com/earendil-works/pi/issues/4619)).
- Fixed default output token requests for models whose advertised output limit is effectively their full context window, avoiding impossible provider requests inherited from `@earendil-works/pi-ai` ([#4614](https://github.com/earendil-works/pi/issues/4614)).

## [0.74.1] - 2026-05-16

### New Features

- **Image generation support** - Added image generation APIs, generated image model metadata, and built-in OpenRouter image generation support inherited from `@earendil-works/pi-ai`.
- **Together AI provider** - Added Together AI as a built-in provider with `/login` API-key auth, default model resolution, and setup docs. See [README.md#providers--models](README.md#providers--models) and [docs/providers.md](docs/providers.md).
- **Windows ARM64 standalone binaries** - Added standalone release artifacts for Windows ARM64.
- **Improved terminal and markdown rendering** - Added markdown list indentation, task-list checkbox rendering, large markdown robustness, and inline image placement fixes inherited from `@earendil-works/pi-tui`.

### Added

- Added image generation support from `@earendil-works/pi-ai`, including image generation APIs, image model metadata, and built-in OpenRouter image generation support ([#3887](https://github.com/earendil-works/pi-mono/pull/3887) by [@cristinaponcela](https://github.com/cristinaponcela)).
- Added Together AI to built-in provider setup, `/login` API-key auth, and default model resolution ([#3624](https://github.com/earendil-works/pi-mono/pull/3624) by [@Nutlope](https://github.com/Nutlope)).
- Added Windows ARM64 standalone binary release artifacts ([#4458](https://github.com/earendil-works/pi/pull/4458) by [@brianmichel](https://github.com/brianmichel)).

### Fixed

- Fixed Node 26 OpenAI-compatible streams timing out after five idle minutes by routing global fetch through pi's undici dispatcher ([#4519](https://github.com/earendil-works/pi/issues/4519)).
- Fixed pnpm global package installs by resolving the global package root from pnpm's layout.
- Fixed macOS clipboard access errors under sandboxed pasteboard denial so they do not abort the process ([#4492](https://github.com/earendil-works/pi/issues/4492)).
- Fixed the scoped model startup hint to show the configured model-cycle keybinding ([#4508](https://github.com/earendil-works/pi/issues/4508)).
- Fixed resource path display to disambiguate package/resource names that collide across package locations.
- Fixed `fd` auto-download on macOS x86_64 by pinning the last release that ships an Intel macOS binary ([#4559](https://github.com/earendil-works/pi/issues/4559)).
- Fixed skill diagnostics to stop warning when a skill name differs from its parent directory ([#4534](https://github.com/earendil-works/pi/issues/4534)).
- Fixed prompt template argument parsing to split unquoted multiline input on newlines ([#4553](https://github.com/earendil-works/pi/issues/4553)).
- Fixed `--resume` session listing to cap in-flight session metadata loads and avoid OOM on large session histories ([#4583](https://github.com/earendil-works/pi/issues/4583)).
- Fixed interactive error messages to render with trailing spacing so reload errors do not run into resource listings ([#4510](https://github.com/earendil-works/pi/issues/4510)).
- Fixed `.agents` package provenance metadata to survive package-manager scans.
- Fixed nested code fences in the Termux setup documentation so the example AGENTS.md renders correctly ([#4503](https://github.com/earendil-works/pi/issues/4503)).
- Fixed tool output expansion while extension confirmation dialogs are focused ([#4429](https://github.com/earendil-works/pi/issues/4429)).
- Fixed auto-retry for Anthropic streams that end before `message_stop` ([#4433](https://github.com/earendil-works/pi/issues/4433)).
- Fixed compaction summary calls to clamp requested output tokens to model limits.
- Fixed uncaught interactive-mode exceptions to restore the terminal before exiting ([#4426](https://github.com/earendil-works/pi-mono/pull/4426) by [@ofa1](https://github.com/ofa1)).
- Fixed ANSI stripping to match `strip-ansi` behavior after dependency removal.
- Fixed UUIDv7 sequence generation shared by session IDs after dependency removal.
- Fixed OpenRouter cached-token usage accounting, Fireworks caching compatibility, and OpenAI Codex WebSocket proxy handling inherited from `@earendil-works/pi-ai`.
- Fixed markdown list wrapping, task-list checkboxes, large markdown rendering, WezTerm Kitty keyboard escape handling, and short-viewport inline image placement inherited from `@earendil-works/pi-tui`.
- Fixed theme sharing across package scopes so extensions do not crash with `Theme not initialized` ([#4333](https://github.com/earendil-works/pi/issues/4333)).
- Fixed keybinding hints to show Option instead of Alt on macOS ([#4289](https://github.com/earendil-works/pi/issues/4289)).
- Fixed the interactive update notification to render the changelog as an OSC 8 hyperlink when the terminal supports hyperlinks ([#4280](https://github.com/earendil-works/pi/issues/4280)).

## [0.74.0] - 2026-05-07

### Changed

- Updated repository links and package references for the move to `earendil-works/pi-mono` and `@earendil-works/*` package scopes.

## [0.73.1] - 2026-05-07

### New Features

- **Self-update support for the npm scope migration**: `pi update --self` now supports the upcoming package rename from `@mariozechner/pi-coding-agent` to `@earendil-works/pi-coding-agent`. After the new package is published, existing global installs can update through the normal self-update flow; pi will uninstall the old global package and install the package name returned by the version check endpoint.
- **Interactive OAuth login selection**: OAuth providers can now present multiple login choices in `/login`, enabling provider-specific interactive authentication flows. See [Providers](docs/providers.md).
- **JSONC-style `models.json` parsing**: `models.json` now allows comments and trailing commas, making custom provider and model configuration easier to maintain. See [Providers](docs/providers.md) and [Custom Providers](docs/custom-provider.md).

### Added

- Added interactive login selection support so OAuth providers can present multiple login choices ([#4190](https://github.com/earendil-works/pi-mono/pull/4190) by [@mitsuhiko](https://github.com/mitsuhiko)).

### Changed

- Changed `pi update --self` to honor the active package name returned by the Pi version check endpoint, defaulting to the current package when omitted and uninstalling the old global package before installing a renamed package.
- Changed extension loading to use upstream `jiti` 2.7 instead of the `@mariozechner/jiti` fork ([#4244](https://github.com/earendil-works/pi-mono/pull/4244) by [@pi0](https://github.com/pi0)).
- Changed `models.json` parsing to allow comments and trailing commas ([#4162](https://github.com/earendil-works/pi-mono/pull/4162) by [@julien-c](https://github.com/julien-c)).

### Fixed

- Fixed `pi -p` treating prompts that start with YAML frontmatter as extension flags instead of user messages ([#4163](https://github.com/badlogic/pi-mono/issues/4163)).
- Fixed pending tool results not updating in the live TUI after toggling thinking block visibility while the tool is running ([#4167](https://github.com/badlogic/pi-mono/issues/4167)).
- Fixed `/copy` reporting success on Linux without writing the clipboard on Wayland-only compositors (Hyprland, Niri, ...) by skipping the X11-only native addon on Linux and routing through `wl-copy`/`xclip`/`xsel` instead ([#4177](https://github.com/badlogic/pi-mono/issues/4177)).
- Fixed HTML session exports to strip skill wrapper XML from rendered user messages ([#4234](https://github.com/earendil-works/pi-mono/pull/4234) by [@aliou](https://github.com/aliou)).
- Fixed OpenAI-compatible chat completion streams that interleave content and tool-call deltas in the same choice.
- Fixed OpenAI Codex OAuth refresh failures writing directly to stderr while the TUI is active ([#4141](https://github.com/badlogic/pi-mono/issues/4141)).
- Fixed OpenAI Codex Responses requests to send a non-empty system prompt ([#4184](https://github.com/earendil-works/pi-mono/issues/4184)).
- Fixed Kimi For Coding model resolution for the Kimi K2 P6 alias ([#4218](https://github.com/earendil-works/pi-mono/issues/4218)).
- Fixed Kitty inline image redraws to stay within TUI-owned terminal regions and avoid writing below the active viewport.
- Fixed Kitty inline image rendering by letting the terminal allocate image ids and bounding parsed image ids to valid values.
- Fixed inline image capability detection to disable inline images in cmux terminals.

## [0.73.0] - 2026-05-04

### New Features

- **Xiaomi MiMo API billing and regional Token Plan providers** - `xiaomi` now uses API billing, with separate `xiaomi-token-plan-{cn,ams,sgp}` providers. See [docs/providers.md#api-keys](docs/providers.md#api-keys) and [README.md#providers--models](README.md#providers--models). ([#4112](https://github.com/badlogic/pi-mono/pull/4112) by [@Phoen1xCode](https://github.com/Phoen1xCode))
- **Incremental bash output streaming** - Bash tool output now appears while commands run instead of only after completion. ([#4145](https://github.com/badlogic/pi-mono/issues/4145))
- **Compact read rendering** - Interactive `read` output for Pi docs, context files, and skills is collapsed by default and shows selected line ranges.

### Breaking Changes

- Switched the built-in `xiaomi` provider from Token Plan AMS to Xiaomi's API billing endpoint, and renamed its `/login` display from "Xiaomi MiMo Token Plan" to "Xiaomi MiMo". `XIAOMI_API_KEY` now refers to the API billing key from [platform.xiaomimimo.com](https://platform.xiaomimimo.com). Users on Token Plan should switch to the appropriate `xiaomi-token-plan-*` provider and set the corresponding env var ([#4112](https://github.com/badlogic/pi-mono/pull/4112) by [@Phoen1xCode](https://github.com/Phoen1xCode)).

### Added

- Added three Xiaomi MiMo Token Plan regional providers visible in `/login`: `xiaomi-token-plan-cn` (`XIAOMI_TOKEN_PLAN_CN_API_KEY`), `xiaomi-token-plan-ams` (`XIAOMI_TOKEN_PLAN_AMS_API_KEY`), `xiaomi-token-plan-sgp` (`XIAOMI_TOKEN_PLAN_SGP_API_KEY`). Each defaults to `mimo-v2.5-pro` ([#4112](https://github.com/badlogic/pi-mono/pull/4112) by [@Phoen1xCode](https://github.com/Phoen1xCode)).

### Changed

- Changed `read` tool rendering to collapse Pi documentation, AGENTS/CLAUDE context files, and `SKILL.md` contents by default in interactive output.

### Fixed

- Fixed generated OpenAI-compatible model metadata for Qwen 3.5/3.6 and MiniMax M2.7, so those models work through the built-in provider catalog ([#4110](https://github.com/badlogic/pi-mono/pull/4110) by [@jsynowiec](https://github.com/jsynowiec)).
- Fixed Bedrock Claude Opus 4.7 `xhigh` thinking requests by preserving the provider's native effort value.
- Fixed OpenAI Codex WebSocket transport to fall back to SSE when setup fails before streaming starts, and surface transport diagnostics in the assistant message ([#4133](https://github.com/badlogic/pi-mono/issues/4133)).
- Fixed OpenAI Codex WebSocket transport keeping `--print` and JSON mode processes alive after the response by closing cached WebSocket sessions during session shutdown ([#4103](https://github.com/badlogic/pi-mono/issues/4103)).
- Fixed compact `read` tool calls to render directly and include selected line ranges in interactive output.
- Fixed interactive sessions to exit when terminal input is lost instead of continuing in a broken state.
- Fixed bash tool output to stream incrementally while commands run instead of waiting for command completion ([#4145](https://github.com/badlogic/pi-mono/issues/4145)).
- Fixed selector and autocomplete fuzzy ranking to prioritize exact matches.

## [0.72.1] - 2026-05-02

## [0.72.0] - 2026-05-01

### New Features

- **Xiaomi MiMo Token Plan provider** - New Anthropic-compatible provider with `XIAOMI_API_KEY` auth, default model (`mimo-v2.5-pro`), and `/login` display. See [docs/providers.md](docs/providers.md). ([#4005](https://github.com/badlogic/pi-mono/pull/4005) by [@Phoen1xCode](https://github.com/Phoen1xCode)).
- **Model thinking level metadata** - Models can now declare which thinking levels they support via `thinkingLevelMap`, replacing the old `reasoningEffortMap`. See [docs/models.md#thinking-level-map](docs/models.md#thinking-level-map) and [docs/custom-provider.md](docs/custom-provider.md). ([#3208](https://github.com/badlogic/pi-mono/issues/3208)).
- **Custom provider base URL overrides** - `pi.registerProvider()` now respects per-model `baseUrl` settings. See [docs/custom-provider.md](docs/custom-provider.md). ([#4063](https://github.com/badlogic/pi-mono/issues/4063)).
- **Post-turn stop callback** - Agent loop can now exit gracefully after a completed turn via `shouldStopAfterTurn`. See [`packages/agent/README.md`](https://github.com/badlogic/pi-mono/blob/main/packages/agent/README.md).
- **Self-update detection fix** - `pi` now correctly identifies and applies available updates. ([#3942](https://github.com/badlogic/pi-mono/issues/3942), [#3980](https://github.com/badlogic/pi-mono/issues/3980), [#3922](https://github.com/badlogic/pi-mono/issues/3922)).

### Breaking Changes

- Replaced `compat.reasoningEffortMap` in `models.json` and `pi.registerProvider()` model definitions with model-level `thinkingLevelMap` ([#3208](https://github.com/badlogic/pi-mono/issues/3208)). Migration: move old mappings from `compat.reasoningEffortMap` to `thinkingLevelMap`. Use string values for provider-specific thinking values and `null` for unsupported pi levels that should be hidden and skipped by cycling. See `docs/models.md#thinking-level-map` and `docs/custom-provider.md`.

### Added

- Added Xiaomi MiMo Token Plan provider support with `XIAOMI_API_KEY`, default model resolution, `/login` display support, and provider documentation ([#4005](https://github.com/badlogic/pi-mono/pull/4005) by [@Phoen1xCode](https://github.com/Phoen1xCode)).
- Added model-level `thinkingLevelMap` support in `models.json` and `pi.registerProvider()`, allowing models to expose only the thinking levels they actually support ([#3208](https://github.com/badlogic/pi-mono/issues/3208)).
- Added `shouldStopAfterTurn` agent loop callback for post-turn stop control, inherited from `@mariozechner/pi-agent-core`. See [`packages/agent/README.md`](https://github.com/badlogic/pi-mono/blob/main/packages/agent/README.md).

### Fixed

- Fixed the default transport setting to use `auto`, allowing OpenAI Codex to use cached WebSocket context when available ([#4083](https://github.com/badlogic/pi-mono/issues/4083)).
- Fixed `pi.registerProvider()` to honor per-model `baseUrl` overrides ([#4063](https://github.com/badlogic/pi-mono/issues/4063)).
- Fixed self-update detection so `pi` correctly identifies when a newer version is available and applies updates ([#3942](https://github.com/badlogic/pi-mono/issues/3942), [#3980](https://github.com/badlogic/pi-mono/issues/3980), [#3922](https://github.com/badlogic/pi-mono/issues/3922)).

## [0.71.1] - 2026-05-01

### Added

- Added `websocket-cached` to the transport setting options for the OpenAI Codex provider used with ChatGPT subscription auth. This keeps the same WebSocket open for a session and, after the first request, sends only the new conversation items instead of resending the full chat history when possible.

## [0.71.0] - 2026-04-30

### Breaking Changes

- Removed built-in Google Gemini CLI and Google Antigravity support. Existing configurations using those providers must switch to another supported provider.

### New Features

- Cloudflare AI Gateway provider support with `CLOUDFLARE_API_KEY`/`CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_GATEWAY_ID`, default model resolution, and `/login` display. See [docs/providers.md#cloudflare-ai-gateway](docs/providers.md#cloudflare-ai-gateway). ([#3856](https://github.com/badlogic/pi-mono/pull/3856) by [@mchenco](https://github.com/mchenco)).
- Moonshot AI provider support with `MOONSHOT_API_KEY`, default model resolution, and `/login` display.
- Mistral Medium 3.5 built-in model support. See [docs/providers.md#api-keys](docs/providers.md#api-keys). ([#4009](https://github.com/badlogic/pi-mono/pull/4009) by [@technocidal](https://github.com/technocidal)).
- Extension APIs can replace finalized `message_end` messages, wrap custom editor factories via `ctx.ui.getEditorComponent()`, and observe thinking level changes. See [docs/extensions.md#message_start--message_update--message_end](docs/extensions.md#message_start--message_update--message_end), [docs/extensions.md#widgets-status-and-footer](docs/extensions.md#widgets-status-and-footer), and [docs/extensions.md#thinking_level_select](docs/extensions.md#thinking_level_select).
- `PI_CODING_AGENT_SESSION_DIR` configures session storage from the environment. See [docs/usage.md#environment-variables](docs/usage.md#environment-variables).

### Added

- Added Cloudflare AI Gateway as a built-in provider with `CLOUDFLARE_API_KEY`/`CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_GATEWAY_ID` setup, default model resolution, `/login` display support, and provider documentation ([#3856](https://github.com/badlogic/pi-mono/pull/3856) by [@mchenco](https://github.com/mchenco)).
- Added Moonshot AI as a built-in provider with `MOONSHOT_API_KEY` setup, default model resolution, and `/login` display support.
- Added Mistral Medium 3.5 built-in model support via `@mariozechner/pi-ai` ([#4009](https://github.com/badlogic/pi-mono/pull/4009) by [@technocidal](https://github.com/technocidal)).
- Added routed OpenAI-compatible response model metadata in assistant messages, so providers such as OpenRouter can expose the concrete model used ([#3968](https://github.com/badlogic/pi-mono/pull/3968) by [@purrgrammer](https://github.com/purrgrammer)).
- Added `PI_CODING_AGENT_SESSION_DIR` as an environment equivalent to `--session-dir` ([#4027](https://github.com/badlogic/pi-mono/issues/4027)).
- Added `message_end` extension result support for replacing finalized messages, enabling extensions to override assistant usage cost ([#3982](https://github.com/badlogic/pi-mono/issues/3982)).
- Added top-level `name` support to `pi.registerProvider()` so extension-registered providers can show a friendly name in `/login` ([#3956](https://github.com/badlogic/pi-mono/issues/3956)).
- Added `ctx.ui.getEditorComponent()` so extensions can wrap the currently configured custom editor factory ([#3935](https://github.com/badlogic/pi-mono/issues/3935)).
- Added a `thinking_level_select` extension event for observing thinking level changes ([#3888](https://github.com/badlogic/pi-mono/issues/3888)).

### Fixed

- Fixed WSL clipboard image paste by passing the PowerShell save path directly instead of through a custom environment variable ([#2469](https://github.com/badlogic/pi-mono/issues/2469)).
- Fixed Google Vertex Gemini 3 tool call replay for unsigned tool calls ([#4032](https://github.com/badlogic/pi-mono/issues/4032)).
- Fixed blocked `edit` tool results rendering the rejection reason twice after interactive extension confirmation ([#3830](https://github.com/badlogic/pi-mono/issues/3830)).
- Fixed extension-triggered thinking level changes refreshing the interactive editor border immediately ([#3888](https://github.com/badlogic/pi-mono/issues/3888)).
- Fixed the coding-agent README See Also link to point at `@mariozechner/pi-agent-core` ([#4023](https://github.com/badlogic/pi-mono/issues/4023)).
- Fixed `grep` and `find` tool argument injection for flag-like search patterns ([#4018](https://github.com/badlogic/pi-mono/issues/4018)).
- Fixed PowerShell shell command output on Windows by only spawning detached processes on Unix ([#4013](https://github.com/badlogic/pi-mono/pull/4013) by [@picasso250](https://github.com/picasso250)).
- Fixed Bun package manager `node_modules` discovery when `npmCommand` is configured to use Bun ([#3998](https://github.com/badlogic/pi-mono/pull/3998) by [@thirtythreeforty](https://github.com/thirtythreeforty)).
- Fixed edit and edit-preview access failures to report filesystem errors correctly ([#3955](https://github.com/badlogic/pi-mono/pull/3955) by [@rwachtler](https://github.com/rwachtler)).
- Fixed `ProcessTerminal` sizing to use `COLUMNS` and `LINES` before falling back to 80x24 ([#4004](https://github.com/badlogic/pi-mono/issues/4004)).
- Updated `@anthropic-ai/sdk` to clear GHSA-p7fg-763f-g4gf audit findings ([#3992](https://github.com/badlogic/pi-mono/issues/3992)).
- Updated `@mariozechner/clipboard` to an attested release so package managers with trust policies do not reject installs ([#3946](https://github.com/badlogic/pi-mono/issues/3946)).
- Fixed project context discovery to load `AGENTS.MD` files in addition to `AGENTS.md` ([#3949](https://github.com/badlogic/pi-mono/issues/3949)).
- Fixed `/handoff` to use compacted session context instead of pre-compaction raw messages ([#3945](https://github.com/badlogic/pi-mono/issues/3945)).
- Fixed DeepSeek V4 Flash `xhigh` thinking support so requests map to DeepSeek's `max` reasoning effort ([#3944](https://github.com/badlogic/pi-mono/issues/3944)).
- Fixed Anthropic streams that end before `message_stop` to be treated as errors instead of successful partial responses ([#3936](https://github.com/badlogic/pi-mono/issues/3936)).
- Fixed generated OpenAI-compatible DeepSeek V4 reasoning compatibility outside the direct DeepSeek provider ([#3940](https://github.com/badlogic/pi-mono/issues/3940)).
- Fixed idle follow-up submission to clear the editor like normal message submission ([#3926](https://github.com/badlogic/pi-mono/issues/3926)).
- Fixed editor rendering artifacts for Thai Sara Am and Lao AM vowel characters ([#3904](https://github.com/badlogic/pi-mono/issues/3904)).
- Fixed DeepSeek V4 Flash and V4 Pro pricing metadata to match current official rates ([#3910](https://github.com/badlogic/pi-mono/issues/3910)).
- Updated the sandbox extension example lockfile to resolve the vulnerable `lodash-es` transitive dependency ([#3901](https://github.com/badlogic/pi-mono/issues/3901)).
- Fixed DeepSeek prompt cache hits to be tracked from OpenAI-compatible usage responses ([#3880](https://github.com/badlogic/pi-mono/issues/3880)).

### Removed

- Removed the discontinued Qwen CLI OAuth custom provider extension example ([#3832](https://github.com/badlogic/pi-mono/pull/3832) by [@4h9fbZ](https://github.com/4h9fbZ)).
- Removed Google Gemini CLI and Google Antigravity built-in login, default model, documentation, and example extension support.

## [0.70.6] - 2026-04-28

### New Features

- Cloudflare Workers AI provider support with `CLOUDFLARE_API_KEY`/`CLOUDFLARE_ACCOUNT_ID` setup. See [docs/providers.md#api-keys](docs/providers.md#api-keys). ([#3851](https://github.com/badlogic/pi-mono/pull/3851) by [@mchenco](https://github.com/mchenco))
- Pi update checks now use `pi.dev` and identify Pi with a `pi/<version>` user agent. See [docs/packages.md](docs/packages.md). ([#3877](https://github.com/badlogic/pi-mono/pull/3877) by [@mitsuhiko](https://github.com/mitsuhiko))

### Added

- Added Cloudflare Workers AI as a built-in provider with `CLOUDFLARE_API_KEY`/`CLOUDFLARE_ACCOUNT_ID` setup, default model resolution, `/login` support, and provider documentation ([#3851](https://github.com/badlogic/pi-mono/pull/3851) by [@mchenco](https://github.com/mchenco)).

### Changed

- Changed Pi version checks to identify Pi with a `pi/<version>` user agent ([#3877](https://github.com/badlogic/pi-mono/pull/3877) by [@mitsuhiko](https://github.com/mitsuhiko)).

### Fixed

- Fixed config selector scroll indicators to show item counts instead of line counts ([#3820](https://github.com/badlogic/pi-mono/pull/3820) by [@aliou](https://github.com/aliou)).
- Fixed exported HTML to escape embedded image data and session metadata, preventing crafted session content from injecting markup ([#3819](https://github.com/badlogic/pi-mono/pull/3819) by [@justinpbarnett](https://github.com/justinpbarnett), [#3883](https://github.com/badlogic/pi-mono/pull/3883) by [@justinpbarnett](https://github.com/justinpbarnett)).
- Fixed Bun-based package manager startup by locating global `node_modules` relative to Bun's install layout ([#3861](https://github.com/badlogic/pi-mono/pull/3861) by [@thirtythreeforty](https://github.com/thirtythreeforty)).
- Fixed Bedrock inference profile capability checks by normalizing profile ARNs to the underlying model name.
- Fixed file discovery to fall back to `fdfind` when `fd` is unavailable.
- Fixed `pi update` to skip self-update reinstalls when the installed version is already current ([#3853](https://github.com/badlogic/pi-mono/issues/3853)).
- Fixed Cloudflare Workers AI attribution headers to honor the install telemetry setting.
- Fixed `pi update --self` detection and execution for Windows package-manager shim installs, including symlinked global package roots, and print the manual fallback command when self-update fails ([#3857](https://github.com/badlogic/pi-mono/issues/3857)).

## [0.70.5] - 2026-04-27

### Fixed

- Fixed HTML export preserving ANSI-renderer trailing padding as extra blank wrapped lines.

## [0.70.4] - 2026-04-27

### Fixed

- Fixed packaged `pi` startup failing because the session selector imported a source-only utility path.

## [0.70.3] - 2026-04-27

### New Features

- `pi update` can now update pi itself in addition to installed pi packages. See [docs/packages.md](docs/packages.md). ([#3680](https://github.com/badlogic/pi-mono/pull/3680) by [@mitsuhiko](https://github.com/mitsuhiko))
- Azure Cognitive Services endpoint support for Azure OpenAI Responses deployments. See [docs/providers.md#api-keys](docs/providers.md#api-keys). ([#3799](https://github.com/badlogic/pi-mono/pull/3799) by [@marcbloech](https://github.com/marcbloech))
- Suppressible Anthropic extra-usage billing warning via `warnings.anthropicExtraUsage` in `/settings`. See [docs/settings.md](docs/settings.md). ([#3808](https://github.com/badlogic/pi-mono/issues/3808))
- Extension-controlled working row visibility via `ctx.ui.setWorkingVisible()`, allowing extensions to hide the built-in loader row and render custom working state. See [docs/extensions.md](docs/extensions.md) and [examples/extensions/border-status-editor.ts](examples/extensions/border-status-editor.ts). ([#3674](https://github.com/badlogic/pi-mono/issues/3674))

### Added

- Added `pi update` support for updating pi itself in addition to installed pi packages ([#3680](https://github.com/badlogic/pi-mono/pull/3680) by [@mitsuhiko](https://github.com/mitsuhiko)).
- Added Azure Cognitive Services endpoint support for Azure OpenAI Responses base URLs ([#3799](https://github.com/badlogic/pi-mono/pull/3799) by [@marcbloech](https://github.com/marcbloech)).
- Added `warnings.anthropicExtraUsage` and a `/settings` warnings submenu to suppress the Anthropic extra usage billing warning ([#3808](https://github.com/badlogic/pi-mono/issues/3808))
- Added `ctx.ui.setWorkingVisible()` so extensions can hide the built-in interactive working loader row without reserving layout space, plus a border-status editor example that moves working state into a custom editor border ([#3674](https://github.com/badlogic/pi-mono/issues/3674))

### Fixed

- Fixed duplicate printable characters from Kitty keyboard protocol CSI-u plus raw character input on layouts such as Italian ([#3780](https://github.com/badlogic/pi-mono/issues/3780)).
- Fixed API-key environment discovery and Bun startup to fall back to `/proc/self/environ` when Bun's sandbox leaves `process.env` empty ([#3801](https://github.com/badlogic/pi-mono/pull/3801) by [@mdsjip](https://github.com/mdsjip)).
- Fixed Bun sandboxed package-manager commands when `process.env` is empty ([#3807](https://github.com/badlogic/pi-mono/pull/3807) by [@mdsjip](https://github.com/mdsjip)).
- Fixed symlinked packages, resources, skills, and sessions being duplicated in selectors and loaders ([#3818](https://github.com/badlogic/pi-mono/pull/3818) by [@aliou](https://github.com/aliou)).
- Fixed Bedrock prompt-caching and adaptive-thinking capability checks for inference profile ARNs ([#3527](https://github.com/badlogic/pi-mono/pull/3527) by [@anirudhmarc](https://github.com/anirudhmarc)).
- Fixed OpenAI Codex Responses default verbosity to `low` when no verbosity is specified.
- Stopped sending empty `tools` arrays to providers that reject them when tools are disabled ([#3650](https://github.com/badlogic/pi-mono/pull/3650) by [@HQidea](https://github.com/HQidea)).
- Fixed Anthropic SSE parsing to ignore unknown proxy events such as OpenAI-style `done` terminators ([#3708](https://github.com/badlogic/pi-mono/issues/3708)).
- Fixed provider registration with override-only `models.json` entries to preserve built-in model lists ([#3651](https://github.com/badlogic/pi-mono/issues/3651)).
- Fixed `/login` to show auth supplied by `models.json` provider definitions.
- Fixed HTML export whitespace around extension-rendered tool output and expandable output hints.
- Fixed bash executor temp output streams leaking file descriptors when output was truncated by line count ([#3786](https://github.com/badlogic/pi-mono/issues/3786))
- Fixed extension `pi.setSessionName()` updates to refresh the interactive terminal title immediately ([#3686](https://github.com/badlogic/pi-mono/issues/3686))
- Fixed `/tree` cancellation via `session_before_tree` leaving the session stuck in compaction state ([#3688](https://github.com/badlogic/pi-mono/issues/3688))
- Fixed Escape interrupt handling when extensions hide the built-in working loader row ([#3674](https://github.com/badlogic/pi-mono/issues/3674))
- Fixed coding-agent test expectations for current default models and missing-auth guidance.
- Fixed long local-LLM SSE streams aborting at 5 minutes with `UND_ERR_BODY_TIMEOUT` by disabling undici `bodyTimeout`/`headersTimeout` on the global dispatcher; provider SDKs continue to enforce their own deadlines via `retry.provider.timeoutMs` ([#3715](https://github.com/badlogic/pi-mono/issues/3715))

## [0.70.2] - 2026-04-24

### Fixed

- Fixed provider retry/timeout forwarding to omit undefined provider request controls, avoiding downstream SDK validation errors such as `timeout must be an integer` when `retry.provider.timeoutMs` is not configured ([#3627](https://github.com/badlogic/pi-mono/issues/3627))

## [0.70.1] - 2026-04-24

### New Features

- DeepSeek provider support with V4 Flash/Pro models and `DEEPSEEK_API_KEY` authentication. See [README.md#providers--models](README.md#providers--models) and [docs/providers.md#api-keys](docs/providers.md#api-keys).
- Provider request timeout/retry controls via `retry.provider.{timeoutMs,maxRetries,maxRetryDelayMs}`, useful for long-running local inference and provider SDK retry behavior. See [docs/settings.md#retry](docs/settings.md#retry). ([#3627](https://github.com/badlogic/pi-mono/issues/3627))

### Added

- Added DeepSeek to built-in provider setup, default model resolution, and provider documentation.

### Fixed

- Fixed `/copy` to avoid unbounded OSC 52 writes and clipboard races that could break terminal rendering or panic the native clipboard addon ([#3639](https://github.com/badlogic/pi-mono/issues/3639))
- Fixed extension flag docs to show `pi.getFlag()` using registered flag names without the CLI `--` prefix ([#3614](https://github.com/badlogic/pi-mono/issues/3614))
- Fixed provider retry/timeout settings wiring by adding `retry.provider.{timeoutMs,maxRetries,maxRetryDelayMs}`, migrating legacy `retry.maxDelayMs`, and forwarding provider controls into `streamSimple` request options ([#3627](https://github.com/badlogic/pi-mono/issues/3627))
- Fixed Windows git package installs to bypass `cmd.exe` for native git commands, so install paths containing spaces no longer break `pi install git:...` with `fatal: Too many arguments` ([#3642](https://github.com/badlogic/pi-mono/issues/3642))
- Fixed DeepSeek V4 session replay 400 errors by sending DeepSeek-compatible thinking controls and replayed assistant `reasoning_content` fields ([#3636](https://github.com/badlogic/pi-mono/issues/3636))
- Fixed GPT-5.5 generated context window metadata to use the observed 272k limit.
- Fixed CSI-u Ctrl+letter decoding inside bracketed paste, so pasted modified-key escape sequences no longer become literal editor text ([#3623](https://github.com/badlogic/pi-mono/pull/3623) by [@Exrun94](https://github.com/Exrun94))

## [0.70.0] - 2026-04-23

### New Features

- Searchable auth provider login flow: the `/login` provider selector now supports fuzzy search/filtering, making it faster to find providers when many are configured. See [docs/providers.md](docs/providers.md). ([#3572](https://github.com/badlogic/pi-mono/pull/3572) by [@mitsuhiko](https://github.com/mitsuhiko))
- GPT-5.5 Codex support: `openai-codex/gpt-5.5` is available as a model option, including `xhigh` reasoning support and corrected priority-tier pricing.
- Terminal progress indicators are now opt-in: OSC 9;4 progress reporting during streaming/compaction is off by default and can be toggled via `terminal.showTerminalProgress` in `/settings` ([#3588](https://github.com/badlogic/pi-mono/issues/3588))
- `--no-builtin-tools` / `createAgentSession({ noTools: "builtin" })` now correctly disables only built-in tools while keeping extension tools active. See [docs/extensions.md](docs/extensions.md) and [README.md](README.md) ([#3592](https://github.com/badlogic/pi-mono/issues/3592))

### Breaking Changes

- Disabled OSC 9;4 terminal progress indicators by default. Set `terminal.showTerminalProgress` to `true` in `/settings` to re-enable ([#3588](https://github.com/badlogic/pi-mono/issues/3588))

### Added

- Added searchable auth provider login flow with fuzzy filtering in the provider selector ([#3572](https://github.com/badlogic/pi-mono/pull/3572) by [@mitsuhiko](https://github.com/mitsuhiko))
- Added GPT-5.5 Codex model
- Added auth source labels in `/login` so provider entries can show when auth comes from `--api-key`, an environment variable, or custom provider fallback without exposing secrets.

### Changed

- Updated default model selection across providers to current recommended models.
- Improved stale extension context errors after session replacement or reload to tell extension authors to avoid captured `pi`/command `ctx` and use `withSession` for post-replacement work.

### Fixed

- Fixed `/model` selector cancellation to request render instead of incorrectly triggering login selector.
- Changed login, OAuth, and extension selectors for more consistent styling.
- Added Amazon Bedrock setup guidance to `/login` and updated `/model` copy to refer to configured providers instead of only API keys.
- Improved no-model and missing-auth warnings to point users to `/login` for OAuth or API key setup.
- Fixed `/quit` shutdown ordering to stop the TUI before extension UI teardown can repaint, preserving the final rendered frame while still emitting `session_shutdown` before process exit.
- Fixed `SettingsManager.inMemory()` initial settings being lost after reloads triggered by SDK resource loading ([#3616](https://github.com/badlogic/pi-mono/issues/3616))
- Fixed `models.json` provider compatibility to accept `compat.supportsLongCacheRetention`, allowing proxies to opt out of long-retention cache fields when needed while long retention is enabled by default when requested ([#3543](https://github.com/badlogic/pi-mono/issues/3543))
- Fixed `--thinking xhigh` for `openai-codex` `gpt-5.5` so it is no longer downgraded to `high`.
- Fixed git package installs with custom `npmCommand` values such as `pnpm` by avoiding npm-specific production flags in that compatibility path ([#3604](https://github.com/badlogic/pi-mono/issues/3604))
- Fixed first user messages rendering without spacing after existing notices such as compaction summaries or status messages ([#3613](https://github.com/badlogic/pi-mono/issues/3613))
- Fixed the handoff extension example to use the replacement-session context after creating a new session, avoiding stale `ctx` errors when it installs the generated prompt ([#3606](https://github.com/badlogic/pi-mono/issues/3606))
- Fixed session replacement and `/quit` teardown ordering to run host-owned extension UI cleanup synchronously after `session_shutdown` handlers complete but before invalidating the old extension context, preventing stale extension UI from rendering against a disposed session ([#3597](https://github.com/badlogic/pi-mono/pull/3597) by [@vegarsti](https://github.com/vegarsti))
- Fixed crash on `/quit` when an extension registers a custom footer whose `render()` accesses `ctx`, by tearing down extension-provided UI before invalidating the extension runner during shutdown ([#3595](https://github.com/badlogic/pi-mono/issues/3595))
- Fixed auto-retry to treat Bedrock/Smithy HTTP/2 transport failures like `http2 request did not get a response` as transient errors, so the agent retries automatically instead of waiting for a manual nudge ([#3594](https://github.com/badlogic/pi-mono/issues/3594))
- Fixed the CLI/SDK tool-selection split so `--no-builtin-tools` and `createAgentSession({ noTools: "builtin" })` disable only built-in default tools while keeping extension/custom tools enabled, instead of falling through to the same "disable everything" path as `--no-tools` ([#3592](https://github.com/badlogic/pi-mono/issues/3592))
- Fixed remaining hardcoded `pi` / `.pi` branding to route through `APP_NAME` and `CONFIG_DIR_NAME` extension points, so SDK rebrands get consistent naming in `/quit` description, `process.title`, and the project-local extensions directory ([#3583](https://github.com/badlogic/pi-mono/pull/3583) by [@jlaneve](https://github.com/jlaneve))
- Fixed `pi-coding-agent` shipping `uuid@11`, which triggered `npm audit` moderate vulnerability reports for downstream installs; the package now depends on `uuid@14` ([#3577](https://github.com/badlogic/pi-mono/issues/3577))
- Fixed `openai-completions` streamed tool-call assembly to coalesce deltas by stable tool index when OpenAI-compatible gateways mutate tool call IDs mid-stream, preventing malformed Kimi K2.6/OpenCode tool streams from splitting one call into multiple bogus tool calls ([#3576](https://github.com/badlogic/pi-mono/issues/3576))
- Fixed `ctx.ui.setWorkingMessage()` to persist across loader recreation, matching the behavior of `ctx.ui.setWorkingIndicator()` ([#3566](https://github.com/badlogic/pi-mono/issues/3566))
- Fixed coding-agent `fs.watch` error handling for theme and git-footer watchers to retry after transient watcher failures such as `EMFILE`, avoiding startup crashes in large repos ([#3564](https://github.com/badlogic/pi-mono/issues/3564))
- Fixed built-in `kimi-coding` model generation to attach the expected `User-Agent` header so direct Kimi Coding requests use the provider's expected client identity ([#3586](https://github.com/badlogic/pi-mono/issues/3586))
- Fixed extension shortcut conflict diagnostics to display at startup instead of only on reload, so extension authors discover reserved keybinding conflicts immediately rather than discovering them later through user feedback ([#3617](https://github.com/badlogic/pi-mono/issues/3617))
- Fixed `models.json` Anthropic-compatible provider configuration to accept `compat.supportsEagerToolInputStreaming`, allowing proxies that reject per-tool `eager_input_streaming` to use the legacy fine-grained tool streaming beta header instead ([#3575](https://github.com/badlogic/pi-mono/issues/3575))
- Fixed startup banner extension labels to strip trailing `index.js`/`index.ts` suffixes ([#3596](https://github.com/badlogic/pi-mono/pull/3596) by [@aliou](https://github.com/aliou))
- Fixed OSC 9;4 terminal progress updates to stay alive in terminals such as Ghostty during long-running agent work ([#3610](https://github.com/badlogic/pi-mono/issues/3610))
- Fixed OpenAI-compatible completion usage parsing to avoid double-counting reasoning tokens already included in `completion_tokens` ([#3581](https://github.com/badlogic/pi-mono/issues/3581))
- Fixed `openai-responses` compatibility for strict OpenAI-compatible proxies by allowing `models.json` to disable the underscore-containing `session_id` header with `compat.sendSessionIdHeader: false` ([#3579](https://github.com/badlogic/pi-mono/issues/3579))
- Fixed GPT-5.5 Codex capability handling to clamp unsupported minimal reasoning to `low` and apply the model's 2.5x priority service-tier pricing multiplier ([#3618](https://github.com/badlogic/pi-mono/pull/3618) by [@markusylisiurunen](https://github.com/markusylisiurunen))

## [0.69.0] - 2026-04-22

### New Features

- TypeBox 1.x migration for extensions and SDK integrations, including TypeBox-native tool argument validation that now works in eval-restricted runtimes such as Cloudflare Workers. See [docs/extensions.md](docs/extensions.md) and [docs/sdk.md](docs/sdk.md).
- Stacked extension autocomplete providers via `ctx.ui.addAutocompleteProvider(...)`, allowing extensions to layer custom completion logic on top of built-in slash and path completion. See [docs/extensions.md#autocomplete-providers](docs/extensions.md#autocomplete-providers) and [examples/extensions/github-issue-autocomplete.ts](examples/extensions/github-issue-autocomplete.ts).
- Terminating tool results via `terminate: true`, allowing custom tools to end on a final tool call without paying for an automatic follow-up LLM turn. See [docs/extensions.md](docs/extensions.md) and [examples/extensions/structured-output.ts](examples/extensions/structured-output.ts).
- OSC 9;4 terminal progress indicators during agent streaming and compaction for supporting terminals.

### Breaking Changes

- Migrated first-party coding-agent code, SDK/examples/docs, and package metadata from `@sinclair/typebox` 0.34.x to `typebox` 1.x. New extensions, SDK integrations, and pi packages should depend on and import from `typebox`. Legacy extension loading still aliases the root `@sinclair/typebox` package, but `@sinclair/typebox/compiler` is no longer shimmed. This migration also picks up the new `@mariozechner/pi-ai` TypeBox-native validator path, so tool argument validation now works in eval-restricted runtimes such as Cloudflare Workers instead of being skipped ([#3112](https://github.com/badlogic/pi-mono/issues/3112))
- Session-replacement commands now invalidate captured pre-replacement session-bound extension objects after `ctx.newSession()`, `ctx.fork()`, and `ctx.switchSession()`. Old `pi` and command `ctx` references now throw instead of silently targeting the replaced session. Migration: if code needs to keep working in the replacement session after one of those calls, pass `withSession` to that same method and do the post-switch work there. In practice, move post-switch `pi.sendUserMessage()`, `pi.sendMessage()`, and command-ctx/session-manager access into `withSession`, and use only the `ReplacedSessionContext` passed to that callback for session-bound operations. Footguns: `withSession` runs after the old extension instance has already received `session_shutdown`, old cleanup may already have invalidated captured state, captured old `pi` / old command `ctx` are stale, and previously extracted raw objects such as `const sm = ctx.sessionManager` remain the caller's responsibility and must not be reused after the switch.

### Added

- Added support for terminating tool results via `terminate: true`, allowing custom tools to end the current tool batch without an automatic follow-up LLM call, plus a `structured-output.ts` extension example and extension docs showing the pattern ([#3525](https://github.com/badlogic/pi-mono/issues/3525))
- Added OSC 9;4 terminal progress indicators during agent streaming and compaction, so terminals like iTerm2, WezTerm, Windows Terminal, and Kitty show activity in their tab bar
- Added `ctx.ui.addAutocompleteProvider(...)` for stacking extension autocomplete providers on top of the built-in slash/path provider, plus a `github-issue-autocomplete.ts` example and extension docs ([#2983](https://github.com/badlogic/pi-mono/issues/2983))

### Fixed

- Fixed exported session HTML to sanitize markdown link URLs before rendering them into anchor tags, blocking `javascript:`-style payloads while preserving safe links in shared/exported sessions ([#3532](https://github.com/badlogic/pi-mono/issues/3532))
- Fixed `ctx.getSystemPrompt()` inside `before_agent_start` to reflect chained system-prompt changes made by earlier `before_agent_start` handlers, and clarified the extension docs around provider-payload rewrites and what `ctx.getSystemPrompt()` does and does not report ([#3539](https://github.com/badlogic/pi-mono/issues/3539))
- Fixed built-in `google-gemini-cli` model lists and selector entries to include `gemini-3.1-flash-lite-preview`, so Cloud Code Assist users no longer need manual `--model` fallback selection to use it ([#3545](https://github.com/badlogic/pi-mono/issues/3545))
- Fixed extension session-replacement flows so `ctx.newSession()`, `ctx.fork()`, `ctx.switchSession()`, and imported-session replacements fully rebind before post-switch work runs, added `withSession` replacement callbacks with fresh `ReplacedSessionContext` helpers, and make stale pre-replacement `pi` / `ctx` session-bound accesses throw instead of silently targeting the wrong session ([#2860](https://github.com/badlogic/pi-mono/issues/2860))
- Fixed `models.json` built-in provider overrides to accept `headers` without requiring `baseUrl`, so request-header-only overrides now load and apply correctly ([#3538](https://github.com/badlogic/pi-mono/issues/3538))

## [0.68.1] - 2026-04-22

### New Features

- Fireworks provider support with built-in models and `FIREWORKS_API_KEY` auth. See [README.md#providers--models](README.md#providers--models) and [docs/providers.md](docs/providers.md).
- Configurable inline tool image width via `terminal.imageWidthCells` in `/settings`. See [docs/settings.md#terminal--images](docs/settings.md#terminal--images).

### Added

- Added built-in Fireworks provider support, including `FIREWORKS_API_KEY` setup/docs and the default Fireworks model `accounts/fireworks/models/kimi-k2p6` ([#3519](https://github.com/badlogic/pi-mono/issues/3519))

### Fixed

- Fixed interactive inline tool images to honor configurable `terminal.imageWidthCells` via `/settings`, so tool-output images are no longer hard-capped to 60 terminal cells ([#3508](https://github.com/badlogic/pi-mono/issues/3508))
- Fixed `sessionDir` in `settings.json` to expand `~`, so portable session-directory settings no longer require a shell wrapper ([#3514](https://github.com/badlogic/pi-mono/issues/3514))
- Fixed parallel tool-call rows to leave the pending state as soon as each tool is finalized, while still appending persisted tool results in assistant source order ([#3503](https://github.com/badlogic/pi-mono/issues/3503))
- Fixed exported session markdown to render Markdown while showing HTML-like message content such as `<file name="...">...