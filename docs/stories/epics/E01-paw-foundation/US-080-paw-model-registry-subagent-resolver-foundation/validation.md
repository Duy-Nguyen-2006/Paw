# Validation

## Proof Strategy

US-080 is complete when a fake model registry can resolve Paw sub-agent model references into model/auth options for the `completeSimple` adapter, and all failure modes remain fail-closed without real provider calls.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Provider-qualified refs resolve; bare refs resolve only with default provider; malformed refs fail. |
| Integration | Resolver feeds `createPawCompleteSimpleSubAgentCompletion` with fake auth-derived options. |
| E2E | Not applicable for this resolver-only slice. |
| Platform | Not applicable; no filesystem, network, provider, or credential access. |
| Performance | One registry lookup and one auth resolution per completion attempt. |
| Logs/Audit | Resolver errors are clear and do not include secret values. |

## Fixtures

- Fake `Model` object.
- Fake structural model registry.
- Fake auth success, missing auth, and auth failure responses.
- Injected fake `completeSimple` function.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-subagent-runtime.test.ts
scripts/bin/harness-cli story verify US-080
npm run check
```

## Acceptance Evidence

- Focused sub-agent runtime tests pass.
- Harness story verification passes.
- Root repository check passes.
