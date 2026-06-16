# ADR-21: Edit strategy

- **Status:** Accepted
- **Date:** 2026-06-16
- **Deciders:** BE2, Tech Lead

## Context
Diff-only edits save tokens, but models frequently produce patches that don't apply cleanly
(context drift). A hard "never reprint the whole file" rule leaves no recovery path; "idempotent
re-run" was asserted without a mechanism.

## Decision
**Diff-first**: apply patch → on failure, **fuzzy-apply (≤2 retries)** → then **full-file rewrite for
files ≤ 400 lines** → else `BLOCKED_PATCH_APPLY_FAILED` (with the failing hunk). Every applied change
is recorded in the slice journal with a **content hash**; before applying, the worker compares the
current file hash (already-present → no-op; base drifted → re-derive or block). Patches apply in the
shadow worktree, then promote atomically.

## Consequences
- (+) Token-frugal by default, with a safe recovery path; no silent corruption.
- (+) Concrete, testable idempotency for resume.
- (-) Full-file fallback uses more tokens on large files (bounded at 400 lines).

## Revisit trigger
A materially more robust apply format/tool becomes standard.

## Related
SPEC §8.5, §9.2; ADR-19; config.yaml: edit.
