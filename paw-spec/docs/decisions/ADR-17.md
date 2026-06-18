
# ADR-17: Non-interactive / CI policy

- **Status:** Accepted
- **Date:** 2026-06-16
- **Deciders:** Tech Lead, SEC

## Context
`confirm-to-continue`, "R7 always approve", and "escalate to user" all assume a human is present.
In print/json/CI/daemon modes there is no human — which collides head-on with the liveness invariant
(can't wait) and the R7 rule (can't auto-approve).

## Decision
In `print`/`json`/CI/daemon modes, any gate needing a human is **fail-closed**: enter `BLOCKED_*`
with a **non-zero exit code**, never hang, never auto-approve. Pre-authorization is allowed **only**
via explicit flags up to **R2** (`--yes-to R0-R2`); R3–R6 require explicit `--allow R3,R4`; **R7 can
NEVER be auto-approved by any flag or mode**. Budget exceed → abort (or `block` via flag).

## Consequences
- (+) Resolves the liveness <-> R7 <-> confirm contradiction definitively.
- (+) CI gets deterministic, scriptable behavior with safe exit codes.
- (-) CI pipelines must pre-authorize risk levels explicitly (by design).

## Revisit trigger
Daemon/RPC mode introduces a trusted approval callback channel.

## Related
SPEC §9.6, §7; ADR-8, ADR-10, ADR-15.
