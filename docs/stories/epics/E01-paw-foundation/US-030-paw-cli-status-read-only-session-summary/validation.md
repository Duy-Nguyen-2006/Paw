
# Validation

## Proof Strategy

US-030 is complete when `pi paw status` routes through the existing Paw handler,
prints a bounded read-only project/session report, succeeds when `.paw/` is
missing, and does not claim full Paw CLI or runtime completion.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Pure status report and formatter cover missing `.paw`, initialized no-session state, valid state counts, and invalid session count. |
| Integration | `handlePawCommand` handles status help and unknown status options; `main` routes `paw status` before normal agent runtime. |
| E2E | Not applicable; no full interactive Paw workflow is implemented. |
| Platform | Covered by temp-directory filesystem checks that assert read-only missing `.paw` paths are not created. |
| Performance | Not applicable; command performs bounded filesystem reads only. |
| Logs/Audit | Command output reports initialization, config, version, session, and invalid state summaries. |

## Fixtures

- Runtime config copied from repository `paw-spec/config.yaml` into temporary
  test projects.
- Temporary `.paw/sessions/<id>/state.json` files with valid and invalid state
  JSON.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-status-command.test.ts
npm run check
scripts/bin/harness-cli story verify US-030
```

## Acceptance Evidence

- Focused command test passed:
  `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-status-command.test.ts`
  with 6 tests passing.
- Root repository check passed: `npm run check`.
- Harness story verification passed:
  `scripts/bin/harness-cli story verify US-030`.
