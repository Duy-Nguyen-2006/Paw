
# Exec Plan

## Goal

Create the first verifiable Paw foundation slice while preserving the spec's
G0/P0 gate and avoiding broad changes to the existing `pi` CLI.

## Scope

In scope:

- Product docs derived from `SPEC.md`.
- Durable registration of Paw ADRs.
- Story packet and matrix row for this slice.
- Additive TypeScript foundation under `packages/coding-agent/src/paw/`.
- Focused unit tests for config loading and sub-agent output validation.

Out of scope:

- Completing or claiming the five P0 spikes.
- Adding the full `paw` CLI command set.
- Provider adapters, sandboxing, checkpoint rollback, and eval harness runtime.

## Risk Classification

Risk flags:

- Audit/security.
- External systems.
- Public contracts.
- Existing behavior.
- Weak proof.
- Multi-domain.

Hard gates:

- Security and provider behavior are in the accepted spec.
- R7 approval and non-interactive fail-closed policy must not be weakened.

## Work Phases

1. Register Paw ADR decisions and create product docs.
2. Add this high-risk story packet and durable story row.
3. Add focused failing tests for Paw config and sub-agent contracts.
4. Implement the smallest additive foundation API.
5. Run the focused test, `npm run check`, and story verification.
6. Record trace evidence and remaining Phase 0 blockers.

## Stop Conditions

Pause for human confirmation if:

- Full CLI behavior needs to be added before Phase 0 evidence exists.
- A P0 spike needs external infrastructure not present in this workspace.
- Security, sandbox, or provider policy would need to be weakened.
- Existing `pi` CLI behavior would need to change.
