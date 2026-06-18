
# Execution Plan

## Steps

1. Add a pure security policy module under `packages/coding-agent/src/paw/`.
2. Export public security policy types and helpers from the Paw barrel.
3. Add focused unit tests for sandbox fallback, secret path exclusion, redaction
   classification, and untrusted-source decisions.
4. Run the focused Paw security policy tests.
5. Run `npm run check`.
6. Update Harness story evidence and trace.

## Guardrails

- No `any`.
- No inline imports.
- No sandbox execution or filesystem traversal.
- Use `PawRuntimeConfig["sandbox"]`, `["secrets"]`, and `["injection"]`.
- Do not commit.

## Rollback

Remove the new module, export entries, and focused tests. No persistent runtime
data is affected.
