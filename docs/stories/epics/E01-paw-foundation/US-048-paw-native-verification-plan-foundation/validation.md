
# Validation

## Proof Strategy

US-048 is complete when the verifier planning layer deterministically maps v1
verification gates to non-executed command plans, and `paw verify` exposes that
plan without falsely marking gates verified.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Gate order, supported command mappings, unsupported gate reasons, command formatting. |
| Integration | `paw verify` temp-project flow includes native plan metadata and persists unverified verifier results. |
| E2E | Not applicable; full Paw orchestration is not implemented. |
| Platform | Covered by temp-directory CLI session state and lock behavior in adjacent verify command tests. |
| Performance | Not applicable; planning is in-memory over configured gate names. |
| Logs/Audit | No logs are written; unverified reasons disclose planned-but-not-executed commands. |

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-verification-plan.test.ts test/paw-verify-command.test.ts
scripts/bin/harness-cli story verify US-048
npm run check
```

## Acceptance Evidence

- Focused verification-plan and verify-command tests passed:
  `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-verification-plan.test.ts test/paw-verify-command.test.ts`.
- Harness story verification passed: `scripts/bin/harness-cli story verify US-048`.
- Root repository check passed with no fixes applied: `npm run check`.
