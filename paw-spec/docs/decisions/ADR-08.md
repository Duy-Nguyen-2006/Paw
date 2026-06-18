
# ADR-08: Default approval mode

- **Status:** Accepted
- **Date:** 2026-06-16
- **Deciders:** Tech Lead, Product

## Context
v0.1 defaulted to `strict` for non-technical users — but non-technical users cannot meaningfully
approve engineering decisions, so strict becomes rubber-stamping.

## Decision
Default approval = **`balanced`**. **Product** decisions always go to the user (plain language).
**Engineering** decisions are auto unless risk >= R3. Escalations state what / why-risky /
consequence-of-no / recommended choice.

## Consequences
- (+) Low friction while preserving real safety on risky operations.
- (+) Resolves the non-tech UX contradiction (paired with Guided Mode, SPEC §4).
- (-) Teams wanting maximum control must opt into `strict`.

## Revisit trigger
An enterprise mode may default to `strict`.

## Related
SPEC §4, §7, §9.6; ADR-17.
