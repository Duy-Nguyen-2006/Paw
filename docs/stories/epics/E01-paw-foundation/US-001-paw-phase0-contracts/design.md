
# Design

## Domain Model

The initial domain concepts are:

- `PawRuntimeConfig`: parsed defaults from `paw-spec/config.yaml`.
- `PawRiskLevel`: runtime tool risk level from R0 through R7.
- `PawTaskClass`: `trivial`, `standard`, or `high_risk`.
- `PawSubAgentOutput`: validated scout, planner, worker, or reviewer contract.
- `PawBlockedReason`: resumable blocked state code, message, and suggested
  action.

## Application Flow

Foundation consumers load the runtime config from the repository spec bundle,
validate it into typed values, and use those values rather than hardcoded
defaults. Sub-agent output validation returns structured success or failure so
the future orchestrator can retry once and then block without crashing.

## Interface Contract

This slice exposes TypeScript functions from `packages/coding-agent/src/paw/`:

- Load default Paw runtime config.
- Validate Paw sub-agent output.
- Export core Paw contract types.

The future CLI will import this foundation. This slice does not add the `paw`
binary yet.

## Data Model

No database schema changes. Durable harness rows are recorded through
`scripts/bin/harness-cli`.

## UI / Platform Impact

No TUI or CLI behavior changes in this slice.

## Observability

Validation failures should include path-level messages that can be written into
future Paw artifacts or final reports.

## Alternatives Considered

1. Wire the full `paw` command immediately.
   Rejected for this slice because `SPEC.md` requires Phase 0 gates before full
   production orchestration.
2. Keep Paw only in markdown for now.
   Rejected because the first implementation needs typed contracts that later
   slices can safely build on.
