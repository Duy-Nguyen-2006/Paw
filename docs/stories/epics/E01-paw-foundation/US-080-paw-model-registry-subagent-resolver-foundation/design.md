# Design

## Registry Resolver

`createPawModelRegistrySubAgentResolver` accepts a structural registry surface with `find`, `hasConfiguredAuth`, and `getApiKeyAndHeaders`. This keeps Paw runtime decoupled from concrete `ModelRegistry` construction while matching the shape needed for future wiring.

## Model Reference Parsing

The resolver accepts canonical `provider/model` references. Bare model IDs are accepted only when `defaultProvider` is supplied, making ambiguous references explicit.

## Auth Options

Resolved auth data is merged into `SimpleStreamOptions` as `apiKey` and `headers`. Tests use fake values only and do not log or expose secret material.

## Fail-Closed Path

The resolver throws clear errors for malformed, unknown, unauthenticated, or auth-failed models. When used through `createPawProviderSubAgentExecutor`, these errors become structured `PROVIDER_UNAVAILABLE` blocked outputs.

## Out Of Scope

- Default CLI provider wiring.
- Real auth storage construction.
- Reading environment credentials.
- Real provider/network execution.
- Sandbox/tool runtime and rollback.
