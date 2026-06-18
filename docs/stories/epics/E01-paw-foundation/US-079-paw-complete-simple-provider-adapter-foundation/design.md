
# Design

## CompleteSimple Adapter

`createPawCompleteSimpleSubAgentCompletion` returns a `PawProviderSubAgentCompletion`. It accepts an injected model resolver and optional injected `completeSimple` implementation. The default completer points at `@earendil-works/pi-ai` for future wiring, while tests inject a fake completer and never call provider APIs.

## Context Mapping

The adapter maps `PawProviderSubAgentPrompt` into a simple provider `Context` with the Paw system prompt and one user message containing the handoff metadata.

## Output Mapping

The adapter extracts text content blocks from the assistant message, joins them with newlines, and reports `responseModel`, `message.model`, or the resolved model id as provider model metadata.

## Out Of Scope

- Auth storage and credential resolution.
- Model registry lookup implementation.
- Default `paw build` provider wiring.
- Real provider/network execution in tests.
- Sandbox/tool runtime and rollback.
