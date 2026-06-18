
# Validation

## Proof Strategy

US-079 is complete when a `completeSimple`-style adapter can be tested with injected fake resolver/completer surfaces and produces raw text suitable for the existing Paw runtime validator, without real provider calls.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Model resolver receives completion input; context and options are forwarded to the completer; text content is extracted. |
| Integration | Adapter output can feed the US-078 provider executor seam and existing runtime validation path. |
| E2E | Not applicable for this adapter-only slice. |
| Platform | Not applicable; no real provider, network, filesystem, or credential access. |
| Performance | One model resolution and one completion call per runtime attempt. |
| Logs/Audit | Model metadata comes from response model, message model, or resolved model id. |

## Fixtures

- Fake `Model` object.
- Fake `AssistantMessage` with text blocks.
- Fake `AssistantMessage` with mixed thinking/text content.
- Injected fake resolver and completer functions.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-subagent-runtime.test.ts
scripts/bin/harness-cli story verify US-079
npm run check
```

## Acceptance Evidence

- Focused sub-agent runtime tests pass.
- Harness story verification passes.
- Root repository check passes.
