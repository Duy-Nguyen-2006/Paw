
# Validation

## Proof Strategy

US-085 is complete when Paw has a pure, exported tool runtime contract that can decide dry-run allow/block outcomes without executing any tool or mutating files.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Approval, sandbox, secret path, untrusted source, and invalid request decisions. |
| Integration | Runtime config policy composition with default Paw config. |
| E2E | Not applicable; no CLI or user-facing execution in this slice. |
| Platform | Not applicable; no subprocesses, filesystem writes, or sandbox launch. |
| Performance | Constant-time policy composition over supplied path list. |
| Logs/Audit | All outcomes report `executed: false` and `filesChanged: false`. |

## Fixtures

- Default Paw runtime config.
- Synthetic tool runtime request facts.
- Injected sandbox primitive lists.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-tool-runtime.test.ts
scripts/bin/harness-cli story verify US-085
npm run check
```

## Acceptance Evidence

- Focused Paw tool runtime tests pass.
- Harness story verification passes.
- Root repository check passes.
