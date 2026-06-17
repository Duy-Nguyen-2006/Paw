# Validation

## Proof Strategy

US-083 is complete when worker and reviewer build orchestration can opt into sandbox preflight and block before provider execution with structured `SANDBOX_UNAVAILABLE` output while default CLI behavior remains unchanged.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Preflight helper maps sandbox policy block decisions into valid blocked sub-agent outputs. |
| Integration | Build worker and reviewer paths block before fake provider execution when no primitive is available. |
| E2E | Not applicable; no user-facing CLI sandbox flags in this slice. |
| Platform | Temporary Paw projects prove session state transitions and lock release behavior. |
| Performance | One policy evaluation before each worker/reviewer runtime attempt when preflight is injected. |
| Logs/Audit | Blocked output contains structured reason without probing host sandbox state. |

## Fixtures

- Temporary Paw project with default runtime config.
- Fake structural model registry and fake `completeSimple`.
- Injected sandbox primitive lists.
- Implementing and reviewing session states.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-build-command.test.ts
scripts/bin/harness-cli story verify US-083
npm run check
```

## Acceptance Evidence

- Focused Paw build command tests pass.
- Harness story verification passes.
- Root repository check passes.
