# Validation

## Proof Strategy

US-028 is complete when `pi paw init` routes before normal runtime setup,
creates the existing durable `.paw` defaults through the persistence helper,
preserves existing durable files on repeat runs, and documents that only the
bounded `pi paw init` route is implemented.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Handler recognizes `paw init`, `paw init --help`, unknown subcommands, and invalid init options. |
| Integration | Main routes `paw init` before normal runtime setup and initializes a temp project from `paw-spec/config.yaml`. |
| E2E | Not applicable; no full interactive Paw workflow is implemented. |
| Platform | Covered by temp-directory filesystem checks for `.paw` files. |
| Performance | Not applicable; command does bounded filesystem initialization only. |
| Logs/Audit | Command output reports initialized path and created/existing counts. |

## Fixtures

- Runtime config copied from repository `paw-spec/config.yaml` into temporary
  test projects.
- Temporary working directories for command execution.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-init-command.test.ts
npm run check
scripts/bin/harness-cli story verify US-028
```

## Acceptance Evidence

- Focused command test passed:
  `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-init-command.test.ts`
  with 5 tests passing.
- Root repository check passed: `npm run check`.
- Harness story verification passed: `scripts/bin/harness-cli story verify US-028`.
