
# US-078: Paw Provider Sub-Agent Executor Seam

## Summary

Add a provider-backed executor seam at the `PawSubAgentRuntimeExecutor` boundary so worker and reviewer sub-agent calls can be adapted from provider completion text into the existing Paw runtime validation path.

## Scope

- Add an injectable provider completion adapter that returns raw assistant text to `runPawSubAgentRuntime`.
- Build deterministic system and user prompts from the runtime invocation.
- Fail closed with a valid `PROVIDER_UNAVAILABLE` blocked Paw output when no model is selected or provider completion fails.
- Preserve existing runtime JSON validation and retry ownership.
- Preserve default `paw build` fail-closed behavior when no executor is injected.
- Do not call real provider APIs, read credentials, add sandbox/tool execution, or change CLI defaults.

## Acceptance Criteria

- Tests prove valid provider text is accepted through existing runtime validation.
- Tests prove invalid provider text returns the existing retry path rather than a custom retry loop.
- Tests prove provider exceptions and missing model IDs become valid `PROVIDER_UNAVAILABLE` blocked Paw outputs.
- The new seam is exported for future build/provider wiring.
- Existing sub-agent runtime behavior remains covered and passing.
