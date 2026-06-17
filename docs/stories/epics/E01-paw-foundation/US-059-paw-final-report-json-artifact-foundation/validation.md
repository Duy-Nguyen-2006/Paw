# Validation

## Proof Strategy

US-059 is complete when `emitPawFinalReport` persists a typed `PawFinalReport`
as `report.json` alongside `summary.md`, `paw report <session-id>` continues
to print markdown, `paw report <session-id> --json` reads and prints the JSON
artifact, and a missing JSON artifact produces a clear error. The default
markdown path is unchanged.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | `emitPawFinalReport` writes `report.json` containing pretty-printed `PawFinalReport` JSON; completed result includes `reportJsonFile` path; `createPawReportJsonCommandResult` returns `found_json` when file exists; `createPawReportJsonCommandResult` returns `missing_report_json` when file absent; `formatPawReportJsonCommandResult` renders JSON string for `found_json`; `formatPawReportJsonCommandResult` renders error message for `missing_report_json`; `runPawReportCommand` with `--json` routes to JSON path; `runPawReportCommand` with `--json` only (no session id) errors; `runPawReportCommand` with `--json extra` errors. |
| Integration | Adjacent final-report-emission tests (lock, state, pending-slice, report-input, transition failure paths) remain compatible; adjacent report-command tests (markdown path, missing project, missing report, help) remain compatible; adjacent session-store tests (state read/write, evidence read/write, path resolution) remain compatible. |
| E2E | Not applicable; full Paw orchestration is not implemented. |
| Platform | Not applicable; this is an in-process persistence addition with file I/O in the session directory, no platform-specific behavior. |
| Performance | Not applicable; JSON serialization and file write is negligible overhead alongside the existing markdown write. |
| Logs/Audit | No logs are written; the JSON artifact is persisted to `report.json` in the session directory alongside `summary.md` for machine-readable consumption by the report command and future tooling. |

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-final-report-emission.test.ts test/paw-final-report.test.ts test/paw-report-command.test.ts test/paw-session-store.test.ts
scripts/bin/harness-cli story verify US-059
npm run check
```

## Acceptance Evidence

- `emitPawFinalReport` writes `.paw/sessions/<id>/report.json` with the typed `PawFinalReport` (pretty-printed with `JSON.stringify(report, null, 2)`) and returns `reportJsonFile` on `completed`; failure paths do not write `report.json`.
- `paw report <session-id>` unchanged (markdown from `summary.md`).
- `paw report <session-id> --json` prints persisted JSON; missing artifact yields `missing_report_json` with path and exit code 1.
- `paw report --json` (no session id) errors with missing session id and exit code 1.
- `paw report <session-id> --json extra` unknown-option error and exit code 1.

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-final-report-emission.test.ts test/paw-final-report.test.ts test/paw-report-command.test.ts test/paw-session-store.test.ts
scripts/bin/harness-cli story verify US-059
npm run check
```

