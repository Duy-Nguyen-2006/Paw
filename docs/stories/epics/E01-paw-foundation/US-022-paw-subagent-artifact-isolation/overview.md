
# US-022: Paw S1 Bounded Sub-Agent Artifact Isolation

## User Story

As Paw's sub-agent runtime, I need bounded artifact report handling so child
agent detail can be stored under canonical `.paw/artifacts` refs without letting
large or escaped artifacts enter parent context.

## Source References

- `SPEC.md` §14 Sub-agent contract.
- `paw-spec/docs/decisions/ADR-01.md`.
- `paw-spec/docs/decisions/PHASE0-SPIKE-TRACKER.md` S1.

## Scope

Add deterministic artifact report isolation for sub-agent output: canonical
artifact refs, role-scoped report paths, max byte enforcement, and S1 spike
evidence for the interface-level runtime contract.

## Non-Goals

- No real provider or child process execution.
- No sandbox implementation.
- No CLI command wiring.
- No context retrieval drilldown implementation.

## Acceptance Criteria

- Writes report content only under the canonical role-specific artifact path.
- Rejects oversized artifact report content before writing.
- Rejects invalid artifact names or escaped refs through existing path guards.
- Exposes public artifact isolation types and helper.
- Records S1 spike evidence as PASS for the interface-level runtime spike.
