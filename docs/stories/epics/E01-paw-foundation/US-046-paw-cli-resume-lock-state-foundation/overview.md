# US-046: Paw CLI Resume Lock-State Foundation

## Summary

Add `paw resume <session-id>` as a bounded resume foundation command. The
command checks that a session exists, acquires the session lock, reports the
current persisted state and slice counts, reports stale-lock reclamation, and
releases the lock before exiting.

## Scope

- Add a resume command module for existing Paw sessions.
- Route `paw resume <session-id>` through the Paw command dispatcher before the
  normal agent runtime.
- Return clear messages for missing `.paw`, missing session state, invalid
  session state, live locks, help, missing session ids, and extra arguments.
- Export the resume command helpers for package consumers and tests.

## Acceptance Criteria

- Existing session state is summarized without changing the state file.
- The command acquires and releases the current session lock.
- Stale locks are reclaimed and reported, then released after the summary.
- Live locks owned by another host/pid are reported without being released.
- Missing `.paw` and missing session state do not create session state files.
- Focused tests, Harness story verification, and root `npm run check` pass.
