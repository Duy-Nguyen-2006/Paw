
# Overview

## Current Behavior

Paw has foundations for config, sub-agent contracts, session state, `.paw`
project persistence, and session locks. It does not yet expose a runtime policy
helper for risk-level approval decisions.

## Target Behavior

The Paw foundation can evaluate tool and product-approval gates from
`paw-spec/config.yaml`:

- R0 through R2 may run automatically.
- R3 through R6 require interactive approval or explicit non-interactive
  `--allow` levels.
- R7 always requires explicit human approval and can never be auto-approved in
  any mode.
- Product approval fails closed in non-interactive modes.
- `--read-only` blocks write-level risks.

## Affected Users

- Future Paw CLI users in interactive, print, JSON, and CI modes.
- Engineers and agents implementing runtime tool enforcement.

## Affected Product Docs

- `docs/product/paw-security.md`

## Non-Goals

- Executing tools.
- CLI flag parsing.
- Sandbox enforcement.
- Budget enforcement.
- Provider calls.
