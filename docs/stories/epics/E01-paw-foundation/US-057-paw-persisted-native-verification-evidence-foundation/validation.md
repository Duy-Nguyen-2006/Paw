# Validation

## Proof Strategy

US-057 is complete when `PawSessionPaths` includes the verification evidence
file path, `writePawVerificationEvidence` atomically persists
`PawNativeVerificationRunResult[]` to the session directory,
`readPawVerificationEvidence` reads the persisted data back (returning `[]`
when the file is absent), and `createPawVerifyCommandResult` persists the
native run results after a successful verify run.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | `PawSessionPaths.verificationEvidenceFile` resolves correctly; `writePawVerificationEvidence` writes results and `readPawVerificationEvidence` reads them back; empty array writes `[]`; missing file returns `[]`; `writePawVerificationEvidence` delegates to `writePawJsonAtomic`; verify command with native executor persists run results; verify command without native executor persists `[]`. |
| Integration | Adjacent session-store tests (state read/write, lock acquire/release) remain compatible; adjacent verify-command tests (non-native path, invalid state, locked session) remain compatible; adjacent verification-runner tests remain compatible. |
| E2E | Not applicable; full Paw orchestration is not implemented. |
| Platform | Not applicable; this is an in-process persistence addition, no platform-specific behavior. |
| Performance | Not applicable; evidence persistence is a single atomic file write per verify run. |
| Logs/Audit | No logs are written; per-gate evidence is persisted to a typed JSON file in the session directory for future orchestrator and reporting consumption. |

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-session-store.test.ts test/paw-verify-command.test.ts test/paw-verification-runner.test.ts
scripts/bin/harness-cli story verify US-057
npm run check
```

## Acceptance Evidence

- `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-session-store.test.ts test/paw-verify-command.test.ts test/paw-verification-runner.test.ts` passed: 3 files, 45 tests.
- `scripts/bin/harness-cli story verify US-057` passed.
- `npm run check` passed.
