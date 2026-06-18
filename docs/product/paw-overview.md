
# Paw Product Overview

## Source Of Truth

Paw v1 is defined by `SPEC.md` and the supporting `paw-spec/` bundle. If this
page conflicts with `SPEC.md`, a Paw ADR under `paw-spec/docs/decisions/`, or
`paw-spec/config.yaml`, the ADR or config wins.

## Positioning

Paw is a coding-agent harness for builders that turns a user intent into a
bounded specification, a slice plan, implementation, review, verification, and a
final report with evidence.

Primary v1 users are semi-technical builders and junior developers. Guided Mode
serves non-technical builders through simpler language and recommended defaults,
without removing the engineering gates.

## V1 Product Flow

The v1 flow is:

1. Intake and conservative classification.
2. Adaptive clarification.
3. Product SPEC drafting and approval.
4. Read-only scouting.
5. Ordered vertical-slice planning.
6. Per-slice worker, reviewer, and verifier loop.
7. Final report listing evidence, risks, unverified gates, and degraded steps.

One Paw task is one user intent, one SPEC, and one resumable session. Multiple
CLI invocations resume the same session until the final report is produced.

## V1 CLI Surface

The accepted v1 command set is:

- `paw`
- `paw init`
- `paw spec`
- `paw plan`
- `paw build`
- `paw verify`
- `paw status`
- `paw rollback`
- `paw resume`
- `paw report`
- `paw doctor`
- `paw clean`

Supported modes are interactive, print, and JSON. Daemon mode is deferred.

## Non-Goals For V1

- Browser verification as a default hard gate.
- SonarQube as a default dependency.
- Deploy connectors.
- Graph or embedding index.
- Provider plugin marketplace.
- Daemon or RPC runtime.
- SQLite-backed Paw memory.
- Full WCAG 2.1 AA verification.

## Definition Of Done

A Paw v1 task is done only when the approved SPEC and plan have completed all
slices, reviewer checks pass, applicable verification gates pass, and the final
report discloses evidence, risks, unverified gates, and degraded execution.
