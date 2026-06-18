
# Validation

## Proof Strategy

US-029 is complete when `pi paw doctor` routes through the existing Paw handler,
prints a bounded read-only sandbox report, exposes pure report formatting for
injected facts, and does not claim full Paw runtime or cross-distro sandbox
completion.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Pure report builder and formatter cover available, reduced, and unavailable injected probe facts. |
| Integration | `handlePawCommand` handles help and unknown doctor options; `main` routes `paw doctor` before normal agent runtime. |
| E2E | Not applicable; no full Paw interactive workflow is implemented. |
| Platform | Live command uses read-only host probes, but platform result is host-dependent and not complete cross-distro validation. |
| Performance | Not applicable; command performs bounded config reads and host probe reads only. |
| Logs/Audit | Command output reports sandbox status, primitives, remediation, egress allowlist, evidence, and bounded probe note. |

## Fixtures

- Runtime config copied from repository `paw-spec/config.yaml` into temporary
  test projects.
- Injected `PawSandboxProbeFacts` for deterministic report tests.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-doctor-command.test.ts
npm run check
scripts/bin/harness-cli story verify US-029
```

## Acceptance Evidence

- Focused command test passed:
  `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-doctor-command.test.ts`
  with 5 tests passing.
- Root repository check passed: `npm run check`.
- Harness story verification passed:
  `scripts/bin/harness-cli story verify US-029`.
