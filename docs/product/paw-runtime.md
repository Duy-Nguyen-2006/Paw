# Paw Runtime Contract

## State Machine

Paw persists one session per task. The v1 state machine is:

```text
IDLE -> INTAKE -> CLASSIFYING -> CLARIFYING -> SPEC_DRAFTED -> SPEC_APPROVED
  -> SCOUTING -> PLAN_DRAFTED -> PLAN_APPROVED -> SLICE_SELECT
  -> IMPLEMENTING -> REVIEWING -> VERIFYING -> SLICE_DONE
  -> FINAL_REPORT -> IDLE
```

Blocked states must be explicit and resumable:

- `BLOCKED_NEEDS_USER_DECISION`
- `BLOCKED_BUDGET_EXCEEDED`
- `BLOCKED_TEST_FAILURE`
- `BLOCKED_BUILD_FAILURE`
- `BLOCKED_TOOL_PERMISSION`
- `BLOCKED_CONTEXT_MISSING`
- `BLOCKED_PROVIDER_UNAVAILABLE`
- `BLOCKED_SANDBOX_UNAVAILABLE`
- `BLOCKED_PATCH_APPLY_FAILED`

Every step must advance state, enter a blocked state with reason and suggested
action, or escalate to the user. Silent waiting is invalid behavior.

## Resilience Contract

Provider, tool, sub-agent, and verification outcomes must be converted into
explicit runtime decisions. Retryable provider failures use configured retry and
failover policy; exhausted providers become `BLOCKED_PROVIDER_UNAVAILABLE`.
Tool and sub-agent timeouts become blocked decisions, not silent waits. Gates
that cannot run are reported as unverified with reasons, and failover to a lower
model tier marks the affected step as degraded.

## Runtime Configuration

`paw-spec/config.yaml` is the default runtime configuration source. Code must
not hardcode concrete provider model IDs, budget values, context caps, retry
counts, approval matrices, or sandbox defaults when those values exist in the
config file.

The configuration covers:

- Provider adapters and model-tier routing.
- Context caps and sub-agent handoff budgets.
- Per-class task budgets and per-slice sub-budgets.
- Resilience timeout and retry policy.
- Conservative task classification.
- Approval and non-interactive fail-closed policy.
- Sandbox fallback and secret redaction defaults.
- Edit strategy and idempotency.
- Persistence and retention.
- Verification gates and KPI targets.

## Model Routing Contract

Model routing is config-derived. Roles resolve through `role_routing` into
stable tiers, tiers resolve into provider/model config, and failover follows the
configured `model_tiers.failover_order`. Extended thinking is enabled only for
configured task classes and roles; a strong model tier alone does not bypass
the thinking gate.

## Budget Contract

Task budget checks are runtime policy decisions. The configured per-class token
and USD caps determine whether a task is within budget, should warn, requires
interactive approval to continue, or must fail closed in non-interactive modes.

Per-slice checks use `budget.per_slice.soft_fraction_of_task` to flag a slice
that is consuming too much of the task budget before it silently exhausts the
whole task allowance.

## Sub-Agent Contract

All scout, planner, worker, and reviewer outputs must validate against
`paw-spec/schemas/subagent-contract.schema.json`.

Invalid sub-agent JSON gets one retry. A second invalid response becomes a
blocked result rather than crashing the orchestrator.

The orchestrator reads bounded machine summaries and follows `artifact_ref` for
drill-down. Required planner references must not be silently dropped from a
bounded handoff.

## Multi-Slice Execution

The planner emits ordered vertical slices. The orchestrator runs the worker,
reviewer, and verifier loop per slice, records a checkpoint and journal entry
per slice, and never redoes completed slices on resume.

## Classification Contract

Task classification is conservatively biased. A task is `trivial` only when the
configured `routing.trivial_requires_all` requirements are all satisfied:
bounded file count, no cross-layer work, no risk above the configured maximum,
and no security-sensitive path. Signals such as new dependencies, schema or
database changes, destructive commands, deploy/infra changes, or secrets/auth
paths escalate the task before execution planning.

## Context Budget Contract

Context assembly must use configured caps rather than raw dumps. Task class caps
limit working context, sub-agent handoff caps bound machine summaries, and file
or tool outputs over their configured limits become summaries, metadata-only
references, or explicit escalations. Required planner spans must not be silently
dropped; callers receive a drill-down/escalation decision when they cannot fit.

## Edit Strategy Contract

Workers use explicit edit policy decisions before applying changes. The default
sequence is diff-first, then bounded fuzzy retries, then full-file rewrite only
for files at or below the configured line-count limit. If the fallback chain
cannot safely apply, the worker blocks with `BLOCKED_PATCH_APPLY_FAILED`.
Content hashes drive idempotency: already-applied changes become no-ops, while
unexpected base drift requires re-deriving the edit instead of overwriting.

## Slice Journal Contract

Each session has an append-only `slice-journal.jsonl` file. Entries record slice
id, changed path, change type, content hash, apply method, and timestamp. Resume
logic uses the journal to avoid redoing completed slice edits and to identify
already-applied changes before patch application.

## Artifact Contract

Sub-agent reports live under `.paw/artifacts/<UTC>-<slug>-<shortid>/<agent>/`.
The machine-readable sub-agent output references reports with
`.paw/artifacts/.../<agent>/report.md`. Artifact names must be collision
resistant and filesystem-safe, while the returned ref remains relative to the
repository root.

## Checkpoint Contract

Checkpoint metadata lives under `.paw/checkpoints/<session>/<checkpoint>/`.
Checkpoint names are UTC timestamp, slice id, and short id so per-slice rollback
state can be correlated without touching the user's git branch, index, or stash.
Metadata records what Paw intended to protect; actual shadow worktree creation
and rollback execution are separate runtime steps.

## Persistence Contract

Paw project state lives under `.paw/`. Initialization creates durable defaults
without overwriting existing files:

- `config.yaml`
- `version`
- `memory/memories.yaml`
- `rules/`
- `decisions/`
- `.gitignore`

Volatile runtime paths such as sessions, artifacts, cache, logs, and pending or
rejected memory are ignored inside `.paw/`. Writes that persist session state
must use write-temp-rename semantics so interruption does not leave partial JSON
files.

Session locks are stored as durable metadata in
`.paw/sessions/<id>/session.lock` with `pid`, `host`, `heartbeat_ts`, and `ttl`.
A lock whose process is dead or whose heartbeat is older than its TTL is stale
and may be reclaimed with an explicit warning. Lock acquisition must return a
structured blocked result instead of waiting indefinitely.

## Verification Contract

Verification gates that cannot run are reported as unverified with reasons.
Paw may finish as `done_with_unverified[...]`, but it must not report false
success.
