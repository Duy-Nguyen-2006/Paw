
# Exec Plan

## Goal

Add the pure runtime approval policy foundation required by SPEC §7 and §9.6.

## Scope

In scope:

- Risk-level ordering helpers.
- Tool-risk approval decisions.
- Product approval gate decisions.
- Read-only write blocking.
- Focused tests.

Out of scope:

- CLI flag parsing.
- Tool execution.
- Sandbox implementation.
- Budget enforcement.

## Risk Classification

Risk flags:

- Authorization.
- Audit/security.
- Public contracts.
- Existing behavior.
- Weak proof.

Hard gates:

- Authorization and audit/security semantics. R7 must never be auto-approved.

## Work Phases

1. Add focused tests for approval policy invariants.
2. Implement additive policy helpers under `packages/coding-agent/src/paw/`.
3. Export helpers from the Paw barrel.
4. Run focused tests and `npm run check`.
5. Update durable story evidence and trace.

## Stop Conditions

Pause for human confirmation if:

- R7 would need to be auto-approved by any flag or mode.
- Policy would depend on prompt instructions instead of runtime code.
- Existing `pi` CLI behavior would need to change.
