# Validation

## Proof Strategy

US-078 is complete when the provider-backed sub-agent executor seam adapts injected provider completion text into existing Paw runtime validation while failing closed for unavailable providers and preserving default CLI fail-closed behavior.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Provider adapter builds prompts, forwards raw text and model metadata, and preserves invalid JSON retry behavior. |
| Integration | Runtime validation accepts provider-backed output and validates synthetic provider-unavailable blocked outputs. |
| E2E | Not applicable for this seam-only slice. |
| Platform | Not applicable; no real provider, network, filesystem, or credential access. |
| Performance | Single injected completion call per runtime attempt. |
| Logs/Audit | Provider failures are exposed as structured blocked output and executor degradation metadata. |

## Fixtures

- In-memory fake completion function returning valid Paw JSON.
- In-memory fake completion function returning invalid JSON.
- In-memory fake completion function throwing a provider availability error.
- Runtime invocations for worker sub-agent metadata.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-subagent-runtime.test.ts
scripts/bin/harness-cli story verify US-078
npm run check
```

## Acceptance Evidence

- Focused sub-agent runtime tests pass.
- Harness story verification passes.
- Root repository check passes.
