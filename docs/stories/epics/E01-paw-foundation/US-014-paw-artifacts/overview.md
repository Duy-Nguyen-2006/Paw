# US-014: Paw Artifact Path Persistence

## User Story

As Paw's sub-agent runtime, I need deterministic artifact path helpers so agent
reports are written under `.paw/artifacts/` with valid `artifact_ref` values and
collision-resistant names.

## Source References

- `SPEC.md` §12 Persistence.
- `SPEC.md` §14.1 Sub-agent contract.
- `paw-spec/config.yaml` persistence gitignore policy.

## Scope

Implement artifact directory/reference helpers and report write/read helpers for
`.paw/artifacts/<UTC>-<slug>-<shortid>/<agent>/report.md`.

## Non-Goals

- No sub-agent execution.
- No screenshot or binary artifact handling.
- No retention cleanup.
- No final report generation.

## Acceptance Criteria

- Artifact directory names include UTC timestamp, slug, and short id.
- Slugs are filesystem-safe and bounded.
- Report paths are created per sub-agent role.
- `artifact_ref` matches the existing sub-agent output schema.
- Report writes create parent directories and preserve content.
- Invalid roles or refs are rejected.
