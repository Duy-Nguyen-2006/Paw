# US-010: Paw Edit Strategy Policy

## User Story

As Paw's worker, I need a deterministic edit strategy policy so patch failures
fall back safely and large full-file rewrites block instead of risking silent
corruption.

## Source References

- `SPEC.md` §8.5 Idempotency and resumability.
- `SPEC.md` §9.2 Patch-apply fallback.
- `SPEC.md` ADR-21 Edit strategy.
- `paw-spec/config.yaml` `edit` section.

## Scope

Implement pure TypeScript helpers that select the next edit attempt from config
and classify idempotent apply outcomes.

## Non-Goals

- No patch application.
- No fuzzy matching implementation.
- No file reads/writes.
- No checkpoint or rollback implementation.

## Acceptance Criteria

- First attempt is diff-first.
- Failed diff attempts fall back to fuzzy apply up to the configured retry cap.
- Failed fuzzy attempts fall back to full-file rewrite only when the file line
  count is at or below the configured maximum.
- Large files block with `PATCH_APPLY_FAILED`.
- Already-applied content-hash matches return no-op.
- Base drift returns a rederive/block decision rather than overwriting.
