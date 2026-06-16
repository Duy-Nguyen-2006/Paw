# US-023: Paw S3 Sandbox Detection And Fallback Evidence

## User Story

As Paw's tool runtime, I need deterministic sandbox primitive detection so writes
can be allowed only when an acceptable sandbox is available, and otherwise
forced read-only or blocked with clear remediation.

## Source References

- `SPEC.md` §11 Security.
- `SPEC.md` §14.2 Sandbox fallback matrix.
- `paw-spec/docs/decisions/ADR-18.md`.
- `paw-spec/docs/decisions/PHASE0-SPIKE-TRACKER.md` S3.

## Scope

Add a pure TypeScript detector that maps injected platform probe results to
Paw's configured sandbox primitive names and doctor-style remediation guidance.
Compose it with the existing sandbox policy in tests.

## Non-Goals

- No sandbox process launch.
- No direct shell probing in this slice.
- No CLI `paw doctor` command wiring.
- No distro package installation.

## Acceptance Criteria

- Detects `bubblewrap_landlock` when both bubblewrap and Landlock are present.
- Detects `bubblewrap_only` when bubblewrap is present without Landlock.
- Detects `userns_only` when only user namespaces are available.
- Reports no primitives and remediation when user namespaces are disabled.
- Proves no-sandbox fallback blocks R1 writes through existing policy.
- Records S3 spike evidence with limitations on real distro execution.
