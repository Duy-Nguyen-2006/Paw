# US-006: Paw Runtime Budget Policy

## User Story

As Paw's orchestrator, I need a runtime budget policy that evaluates per-task
and per-slice spend against the configured limits, so interactive runs can ask
before continuing and non-interactive runs fail closed without hanging.

## Source References

- `SPEC.md` §8.6 Budgets.
- `SPEC.md` §9.6 Non-Interactive / CI Policy.
- `SPEC.md` §25 Non-Negotiable Rules.
- `paw-spec/config.yaml` `budget` section.

## Scope

Implement pure TypeScript budget policy helpers under
`packages/coding-agent/src/paw/`. The helpers must be config-backed and return
structured decisions that future CLI/orchestrator wiring can consume.

## Non-Goals

- No CLI flag parsing.
- No process exit behavior.
- No provider token accounting.
- No persistence writes.

## Acceptance Criteria

- Per-class task budget status is evaluated from `PawRuntimeConfig["budget"]`.
- Warn thresholds are detected before hard exceedance.
- Interactive over-budget decisions require user approval.
- Non-interactive over-budget decisions fail closed.
- Per-slice soft budget status is derived from the configured task budget.
- Blocked decisions include code, message, and suggested action.
