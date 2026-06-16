# Design

## Domain Model

The slice introduces:

- `PawSliceJournalEntry`: one applied change record.
- Append/read helpers for session-local JSONL.
- Idempotency lookup helpers by slice id, file path, and content hash.

## Application Flow

Future worker code records a journal entry after an edit is safely applied. On
resume, the worker can read the journal to skip already-applied changes or
detect that a base has drifted before reapplying.

## Interface Contract

The TypeScript foundation exports:

- Journal append.
- Journal read.
- Applied-change lookup.

## Data Model

The journal is stored at `.paw/sessions/<session-id>/slice-journal.jsonl`.

## UI / Platform Impact

No user-facing CLI behavior changes in this slice.

## Observability

Malformed journal records include line numbers in thrown errors.

## Alternatives Considered

1. Store journals as a single JSON array.
   Rejected because JSONL supports append-only writes and partial inspection.
2. Delay journaling until rollback work.
   Rejected because idempotency is needed before rollback.
