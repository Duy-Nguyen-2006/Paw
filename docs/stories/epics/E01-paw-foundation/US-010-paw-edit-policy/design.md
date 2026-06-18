
# Design

## Domain Model

The slice introduces:

- Edit attempt methods: diff, fuzzy diff, full-file rewrite, no-op, and blocked.
- Patch failure policy based on attempt count and file size.
- Idempotency outcome policy based on content hashes.

## Application Flow

Future worker code asks these helpers before each edit attempt. The helper
returns the next safe action. Actual patch application and hashing remain
outside this slice.

## Interface Contract

The TypeScript foundation exports:

- Edit strategy config type.
- Next edit attempt evaluation.
- Idempotency apply evaluation.

## Data Model

No filesystem or database changes.

## UI / Platform Impact

No user-facing CLI behavior changes in this slice.

## Observability

Blocked decisions include code, message, and suggested action suitable for
future final reports.

## Alternatives Considered

1. Let patch tools decide fallbacks implicitly.
   Rejected because SPEC requires explicit fallback and block behavior.
2. Always full-file rewrite.
   Rejected because files over the configured maximum must block.
