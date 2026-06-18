
# Validation

## Proof Strategy

US-056 is complete when `PawFinalReport` carries per-gate
`PawNativeVerificationRunResult[]` evidence when provided, the report model
defaults to an empty array when no evidence is supplied, the markdown renderer
includes a concise `## Verification Evidence` section listing executed gate
names and statuses, raw stdout/stderr/exit codes, commands, and reasons are not rendered in the default
markdown output, and `PawFinalReportEmission` forwards the field through to the
assembled report.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Report input with `nativeVerificationRunResults` stores results on report model; report input without `nativeVerificationRunResults` stores empty array; markdown with executed gates contains `## Verification Evidence` section with `<gate>: <status>` lines; markdown with empty run results or no executed gates renders `- No native verification gates executed`; markdown does not contain raw stdout, stderr, exit code text, commands, or reasons from run results; unverified executed gates render `<gate>: unverified` in the evidence section. |
| Integration | Emission input with `nativeVerificationRunResults` forwards to assembled report and persisted markdown; emission input without `nativeVerificationRunResults` produces report with empty run results; adjacent final-report, verify-command, and verification-runner tests remain compatible. |
| E2E | Not applicable; full Paw orchestration is not implemented. |
| Platform | Not applicable; this is an in-process model enrichment, no platform-specific behavior. |
| Performance | Not applicable; run results are already produced by the runner and stored by reference. |
| Logs/Audit | No logs are written; per-gate evidence is carried on the report model and a concise summary is rendered to the persisted markdown at the session summary path. |

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-final-report.test.ts test/paw-final-report-emission.test.ts test/paw-verify-command.test.ts
scripts/bin/harness-cli story verify US-056
npm run check
```

## Acceptance Evidence

- `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-final-report.test.ts test/paw-final-report-emission.test.ts test/paw-verify-command.test.ts` passed: 3 files, 45 tests.
- `scripts/bin/harness-cli story verify US-056` passed.
- `npm run check` passed.
