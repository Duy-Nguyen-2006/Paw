
# US-059: Paw Final Report JSON Artifact and Report --json Foundation

## Summary

Extend `emitPawFinalReport` to persist the typed `PawFinalReport` object as
`report.json` alongside `summary.md` in the session directory. Add a `--json`
flag to `paw report <session-id>` that reads the persisted JSON artifact and
prints it to stdout. The default `paw report <session-id>` route remains
unchanged (markdown output). When the JSON artifact is missing, the `--json`
route produces a clear error message rather than crashing or printing partial
output.

## Scope

- Add `reportJsonFile` to `PawSessionPaths` in `session-store.ts` with the
  path `.paw/sessions/<id>/report.json`.
- In `emitPawFinalReport` (`final-report-emission.ts`), after writing
  `summary.md`, serialize the `PawFinalReport` to JSON with
  `JSON.stringify(report, null, 2)` and write it to `paths.reportJsonFile`.
- Add `reportJsonFile` to `PawFinalReportEmissionCompletedResult` so callers
  can inspect the persisted JSON path.
- In `report-command.ts`, accept a `--json` flag as the second argument
  (`paw report <session-id> --json`). When present, read
  `report.json` from the session directory and print it verbatim. When the
  file does not exist, return a `missing_report_json` status with a clear
  error message.
- Add `PawReportCommandFoundJsonResult` (`status: "found_json"`) and
  `PawReportCommandMissingReportJsonResult` (`status: "missing_report_json"`)
  to `PawReportCommandResult`.
- Update `formatPawReportCommandResult` and `formatPawReportJsonCommandResult`
  to render the new statuses.
- Update `runPawReportCommand` to parse `--json` before the existing arg
  count guard and route to the JSON path.
- Update `printPawReportHelp` to document the `--json` flag.

## Acceptance Criteria

- After `emitPawFinalReport` completes with `status: "completed"`, a
  `report.json` file exists in the session directory containing the full typed
  `PawFinalReport` as pretty-printed JSON.
- `paw report <session-id>` (no `--json`) prints the same markdown as before;
  no behavioral change.
- `paw report <session-id> --json` prints the contents of `report.json` to
  stdout.
- `paw report <session-id> --json` when `report.json` does not exist prints
  an error message identifying the missing JSON file path and sets
  `process.exitCode = 1`.
- `paw report --json` (missing session id) prints an error and sets
  `process.exitCode = 1`.
- `paw report <session-id> --json extra` prints an unknown-option error and
  sets `process.exitCode = 1`.
- The JSON artifact is structurally identical to the `PawFinalReport` returned
  by `emitPawFinalReport` (same fields, same values, no serialization loss).
- Existing final-report-emission behavior for lock, state, pending-slice,
  report-input, and transition failure results is unchanged.
- Focused tests, Harness story verification, and root `npm run check` pass.
