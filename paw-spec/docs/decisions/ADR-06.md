
# ADR-06: Model providers

- **Status:** Accepted
- **Date:** 2026-06-16
- **Deciders:** Tech Lead, BE1

## Context
The model landscape changes constantly; hardcoding providers/models is fragile (v0.1's fictional
model names were a symptom).

## Decision
Introduce a `ModelProvider` abstraction. Ship **2 hosted adapters + 1 local (Ollama, optional)**.
**No provider plugin marketplace in v1.** Concrete model ids live in `config.yaml`, never in code.

## Consequences
- (+) Per-role tiering, fallback, cost tracking all flow through one seam.
- (+) Swapping models is a config change.
- (-) Each adapter must normalize differing caching/tooling semantics.

## Revisit trigger
Third-party provider/plugin demand justifies a marketplace.

## Related
SPEC §8.2, §8.4; ADR-13, ADR-14.
