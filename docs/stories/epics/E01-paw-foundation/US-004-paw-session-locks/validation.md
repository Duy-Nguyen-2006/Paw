
# Validation

## Proof Strategy

This story is complete when focused tests prove session state persistence, live
lock blocking, stale lock reclamation by expired heartbeat, stale lock
reclamation by dead PID, heartbeat refresh, and lock release. The root check must
also pass.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Lock stale predicate for live/dead PID and expired heartbeat. |
| Integration | Temporary-directory state write/read, lock acquire/block/reclaim/release. |
| E2E | Not applicable; no CLI command yet. |
| Platform | Local process liveness check and filesystem semantics. |
| Performance | Not applicable for one session lock. |
| Logs/Audit | Lock acquisition result marks stale reclamation explicitly. |

## Fixtures

- Temporary directories.
- In-memory Paw session state objects.
- Lock files with current PID and impossible PID values.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-session-store.test.ts
npm run check
scripts/bin/harness-cli story verify US-004
```

## Acceptance Evidence

- `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-session-store.test.ts test/paw-persistence.test.ts test/paw-state.test.ts test/paw-contracts.test.ts`
  passed: 22 tests in 4 files.
- `npm run check` passed from the repository root with no fixes applied on the
  final run.
- `scripts/bin/harness-cli story verify US-004` passed.
