
# Validation

## Proof Strategy

This story is complete when focused tests prove canonical artifact writes,
oversized report rejection before write, and invalid artifact path rejection.
The root check must also pass.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Byte bound enforcement and path validation. |
| Integration | Writes through existing `.paw/artifacts/<artifact>/<role>/report.md` helpers. |
| E2E | Not applicable; no CLI command wiring yet. |
| Platform | Filesystem path behavior covered with temporary directories. |
| Performance | Not applicable for small report strings. |
| Logs/Audit | Result records byte count, max bytes, and artifact ref. |

## Fixtures

- Temporary repo directories.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-subagent-artifact-isolation.test.ts
npm run check
scripts/bin/harness-cli story verify US-022
```

## Acceptance Evidence

- Focused US-022 test passed: 1 file, 3 tests.
- Focused Paw suite through US-022 passed: 22 files, 180 tests.
- Root `npm run check` passed after Biome formatted the new artifact helper,
  then passed again with no fixes applied.
- Harness story verification passed.
- S1 spike tracker is marked PASS with evidence in
  `paw-spec/docs/spikes/S1-subagent-runtime.md`.
