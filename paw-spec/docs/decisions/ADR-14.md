
# ADR-14: Model routing & reasoning

- **Status:** Accepted
- **Date:** 2026-06-16
- **Deciders:** Tech Lead, BE1

## Context
One strong model for everything is slow and expensive; one cheap model for everything is dumb on
hard reasoning.

## Decision
**Per-role model tiers** (cheap → mid → strong). **Extended/deep thinking is gated** to high-risk
tasks and the planner/reviewer roles only. Hard-step pattern: cheap **drafts**, strong **verifies
the delta**; if cheap-confidence is low OR the verifier disagrees, escalate to a **full strong pass**.

## Consequences
- (+) Speed + cost savings without dumbing down core reasoning.
- (+) Quality guard prevents silent degradation from the draft/verify shortcut.
- (-) Routing + escalation logic must be carefully tuned (eval harness).

## Revisit trigger
Tier benchmarks shift materially (a cheaper model becomes "strong enough").

## Related
SPEC §8.3, §8.4; config.yaml: model_tiers, role_routing, thinking.
