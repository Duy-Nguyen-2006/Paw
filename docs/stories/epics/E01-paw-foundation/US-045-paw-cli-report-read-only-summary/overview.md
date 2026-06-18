
# US-045: Paw CLI Report Read-Only Summary

## Summary

Add `paw report <session-id>` as a read-only CLI route that prints the persisted
final report markdown for a Paw session.

## Scope

- Add a report command module that reads `.paw/sessions/<session>/summary.md`.
- Route `paw report <session-id>` through the Paw command dispatcher before the
  normal agent runtime.
- Return clear no-write messages for missing `.paw`, missing reports, missing
  session ids, help, and extra arguments.
- Export the report command helpers for package consumers and tests.

## Acceptance Criteria

- Existing session summary markdown is printed unchanged.
- Missing `.paw` and missing summary files do not create files.
- Missing session id and extra argument paths set `process.exitCode = 1` without
  throwing.
- `paw report --help` documents the command.
- Focused tests, Harness story verification, and root `npm run check` pass.
