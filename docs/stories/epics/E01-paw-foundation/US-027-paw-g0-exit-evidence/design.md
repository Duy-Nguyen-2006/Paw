# Design

## Domain Model

This story adds documentation evidence only. The evidence model is:

- Checklist item: a G0 exit requirement from the Phase 0 spike tracker.
- Evidence link: an existing or new source-of-truth document supporting that
  item.
- Limit: an explicit statement of what the evidence does not prove.

## Application Flow

No runtime flow changes.

The documentation flow is:

1. Read current Paw product docs, config, tracker, matrix, spike evidence, and
   accepted ADR inventory.
2. Add the G0 report as the evidence index.
3. Add the threat model as the security risk register for P1.
4. Add the config freeze doc as the P1 defaults control.
5. Update tracker and matrix references after the docs exist.

## Interface Contract

No CLI, API, or package interface changes.

The documentation contract is that future P1 work can cite:

- `paw-spec/docs/G0-EXIT-REPORT.md` for G0 checklist evidence.
- `paw-spec/docs/THREAT-MODEL.md` for security scope and enforcement gaps.
- `paw-spec/docs/CONFIG-FREEZE.md` for config-derived defaults.

## Data Model

No schema, migration, or persistent data changes.

Harness durable story metadata for US-027 should reflect docs-only proof with no
unit, integration, E2E, or platform test columns claimed.

## UI / Platform Impact

No UI, shell, deployment, browser, mobile, or desktop behavior changes.

## Observability

No runtime logs or metrics. Evidence is captured in docs, Harness matrix
updates, and the final task trace.

## Alternatives Considered

1. Mark G0 complete only in the spike tracker.
   - Rejected because it would not preserve per-checklist evidence or limits.
2. Treat PASS spikes as live runtime proof.
   - Rejected because existing spike docs explicitly limit S1-S5 evidence to
     interface-level or deterministic evaluator proof where applicable.
