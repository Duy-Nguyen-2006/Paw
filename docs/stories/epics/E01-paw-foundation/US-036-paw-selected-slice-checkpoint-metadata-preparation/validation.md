
# Validation

## Proof Strategy

US-036 is complete when the core helper writes checkpoint metadata only under a
live current session lock, only for `SLICE_SELECT` with a selected slice, and
returns stable no-write results for lock and state rejection paths.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Result discrimination, selected-slice validation, deterministic checkpoint name and timestamp mapping, optional notes handling, and changed file preservation. |
| Integration | Temp-project `.paw/` session lock/state reads, checkpoint metadata writes, missing-lock no-write path, stale-lock no-write path, foreign-lock no-write path, wrong-state no-write path, and missing-selected-slice no-write path. |
| E2E | Not applicable; no full interactive Paw workflow is implemented. |
| Platform | Covered by temp-directory filesystem checks for `.paw/` checkpoint paths. |
| Performance | Not applicable; helper performs bounded lock, state, and metadata file operations. |
| Logs/Audit | Not applicable; helper returns structured metadata for future runtime and CLI callers. |

## Fixtures

- Temporary repositories under the OS temp directory.
- Deterministic session ids, lock owners, timestamps, base tree ids, short ids,
  selected slice ids, changed file lists, and optional notes.
- Existing `readPawCheckpointMetadata` assertions for persisted metadata.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-slice-checkpoint.test.ts test/paw-checkpoints.test.ts test/paw-slice-selection.test.ts
scripts/bin/harness-cli story verify US-036
npm run check
```

## Acceptance Evidence

- Focused slice-checkpoint and adjacent Paw tests passed:
  `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-slice-checkpoint.test.ts test/paw-checkpoints.test.ts test/paw-slice-selection.test.ts`
  with 19 tests passing.
- Harness story verification passed:
  `scripts/bin/harness-cli story verify US-036`.
- Root repository check passed: `npm run check`.
