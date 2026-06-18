
# US-008: Paw Context Budget Policy

## User Story

As Paw's context manager, I need config-backed context budget helpers so
sub-agent handoffs, file reads, and tool outputs are bounded before they enter
model context.

## Source References

- `SPEC.md` §8.1 Token frugality.
- `SPEC.md` §8.2 Prompt caching.
- `SPEC.md` §15 Context layers.
- `paw-spec/config.yaml` `context` and `prompt_cache` sections.

## Scope

Implement pure TypeScript helpers that resolve task context caps, sub-agent
handoff caps, file-read limits, tool-output limits, and stable context assembly
ordering from runtime config.

## Non-Goals

- No tokenization implementation.
- No actual file reading or truncation.
- No provider prompt-cache API integration.
- No orchestrator context assembly.

## Acceptance Criteria

- Task context cap is read from `context.class_cap_tokens`.
- Sub-agent handoff cap is read from `context.subagent_handoff_max_tokens`.
- Tool-output and file-read limits are read from config.
- Oversized files are classified as metadata-only before context inclusion.
- Required context spans that would exceed a cap return an escalation decision
  instead of silent truncation.
- Context assembly order comes from config and preserves stable-first behavior.
