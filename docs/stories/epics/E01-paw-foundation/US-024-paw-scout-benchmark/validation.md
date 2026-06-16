# Validation

## Proof Strategy

This story is complete when focused tests prove PASS and KILL outcomes for
repo-size, timing, token, and cache thresholds. The root check must also pass.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | PASS metrics and threshold-specific KILL failures. |
| Integration | Evidence text includes `ripgrep`, `ctags`, and `git` measurements. |
| E2E | Not applicable; no benchmark CLI yet. |
| Platform | Injected benchmark metrics stand in for live large-repo execution. |
| Performance | Threshold evaluator covers active-time and token budget limits. |
| Logs/Audit | Result records evidence and failure issues. |

## Fixtures

- In-memory benchmark measurements.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-scout-benchmark.test.ts
npm run check
scripts/bin/harness-cli story verify US-024
```

## Acceptance Evidence

- Focused US-024 test passed: 1 file, 6 tests.
- Focused Paw suite through US-024 passed: 24 files, 191 tests.
- Root `npm run check` passed with no fixes applied.
- Harness story verification passed.
- S4 spike tracker is marked PASS with deterministic injected benchmark
  evaluator evidence in `paw-spec/docs/spikes/S4-scout-large-repo.md`.
