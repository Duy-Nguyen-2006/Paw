
# Validation

## Proof Strategy

US-031 is complete when `pi paw clean --dry-run` routes through the existing Paw
handler, prints a bounded read-only retention plan, succeeds when `.paw/` is
missing, rejects bare `pi paw clean`, and does not claim destructive cleanup is
implemented.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Pure report formatter covers zero candidates and kept/removable retention output. |
| Integration | `handlePawCommand` handles dry-run, help, and bare clean rejection; `main` routes dry-run before normal agent runtime. |
| E2E | Not applicable; no full interactive Paw workflow is implemented. |
| Platform | Covered by temp-directory filesystem checks that assert missing `.paw` paths are not created and directory mtimes drive the plan. |
| Performance | Not applicable; command performs bounded immediate-directory filesystem reads only. |
| Logs/Audit | Command output reports candidate counts, retention config, kept/removable paths, reasons, and no-delete status. |

## Fixtures

- Runtime config copied from repository `paw-spec/config.yaml` into temporary
  test projects.
- Temporary `.paw/sessions/<id>/` and `.paw/artifacts/<id>/` directories with
  deterministic mtimes.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-clean-command.test.ts
npm run check
scripts/bin/harness-cli story verify US-031
```

## Acceptance Evidence

- Focused command test passed:
  `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-clean-command.test.ts`
  with 5 tests passing.
- Root repository check passed: `npm run check`.
- Harness story verification passed:
  `scripts/bin/harness-cli story verify US-031`.
