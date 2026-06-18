
# US-016: Paw Sub-Agent Response Fallback

## User Story

As Paw's orchestrator, I need invalid sub-agent responses to become retry or
blocked decisions so malformed JSON never crashes a task.

## Source References

- `SPEC.md` §14.1 Sub-agent contract.
- `paw-spec/schemas/subagent-contract.schema.json`.
- `docs/product/paw-runtime.md` Sub-Agent Contract.

## Scope

Implement a policy helper that evaluates raw sub-agent output, accepts valid
contract output, requests one retry for the first invalid response, and returns
a validated blocked output after the retry is exhausted.

## Non-Goals

- No provider execution.
- No sub-agent process management.
- No artifact report writing.
- No orchestrator loop wiring.

## Acceptance Criteria

- Valid JSON matching the sub-agent schema is accepted.
- Invalid JSON or invalid schema on the first attempt returns a retry decision
  with path-level issues.
- Invalid JSON or invalid schema after the retry cap returns a blocked
  `PawSubAgentOutput`.
- The blocked fallback output itself validates against the sub-agent schema.
- Expected agent, session, and artifact ref mismatches are rejected as invalid
  responses.
