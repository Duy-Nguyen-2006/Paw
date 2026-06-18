
# US-080: Paw Model-Registry Sub-Agent Resolver Foundation

## Summary

Add a fake-safe model-registry resolver for Paw provider-backed sub-agent execution so future wiring can resolve provider/model references into model and auth options for the `completeSimple` adapter.

## Scope

- Add a structural model-registry resolver interface for Paw sub-agent provider execution.
- Resolve provider-qualified `provider/model` references.
- Resolve bare model IDs only when a default provider is supplied.
- Merge auth-derived API key and headers into completion options without logging secrets.
- Throw clear resolver errors that the US-078 executor seam can convert to provider-unavailable blocked outputs.
- Keep tests fake-only with stub registry and injected completer.
- Do not wire default `paw build`, instantiate real auth storage, read credentials, or call real providers.

## Acceptance Criteria

- Tests prove provider-qualified and default-provider model references resolve.
- Tests prove malformed, unknown, unauthenticated, and auth-failed references throw clear errors.
- Tests prove the resolver feeds the `completeSimple` adapter with fake auth/options and no provider calls.
- The resolver is exported for future provider wiring.
- Default `paw build` provider-unavailable behavior remains unchanged.
