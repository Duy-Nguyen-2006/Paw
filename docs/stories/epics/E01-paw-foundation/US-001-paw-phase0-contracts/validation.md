
# Validation

## Proof Strategy

This story is complete when product docs exist, Paw ADRs are durably registered,
foundation contract tests pass, and the root check passes after code changes.
Phase 0 spikes remain incomplete until each spike has evidence in
`paw-spec/docs/decisions/PHASE0-SPIKE-TRACKER.md`.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Config loader parses the default config; sub-agent validator accepts valid output and rejects malformed output. |
| Integration | Harness decision and story rows exist; root `npm run check` passes. |
| E2E | Not applicable; no user-facing Paw CLI in this slice. |
| Platform | Not applicable; sandbox and shell execution are later slices. |
| Performance | Not applicable for foundation parsing. |
| Logs/Audit | Validation errors include actionable paths. |

## Fixtures

- `paw-spec/config.yaml`
- `paw-spec/schemas/subagent-contract.schema.json`

## Commands

```text
node ../../node_modules/vitest/dist/cli.js --run test/paw-contracts.test.ts
npm run check
scripts/bin/harness-cli story verify US-001
```

## Acceptance Evidence

- `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-contracts.test.ts`
  passed: 6 tests in 1 file.
- `npm run check` passed from the repository root.
- Phase 0 spike tracker remains incomplete; all five P0 spikes still need
  evidence before G0 can be closed.
