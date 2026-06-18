
# US-086: Paw Build Default Provider Runtime Wiring

## Summary

Wire the default `paw build` path to the composed provider executor so runtime
model routing is exercised by the build command without changing the fail-closed
default behavior.

## Scope

- Use the composed provider executor in default build wiring.
- Preserve fake-only coverage for provider-unavailable behavior.
- Keep `ENV_AGENT_DIR` isolated in default-provider tests.
- Do not add new CLI flags or provider marketplace behavior.

## Acceptance Criteria

- Default build runs through configured model routing when provider wiring is present.
- Provider-unavailable behavior remains fail-closed by default.
- Default-provider tests avoid leaking real user model state.
