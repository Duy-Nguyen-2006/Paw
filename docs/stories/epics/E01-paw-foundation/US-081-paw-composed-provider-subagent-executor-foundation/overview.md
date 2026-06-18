
# US-081: Paw Composed Provider Sub-Agent Executor Foundation

## Summary

Add a composed provider sub-agent runtime executor factory that wires the US-078 executor seam, US-079 `completeSimple` adapter, and US-080 model-registry resolver into one injectable executor for future provider-backed build wiring.

## Scope

- Add `createPawProviderSubAgentRuntimeExecutor` as a thin composition factory.
- Compose structural model-registry resolution, `completeSimple`-style completion, and runtime executor validation.
- Preserve fail-closed behavior for resolver and completion errors through the existing `PROVIDER_UNAVAILABLE` path.
- Keep tests fake-only with a fake registry and injected completer.
- Keep default `paw build` fail-closed behavior unchanged.
- Do not instantiate real registries, read credentials, call providers, or wire CLI defaults.

## Acceptance Criteria

- Tests prove the composed executor accepts valid fake completion output through `runPawSubAgentRuntime`.
- Tests prove default-provider model refs and fake auth options reach the injected completer.
- Tests prove resolver failures become structured provider-unavailable blocked output.
- Tests prove no completer call happens when invocation has no selected model.
- The composed factory is exported for future provider wiring.
