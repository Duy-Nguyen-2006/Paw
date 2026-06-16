# Design

## Domain Model

The slice introduces:

- Sandbox primitive availability and fallback decisions.
- Secret path exclusion decisions.
- Lightweight redaction classification decisions.
- Prompt-injection source handling decisions.

## Application Flow

Future tool runtime code calls these helpers before executing a tool or writing
artifact/log content. The helpers return structured decisions such as allow,
force read-only, blocked, exclude, redact, or handle as read-only summary.

## Interface Contract

The TypeScript foundation exports:

- Sandbox fallback evaluation from config.
- Secret path exclusion helper.
- Secret-like value classification helper.
- Untrusted-source handling helper.

## Data Model

No filesystem or database changes.

## UI / Platform Impact

No user-facing CLI behavior changes in this slice.

## Observability

Blocked sandbox decisions and redaction decisions include reasons suitable for
future reports.

## Alternatives Considered

1. Use string denylist only.
   Rejected because SPEC says denylist is secondary and sandbox policy is
   primary.
2. Let prompts decide whether content is trusted.
   Rejected because untrusted content must be processed as data only.
