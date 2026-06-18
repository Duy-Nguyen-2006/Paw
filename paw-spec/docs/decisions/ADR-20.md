
# ADR-20: Eval scoring oracle

- **Status:** Accepted
- **Date:** 2026-06-16
- **Deciders:** DX/QA, Tech Lead

## Context
KPIs like `pass_first_try_rate` and `accepted_without_edit_rate` need a way to be scored
automatically and deterministically; running live LLMs in PR CI is flaky, slow, and costly.

## Decision
Every benchmark `(repo, task)` ships a **deterministic scoring bundle**: a golden acceptance script
(exit 0/1), the repo's own tests, and a golden diff for similarity. **PR CI uses record/replay LLM
fixtures** (deterministic). **Live-model eval runs nightly** with **pinned model snapshots** and uses
statistical thresholds (confidence intervals), not single-run cutoffs. **PR-blocking hard gates are
deterministic only** (schema, security/red-team, liveness/resume, budget/timeout); probabilistic
quality KPIs inform but never flake the build.

## Consequences
- (+) KPIs are actually measurable; CI is deterministic, fast, and free.
- (+) Real quality is still tracked nightly with a stable scoreboard.
- (-) Maintaining scoring bundles + recorded fixtures is ongoing work.

## Revisit trigger
Fixtures drift too far from live behavior to be representative.

## Related
SPEC §19; config.yaml: kpi, sla.
