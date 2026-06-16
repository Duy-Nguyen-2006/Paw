# US-020: Paw Retention Cleanup Planning

## User Story

As Paw's cleanup command, I need a deterministic retention plan so old sessions
and artifacts can be removed without guessing or deleting too much.

## Source References

- `SPEC.md` §12 Persistence.
- `paw-spec/config.yaml` `persistence.retention`.

## Scope

Implement a pure TypeScript retention planner that identifies sessions and
artifacts eligible for cleanup from metadata records and retention config.

## Non-Goals

- No filesystem deletion.
- No `paw clean` CLI command.
- No filesystem scanning.
- No artifact/session migration.

## Acceptance Criteria

- Keeps the newest configured number of sessions.
- Deletes older sessions beyond the keep count.
- Deletes artifacts older than the configured retention days.
- Preserves artifacts within the retention window.
- Rejects invalid timestamps or retention config with path-level issues.
