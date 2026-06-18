
# ADR-04: Browser verification stack

- **Status:** Accepted
- **Date:** 2026-06-16
- **Deciders:** Tech Lead, BE1

## Context
Browser verification (console/network/screenshot/a11y) is valuable but environment-heavy. Chrome
DevTools MCP is one option but ties us to a specific evolving tool.

## Decision
Define a `BrowserVerifier` abstraction. Default implementation = **Playwright with bundled
Chromium**. Chrome DevTools MCP is **one adapter** behind the abstraction. Browser verification is
`[V2]` (opt-in), not in the v1 MVP slice.

## Consequences
- (+) Robust headless on Linux; no lock-in; swappable adapters.
- (-) Bundled Chromium increases install size when the feature is enabled.

## Revisit trigger
A stable, clearly superior MCP/browser primitive emerges.

## Related
SPEC §17 (design), §10.1 (a11y deferral).
