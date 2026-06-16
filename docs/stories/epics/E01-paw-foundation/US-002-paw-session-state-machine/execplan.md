# Exec Plan

## Goal

Add the pure Paw session state-machine foundation required by SPEC §6.3.

## Scope

In scope:

- State and transition types.
- Pure transition helper.
- Focused tests.
- Product/story validation updates.

Out of scope:

- `.paw` file persistence.
- Locking and stale-lock recovery.
- CLI command dispatch.
- Sub-agent runtime execution.

## Risk Classification

Risk flags:

- Public contracts.
- Existing behavior.
- Weak proof.

Hard gates:

- None in this slice, because no runtime tools, providers, auth, or sandbox
  behavior are executed.

## Work Phases

1. Add focused failing tests for the state-machine contract.
2. Implement pure state types and transition helper.
3. Export the foundation API from the Paw barrel.
4. Run focused tests and `npm run check`.
5. Update durable story evidence and trace.

## Stop Conditions

Pause for human confirmation if:

- The transition model needs to skip or rename a state from SPEC §6.3.
- Implementation would require changing existing `pi` CLI behavior.
- Persistence or locking becomes necessary for the pure state contract.
