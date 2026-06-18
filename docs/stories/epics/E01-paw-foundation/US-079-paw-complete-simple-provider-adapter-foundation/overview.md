
# US-079: Paw CompleteSimple Provider Adapter Foundation

## Summary

Add a fake-safe `completeSimple` provider completion adapter for Paw sub-agent execution so future provider wiring can resolve a model, build a simple context, call a completion function, and pass assistant text into the US-078 executor seam.

## Scope

- Add `createPawCompleteSimpleSubAgentCompletion` as an injectable adapter from Paw completion input to `completeSimple`-style calls.
- Convert Paw provider prompts into a simple `Context` with system prompt and one user message.
- Extract assistant text blocks into raw completion text for existing Paw runtime validation.
- Preserve fake-only tests with injected resolver and injected completer.
- Keep default `paw build` provider-unavailable behavior unchanged.
- Do not call real provider APIs, resolve credentials, wire CLI defaults, execute tools, or add sandbox runtime.

## Acceptance Criteria

- Tests prove the adapter resolves a model and passes context/options into an injected completer.
- Tests prove assistant text blocks become raw provider completion text.
- Tests prove non-text assistant content is ignored.
- The adapter is exported for future provider wiring.
- Existing US-078 executor seam and runtime validation tests remain passing.
