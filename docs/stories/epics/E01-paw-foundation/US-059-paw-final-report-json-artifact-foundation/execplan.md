# Execution Plan

1. Add a failing focused test confirming that `emitPawFinalReport` with
   `status: "completed"` writes a `report.json` file in the session directory
   containing the full `PawFinalReport` as pretty-printed JSON.
2. Add a failing focused test confirming that `emitPawFinalReport` result
   includes `reportJsonFile` pointing to the persisted JSON path.
3. Add `reportJsonFile` to `PawSessionPaths` in `session-store.ts` with the
   path `.paw/sessions/<id>/report.json`.
4. Add `reportJsonFile: string` to `PawFinalReportEmissionCompletedResult` in
   `final-report-emission.ts`.
5. In `emitPawFinalReport`, after the `writeFile(paths.summaryFile, ...)` call,
   add `writeFile(paths.reportJsonFile, JSON.stringify(reportResult.report, null, 2), "utf-8")`.
6. Set `reportJsonFile: paths.reportJsonFile` on the returned
   `PawFinalReportEmissionCompletedResult`.
7. Add a failing focused test confirming that
   `createPawReportJsonCommandResult` returns `found_json` with the JSON
   string when `report.json` exists.
8. Add a failing focused test confirming that
   `createPawReportJsonCommandResult` returns `missing_report_json` with the
   file path when `report.json` does not exist.
9. Add a failing focused test confirming that
   `formatPawReportJsonCommandResult` for `missing_report_json` produces an
   error message mentioning the file path.
10. Add a failing focused test confirming that `runPawReportCommand` with
    `["<session-id>", "--json"]` routes to the JSON result path.
11. Add a failing focused test confirming that `runPawReportCommand` with
    `["--json"]` (missing session id) prints an error and sets
    `process.exitCode = 1`.
12. Add a failing focused test confirming that `runPawReportCommand` with
    `["<session-id>", "--json", "extra"]` prints an unknown-option error and
    sets `process.exitCode = 1`.
13. Add `PawReportCommandFoundJsonResult` and
    `PawReportCommandMissingReportJsonResult` to the report-command result
    union in `report-command.ts`.
14. Add `createPawReportJsonCommandResult` that reads `report.json` from the
    session directory, returning `found_json` or `missing_report_json`.
15. Add `formatPawReportJsonCommandResult` that renders the JSON string or
    error message.
16. Update `runPawReportCommand` to parse `--json` from the args array and
    route to the JSON path.
17. Update `PawReportCommandResult` union to include the new variants.
18. Update `formatPawReportCommandResult` to handle `found_json` and
    `missing_report_json`.
19. Update `printPawReportHelp` to document `--json`.
20. Run focused Vitest, Harness story verification, adjacent
    final-report-emission/final-report/report-command/session-store tests,
    and root `npm run check`.

## Non-Goals

- Changing `PawFinalReport`, `PawFinalReportInput`, `createPawFinalReport`,
  or `renderPawFinalReportMarkdown`.
- Adding a `--format` generic output format flag.
- JSON schema validation on read.
- Atomic dual-write of `summary.md` and `report.json`.
- Streaming JSON output.
- Compact JSON mode (`--pretty=false`).
- Evidence retention or cleanup integration with US-020.
- Changing `readPawVerificationEvidence` or `writePawVerificationEvidence`.
- Changing the verification runner, executor, plan, or verify command.
