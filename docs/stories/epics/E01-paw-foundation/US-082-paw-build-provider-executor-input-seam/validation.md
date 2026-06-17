# Validation

## Proof Strategy

US-082 is complete when Paw build orchestration can opt into the composed provider executor through programmatic input while preserving fail-closed CLI defaults and fake-only test coverage.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Executor resolution rejects ambiguous direct and provider executor input. |
| Integration | Build worker and reviewer paths run through injected fake provider executor. |
| E2E | Not applicable; no user-facing CLI provider flags in this slice. |
| Platform | Build command filesystem/session transitions are covered with temporary Paw projects. |
| Performance | One resolver/completer path per worker or reviewer attempt. |
| Logs/Audit | Provider-unavailable failure is structured and does not expose credentials. |

## Fixtures

- Temporary Paw project with default runtime config.
- Fake structural model registry.
- Fake `completeSimple` implementation.
- Implementing and reviewing session states.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-build-command.test.ts
scripts/bin/harness-cli story verify US-082
npm run check
```

## Acceptance Evidence

- Focused Paw build command tests pass.
- Harness story verification passes.
- Root repository check passes.
