# Design

## Composition Factory

`createPawProviderSubAgentRuntimeExecutor` accepts the structural model-registry resolver input plus an optional injected `completeSimple` function. It creates a registry resolver, wraps it with `createPawCompleteSimpleSubAgentCompletion`, and returns `createPawProviderSubAgentExecutor`.

## Error Ownership

The factory does not add new retry or error handling. Resolver and completion failures propagate to the existing US-078 executor seam, which converts them into valid `PROVIDER_UNAVAILABLE` blocked Paw outputs.

## Safe Defaults

No CLI path uses this executor by default. Consumers must inject it explicitly in future slices.

## Out Of Scope

- CLI/default `paw build` wiring.
- Real `ModelRegistry` construction.
- Auth storage setup or credential reads.
- Real provider/network execution.
- Sandbox/tool runtime and rollback.
