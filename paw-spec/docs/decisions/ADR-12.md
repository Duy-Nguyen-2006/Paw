
# ADR-12: Target project types

- **Status:** Accepted
- **Date:** 2026-06-16
- **Deciders:** Tech Lead, PM

## Context
Supporting every project type dilutes focus. The MVP must prove value on a representative set.

## Decision
v1 targets **web apps + generic Node/TS/Python** projects. Non-web projects are supported but
web-specific gates **degrade gracefully** (marked "not applicable", never failures).

## Consequences
- (+) Clear test matrix: Next.js web app, FastAPI service, Node CLI (MVP DoD).
- (-) Mobile/embedded not targeted in v1.

## Revisit trigger
Mobile/embedded demand.

## Related
SPEC §5 (MVP DoD), §16.
