
# Paw Threat Model

## Scope

This threat model covers Paw v1 as described by `docs/product/paw-overview.md`,
`docs/product/paw-runtime.md`, `docs/product/paw-security.md`, the accepted Paw
ADRs, and `paw-spec/config.yaml`.

It distinguishes current G0 implementation evidence from future runtime
enforcement. Policy modules and deterministic evaluators exist for several
controls, but full CLI orchestration and live runtime enforcement are still P1+
work unless a linked story says otherwise.

## Assets

| Asset | Why it matters |
| --- | --- |
| User repository files | Paw reads and edits source code; accidental or unauthorized edits are product failures. |
| Git state and working tree | Paw must avoid overwriting user or parallel-agent work and must support recovery. |
| `.paw/` session state | Sessions, journals, locks, artifacts, checkpoints, and reports drive resume and final evidence. |
| Provider credentials and local secrets | API keys, tokens, cookies, private keys, and auth headers must not enter prompts, logs, or artifacts. |
| User intent, SPEC, plan, and decisions | These govern what Paw may build and what evidence is required. |
| Sub-agent outputs and artifacts | Scout, planner, worker, and reviewer outputs influence edits and verification. |
| Runtime configuration | `paw-spec/config.yaml` controls model routing, budgets, approvals, sandbox policy, and verification defaults. |
| Verification evidence | Final reports must distinguish passed, unverified, degraded, and blocked gates. |

## Actors

| Actor | Capability |
| --- | --- |
| User | Provides intent, approvals, credentials, and repository access. |
| Paw orchestrator | Classifies work, assembles context, runs sub-agents, applies edits, verifies, and reports. |
| Sub-agents | Produce bounded scout, planner, worker, or reviewer outputs through the sub-agent contract. |
| External model providers | Return generated content and may fail, rate-limit, or degrade. |
| Local tools | Read, write, build, test, install dependencies, or inspect the repository according to risk level. |
| Untrusted content | README files, issues, comments, logs, web pages, and browser output that may contain prompt injection. |
| Parallel agents or humans | May edit the same repository while Paw is running. |

## Trust Boundaries

| Boundary | Required control |
| --- | --- |
| User prompt to Paw state | Conservative classification and clarification before execution. |
| Filesystem to context | File-size caps, secret path exclusion, and metadata-only handling for oversized or binary files. |
| Untrusted content to prompts | Treat as data only; never as executable instructions. |
| Model output to runtime decisions | Schema validation, bounded retries, and blocked states instead of crashes. |
| Tool request to host execution | Approval matrix, sandbox selection, and non-interactive fail-closed behavior. |
| Runtime state to disk | Atomic writes, session locks, append-only slice journal, and retention policy. |
| Provider failure to task progress | Retry, failover, degraded flag, blocked state, and resume evidence. |
| Final report to user | Explicit disclosure of evidence, risks, unverified gates, and degraded execution. |

## Threats And Controls

