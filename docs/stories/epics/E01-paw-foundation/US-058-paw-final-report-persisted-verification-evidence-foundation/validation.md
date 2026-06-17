# Validation

## Proof Strategy

US-058 is complete when `emitPawFinalReport` reads persisted verification
evidence from the session directory when the caller does not supply
`nativeVerificationRunResults`, forwards the resolved evidence into the final
report, and always defers to explicit caller-provided evidence. The rendered
markdown reflects the resolved evidence without raw stdout, stderr, exit codes,
commands, or reasons.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | `emitPawFinalReport` without `nativeVerificationRunResults` reads persisted evidence and forwards it; no evidence file returns `[]`; explicit caller evidence wins over persisted file; explicit `[]` suppresses persisted evidence; rendered markdown reflects resolved evidence without raw stdout/stderr/exit code output. |
| Integration | Adjacent final-report-emission tests (lock, state, pending-slice, report-input, transition failure paths) remain compatible; adjacent final-report tests (createPawFinalReport, renderPawFinalReportMarkdown) remain compatible; adjacent session-store tests (state read/write, evidence read/write) remain compatible. |
| E2E | Not applicable; full Paw orchestration is not implemented. |
| Platform | Not applicable; this is an in-process wiring addition, no platform-specific behavior. |
| Performance | Not applicable; evidence resolution is a single file read per emission when caller omits the field. |
| Logs/Audit | No logs are written; persisted evidence is consumed from a typed JSON file in the session directory and surfaced on the final report model and rendered markdown. |

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-final-report-emission.test.ts test/paw-final-report.test.ts test/paw-session-store.test.ts
scripts/bin/harness-cli story verify US-058
npm run check
```

## Acceptance Evidence

- `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-final-report-emission.test.ts test/paw-final-report.test.ts test/paw-session-store.test.ts` passed: 3 files, 33 tests.
- `scripts/bin/harness-cli story verify US-058` passed.
- `npm run check` passed.
