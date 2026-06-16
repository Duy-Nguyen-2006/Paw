# Validation

## Proof Strategy

This story is complete when focused tests prove primitive detection for every
fallback matrix path and prove no-sandbox R1 writes block through existing
sandbox policy. The root check must also pass.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | bubblewrap+Landlock, bubblewrap-only, userns-only, none. |
| Integration | Detector output feeds `evaluatePawSandbox` for R1 no-sandbox blocking. |
| E2E | Not applicable; no CLI command wiring yet. |
| Platform | Injected platform probes simulate the fallback matrix. |
| Performance | Not applicable for boolean probe mapping. |
| Logs/Audit | Result carries warnings and remediation text. |

## Fixtures

- In-memory platform probe records.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-sandbox-detector.test.ts
npm run check
scripts/bin/harness-cli story verify US-023
```

## Acceptance Evidence

- Focused US-023 test passed: 1 file, 5 tests.
- Focused Paw suite through US-023 passed: 23 files, 185 tests.
- Root `npm run check` passed after Biome formatted the detector files, then
  passed again with no fixes applied.
- Harness story verification passed.
- S3 spike tracker is marked PASS with injected fallback-matrix evidence in
  `paw-spec/docs/spikes/S3-sandbox.md`.
