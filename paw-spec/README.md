# Paw — Build Spec Bundle (v0.4 FINAL)

This bundle is the complete, build-ready package for the Paw v1 (MVP) build.

## Contents

```
  paw-spec/
    README.md                      # this index
  ../SPEC.md                     # the definitive build spec for this repo
  config.yaml                    # full default runtime configuration
  schemas/
    subagent-contract.schema.json  # JSON Schema for every sub-agent output (§14.1)
  docs/decisions/
    ADR-01.md ... ADR-21.md       # all 21 accepted architecture decisions (Gate G0)
```

## How the team uses this

1. **Phase 0 (Gate G0):** read every ADR in `docs/decisions/`. They are pre-accepted; only
   re-open one if its explicit *Revisit trigger* fires. Run the 5 P0 spikes (SPEC §21) with
   kill-criteria before writing production code.
2. **Phase 1:** freeze contracts. `schemas/subagent-contract.schema.json` is the canonical
   sub-agent I/O contract — validate every sub-agent response against it at runtime
   (invalid → one retry → `blocked`, never crash).
3. **All phases:** `config.yaml` is the single source of runtime defaults (model tiers, per-class
   budgets, context caps, resilience timeouts, approval matrix, sandbox policy). Numbers are
   adaptive defaults tuned by the eval harness (SPEC §19) — never hardcode them in code.

## Precedence

If prose anywhere conflicts with an ADR or a `config.yaml` value, **the ADR / config wins**
(SPEC §0). Non-negotiable runtime rules are in SPEC §25.

## Definition of Done (v1)

SPEC approved (product) → plan approved → all slices implemented → reviewer pass → all
*applicable* verify gates green → final report with evidence / risks / unverified / degraded.
Unrunnable gates → `done_with_unverified[...]`. Enforced by the SPEC §20 merge checklist.