| Threat | Control from docs/config | Current G0 implementation evidence | Runtime enforcement status |
| --- | --- | --- | --- |
| Prompt injection from untrusted content causes Paw to run commands or leak data. | `paw-spec/config.yaml` defines `injection.untrusted_sources`, read-only structured handling, and a red-team block target. `docs/product/paw-security.md` states untrusted instructions cannot raise permissions. | Security policy coverage exists through US-011. | Future runtime enforcement must keep untrusted content read-only and data-only during context assembly and sub-agent execution. |
| Secrets are read into prompts, logs, or artifacts. | `secrets.read_plane_exclude`, redaction at IO write, redaction patterns, and high-entropy flagging are defaults in config. | US-011 covers sandbox and secret policy behavior. | Future runtime enforcement must apply path exclusion before reading and redaction before writing artifacts or logs. |
| Write-capable or destructive tools run without approval. | `approval.risk_levels`, approval matrix, non-interactive fail-closed defaults, and R7 human-only policy are frozen in config. | US-005 covers approval policy. | Future CLI/tool orchestration must evaluate every tool request before execution. |
| Non-interactive mode bypasses user decisions. | Config requires product approval fail-closed, R3-R6 explicit allow flags, and R7 fail-closed always. | US-005 and `docs/product/paw-security.md` define the policy. | Future print/JSON/CI modes must block with resumable state and non-zero exit where required. |
| Sandbox unavailable but write-capable work continues. | Config prefers bubblewrap+Landlock, then bubblewrap, then userns; unavailable sandbox forces read-only unless explicitly overridden. | US-011 covers security policy; US-023 covers injected sandbox detection and fallback-matrix evidence. | Live cross-distro sandbox execution remains future/manual validation. Runtime must evaluate sandbox fallback before tool execution. |
| Model routing hardcodes provider or model names and bypasses failover policy. | `model_tiers`, `role_routing`, `thinking`, and `failover_order` in config are the source of truth. | US-012 covers model routing policy. | Future provider execution must resolve model IDs from config and must not hardcode concrete model names. |
| Budget or context limits are silently exceeded. | Config defines per-class budgets, per-slice soft fraction, context caps, file and tool-output caps, and required span recall minimum. | US-006 covers budget policy; US-008 covers context budget policy; US-026 covers deterministic cost/latency/cache evaluator evidence. | Future runtime must enforce warn/block behavior and context assembly decisions during live tasks. |
| Provider failure causes data loss, silent degradation, or stalled tasks. | Config defines LLM timeout, retries, failover, sub-agent timeout, loop caps, and active-time pause states. | US-009 and US-018 cover policy behavior; US-025 covers deterministic resilience drill evaluator evidence. | Live provider chaos execution remains future/manual validation. Runtime must mark degraded failover and blocked provider exhaustion. |
| Invalid or oversized sub-agent output corrupts orchestration. | `paw-spec/schemas/subagent-contract.schema.json` is the canonical contract; runtime docs require one retry then blocked. Handoff caps are in config. | US-016 covers response fallback; US-021 covers SubAgentRuntime foundation; US-022 covers bounded artifact isolation. | Real provider invocation and child-process execution remain future work. |
| Patch application overwrites user or parallel-agent work. | Config defines diff-first strategy, fuzzy retries, full-file rewrite cap, and content-hash idempotency. Runtime docs require slice journal entries. | US-010 covers edit policy; US-013 covers slice journal persistence. | Future worker execution must re-derive or block on base drift and must not silently overwrite. |
| Session state becomes corrupt or unrecoverable. | Config defines atomic writes, lock heartbeat TTL, retention, and `.paw/.gitignore` policy. Runtime docs define blocked lock behavior and journal/checkpoint contracts. | US-003, US-004, US-013, US-014, and US-015 cover persistence helpers and metadata. | Actual shadow worktree creation and rollback execution remain future slices. |
| Final report claims success without proof. | Product docs require final report disclosure of evidence, risks, unverified gates, and degraded execution. Config defines v1 verification gates and KPI hard gates. | US-017 covers final report assembly policy. | Future CLI report command and artifact persistence remain separate runtime slices. |

## Current Implementation Boundary

The following G0 evidence is implemented as policy modules, helpers, or
deterministic evaluators:

- Approval, budget, risk classification, context budget, resilience, edit,
  sandbox/secret, model routing, active-time, plan-slice, retention, and final
  report policies.
- Session, slice journal, artifact path, and checkpoint metadata persistence
  helpers.
- Sub-agent runtime interface and response fallback behavior.
- S1 through S5 spike evidence, with the limitations recorded in each spike
  file.

The following are not yet proven as complete live runtime enforcement:

- Full Paw CLI command orchestration.
- Real provider and child-agent execution.
- Live cross-distro sandbox execution.
- Live high-risk task cost/latency measurement.
- Live 100k-file monorepo scout benchmark.
- Live provider chaos and resume drill.
- Shadow worktree rollback execution.

## Residual Risks For P1

- Enforcement gaps can appear if future CLI/tool code bypasses policy modules.
- Config drift can appear if defaults are copied into code instead of loaded
  from `paw-spec/config.yaml`.
- Live platform behavior may differ from injected evaluator evidence.
- Parallel worktree edits remain risky until edit application, checkpoint, and
  rollback execution are wired end to end.

P1 implementation should treat these as validation targets, not as already
closed runtime behavior.
