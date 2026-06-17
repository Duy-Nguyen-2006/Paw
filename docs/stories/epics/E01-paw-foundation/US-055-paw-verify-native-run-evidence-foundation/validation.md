# Validation

## Proof Strategy

US-055 is complete when `PawVerifyCommandCompletedResult` carries per-gate
`PawNativeVerificationRunResult[]` evidence when an executor is used, the
non-executing path produces an empty array, and the formatter renders a concise
executed-gates summary line (`native executed gates: gate(status), ...`) when
executed gates exist, or `native executed gates: none` otherwise. Full per-gate
detail (exit codes, stdout, stderr, reasons) is available programmatically on
the result object but not rendered in the text formatter.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Completed result with executor includes `nativeVerificationRunResults` with one entry per planned gate; each entry has `exitCode`, `stdout`, `stderr`, `executed`, and `command` matching mock executor output; completed result without executor includes empty `nativeVerificationRunResults` array; formatted output with executed gates contains `native executed gates: gate(status), ...` summary line; formatted output with empty run results or no executed gates renders `native executed gates: none`; non-executing path output is byte-identical to pre-US-055 format. |
| Integration | `paw verify <session-id> --native` produces a completed result where `nativeVerificationRunResults` aligns with the plan's planned entries; `paw verify <session-id>` without `--native` produces an empty `nativeVerificationRunResults`; adjacent verification-runner, verification-plan, verify-command, and verification-executor tests remain compatible. |
| E2E | Not applicable; full Paw orchestration is not implemented. |
| Platform | Not applicable; this is an in-process data enrichment, no platform-specific behavior. |
| Performance | Not applicable; run results are already produced by the runner and stored by reference. |
| Logs/Audit | No logs are written; per-gate evidence is carried in-memory on the result and a concise summary is rendered to stdout by the formatter. |

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-verify-command.test.ts test/paw-verification-runner.test.ts test/paw-verification-plan.test.ts
scripts/bin/harness-cli story verify US-055
npm run check
```

## Acceptance Evidence

- Focused verify-command, verification-runner, and verification-plan tests passed:
  `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-verify-command.test.ts test/paw-verification-runner.test.ts test/paw-verification-plan.test.ts`.
- Harness story verification passed: `scripts/bin/harness-cli story verify US-055`.
- Root repository check passed: `npm run check`.
