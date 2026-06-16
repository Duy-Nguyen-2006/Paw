# US-017: Paw Final Report Assembly

## User Story

As a Paw user, I need the final report model to disclose evidence, risks,
unverified gates, and degraded execution so completion never hides uncertainty.

## Source References

- `SPEC.md` §16 Verification.
- `SPEC.md` §18 Architecture.
- `SPEC.md` §20 Pre-Merge / Pre-Release Checklist.
- `SPEC.md` Appendix A.

## Scope

Implement a pure TypeScript final-report assembly helper that turns verification
and runtime evidence into a typed report model and concise markdown.

## Non-Goals

- No CLI `paw report` command.
- No report artifact persistence.
- No verification execution.
- No model/provider calls.

## Acceptance Criteria

- Reports with all applicable gates verified finish as `done`.
- Reports with applicable unverified gates finish as `done_with_unverified`.
- Degraded steps are included and called out.
- Risks and evidence are preserved in deterministic order.
- Markdown output includes evidence, risks, unverified gates, and degraded steps.
