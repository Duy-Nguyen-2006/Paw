# Validation

## Proof Strategy

US-045 is complete when `paw report <session-id>` prints the persisted report
summary without creating or mutating `.paw` files and handles missing artifacts
with explicit output.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Report result formatting, missing project, missing report, and found summary variants. |
| Integration | Temp-project `.paw` initialization, persisted `summary.md` reads, command routing, argument validation, and main routing before normal runtime. |
| E2E | Not applicable; no full interactive Paw workflow is implemented. |
| Platform | Covered by temp-directory filesystem checks for `.paw` session summary paths. |
| Performance | Not applicable; command performs one bounded directory stat and one summary read. |
| Logs/Audit | No logs or artifacts are written. |

## Fixtures

- Temporary repositories under the OS temp directory.
- Source `paw-spec/config.yaml` copied into temp projects for `paw init`.
- Deterministic session id `session-1` and persisted `summary.md` markdown.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-report-command.test.ts
scripts/bin/harness-cli story verify US-045
npm run check
```

## Acceptance Evidence

- Focused report-command test passed:
  `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-report-command.test.ts`.
- Harness story verification passed:
  `scripts/bin/harness-cli story verify US-045`.
- Root repository check passed: `npm run check`.
