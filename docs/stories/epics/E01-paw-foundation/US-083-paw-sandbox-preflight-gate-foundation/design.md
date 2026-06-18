
# Design

## Preflight Helper

`evaluatePawSubAgentSandboxPreflight` wraps the existing `evaluatePawSandbox` policy for sub-agent runtime invocations. It returns `null` when execution may continue and a synthetic blocked runtime decision when the sandbox policy requires blocking.

## Orchestrator Integration

Worker and reviewer orchestration accept optional `sandboxPreflight` input. When present, each runtime attempt builds the normal invocation, evaluates sandbox preflight, and returns the blocked decision before calling the executor.

## Safe Defaults

The preflight is opt-in. `paw build` does not perform live sandbox probing and remains provider-unavailable by default unless programmatic callers inject both provider execution and sandbox facts.

## Out Of Scope

- Live platform probing.
- Sandbox process launch or filesystem enforcement.
- Tool execution and patch application.
- CLI sandbox flags.
- Real provider calls or credential reads.
