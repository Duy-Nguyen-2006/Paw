# Design

## Executor Seam

`createPawProviderSubAgentExecutor` accepts an injected `complete` function and returns a `PawSubAgentRuntimeExecutor`. The adapter builds a deterministic prompt from the invocation, calls the injected completion, and forwards raw completion text into the existing runtime response evaluator.

## Fail-Closed Behavior

When `model_id` is absent or the injected provider completion throws, the adapter returns a synthetic Paw sub-agent output with `status: "blocked"`, `blocked_reason.code: "PROVIDER_UNAVAILABLE"`, and provider degradation metadata. This keeps failures contract-shaped and avoids unhandled provider errors.

## Runtime Ownership

The adapter does not parse JSON or retry invalid outputs. `runPawSubAgentRuntime` and the existing worker/reviewer orchestrators remain responsible for validation and retry behavior.

## Out Of Scope

- Real provider API calls.
- Credential lookup.
- Default `paw build` provider wiring.
- Sandbox/tool runtime execution.
- Worker file editing or rollback.
