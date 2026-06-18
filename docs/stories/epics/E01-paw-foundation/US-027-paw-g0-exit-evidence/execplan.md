
# Exec Plan

## Goal

Create the docs-only G0 exit evidence package for Paw and update the Harness
story and matrix records without claiming full runtime or CLI completion.

## Scope

In scope:

- Add G0 exit report, threat model, and config freeze docs.
- Add US-027 story packet.
- Update the G0 checklist checkboxes where evidence exists.
- Update the docs test matrix for the docs-only slice.

Out of scope:

- Runtime, CLI, provider, sandbox, or verifier implementation.
- Config default changes.
- ADR content changes.
- Live spike execution.

## Risk Classification

Risk flags:

- Audit/security.
- Public contract.
- Weak proof, because this slice is documentation proof rather than executable
  runtime proof.

Hard gates:

- Audit/security documentation.

## Work Phases

1. Read Paw source-of-truth docs, current config, tracker, and matrix.
2. Inventory ADR and spike evidence.
3. Write G0 report, threat model, and config freeze docs.
4. Add US-027 story packet.
5. Update tracker checkboxes and matrix row.
6. Run lightweight docs verification and practical repo checks.
7. Record Harness story evidence.

## Stop Conditions

Pause for human confirmation if:

- Evidence would require claiming runtime enforcement that is not implemented.
- The config freeze would require changing default values.
- An ADR would need to be reopened or changed.
- Validation requirements would need to be weakened.
