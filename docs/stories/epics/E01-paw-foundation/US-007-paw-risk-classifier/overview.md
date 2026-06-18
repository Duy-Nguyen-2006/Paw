
# US-007: Paw Classifier And Risk Scoring Policy

## User Story

As Paw's orchestrator, I need a deterministic classifier and risk scorer so
tasks are conservatively routed to trivial, standard, or high-risk execution
before any tool or model path is selected.

## Source References

- `SPEC.md` §6.2 Complexity routing.
- `SPEC.md` §7 Risk scoring and permission model.
- `paw-spec/config.yaml` `routing.trivial_requires_all` section.

## Scope

Implement pure TypeScript helpers that compute the maximum tool risk level and
classify a task from structured risk inputs.

## Non-Goals

- No CLI prompt changes.
- No file-system scanning.
- No LLM classifier.
- No orchestration state transitions.

## Acceptance Criteria

- Risk inputs map to the correct maximum `PawRiskLevel`.
- Trivial classification requires the configured `trivial_requires_all` checks.
- Security, dependency, schema/database, destructive, deploy, cross-layer, or
  multi-file inputs conservatively escalate the class.
- Ambiguous or high-risk signals choose the higher task class.
- Classification returns reasons suitable for reports and future prompts.
