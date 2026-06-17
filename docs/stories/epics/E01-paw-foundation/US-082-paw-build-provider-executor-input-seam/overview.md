# US-082: Paw Build Provider Executor Input Seam

## Summary

Add an explicit programmatic `providerExecutor` input seam to Paw build orchestration so tests and future wiring can opt into the composed provider-backed executor without changing default CLI behavior.

## Scope

- Add `providerExecutor` to `PawBuildCommandInput`.
- Compose `providerExecutor` through `createPawProviderSubAgentRuntimeExecutor` when explicitly provided.
- Preserve existing injected `executor` support.
- Reject ambiguous inputs when both `executor` and `providerExecutor` are supplied.
- Keep default `paw build` fail-closed with `PROVIDER_UNAVAILABLE`.
- Keep tests fake-only with a fake model registry and injected completer.
- Do not add CLI flags, instantiate real registries, read credentials, or call providers.

## Acceptance Criteria

- Tests prove worker build orchestration can run through an explicitly injected provider executor.
- Tests prove reviewer build orchestration can run through an explicitly injected provider executor.
- Tests prove resolver/auth failures still become structured `PROVIDER_UNAVAILABLE` blocked state.
- Tests prove default build behavior remains provider-unavailable without injection.
- Tests prove ambiguous `executor` plus `providerExecutor` input rejects before state mutation or lock creation.
