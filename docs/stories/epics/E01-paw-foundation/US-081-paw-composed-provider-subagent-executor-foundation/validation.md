
# Validation

## Proof Strategy

US-081 is complete when a single injectable factory composes registry resolution, `completeSimple` completion, and Paw runtime validation without real provider calls or default CLI wiring.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Factory composes resolver and completer; missing model skips completion; resolver failures fail closed. |
| Integration | Composed executor feeds `runPawSubAgentRuntime` and accepts valid fake Paw output. |
| E2E | Not applicable for this factory-only slice. |
| Platform | Not applicable; no filesystem, network, provider, or credential access. |
| Performance | One registry lookup, one auth resolution, and one completion call per valid attempt. |
| Logs/Audit | Provider-unavailable outputs carry structured blocked reason without leaking secrets. |

## Fixtures

- Fake structural model registry.
- Fake `AssistantMessage` and fake `completeSimple` implementation.
- Runtime invocation with default-provider model id.
- Runtime invocation with missing model id.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-subagent-runtime.test.ts
scripts/bin/harness-cli story verify US-081
npm run check
```

## Acceptance Evidence

- Focused sub-agent runtime tests pass.
- Harness story verification passes.
- Root repository check passes.
