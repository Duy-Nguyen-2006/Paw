# US-011: Paw Sandbox And Secret Policy

## User Story

As Paw's tool runtime, I need config-backed sandbox and secret policy decisions
so writes are refused when sandboxing is unavailable and secret-bearing inputs
are excluded or redacted before reaching context or artifacts.

## Source References

- `SPEC.md` §11 Security.
- `SPEC.md` §14.2 Sandbox fallback matrix.
- `SPEC.md` §25 Non-Negotiable Rules.
- `paw-spec/config.yaml` `sandbox`, `secrets`, and `injection` sections.

## Scope

Implement pure TypeScript helpers that evaluate sandbox availability, secret
path exclusion, redaction classification, and untrusted-source handling.

## Non-Goals

- No sandbox process creation.
- No filesystem traversal.
- No full redaction engine.
- No CLI doctor output.

## Acceptance Criteria

- Preferred sandbox primitive selection follows config order.
- No sandbox primitive available refuses R1+ unless explicit unsafe override is
  supplied.
- Secret path patterns from config exclude `.env*`, secret directories, and key
  files.
- Configured redaction classes classify likely tokens/API keys/private keys.
- Untrusted sources are handled as read-only structured summaries and cannot
  elevate tool risk.
