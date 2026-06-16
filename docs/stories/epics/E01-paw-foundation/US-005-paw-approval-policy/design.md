# Design

## Domain Model

The slice introduces:

- `PawRunMode`: `interactive`, `print`, `json`, or `ci`.
- `PawApprovalDecision`: discriminated result for `allow`, `needs_approval`, or
  `blocked`.
- `PawApprovalPolicyInput`: runtime mode, risk level, read-only state, and
  explicitly allowed risk levels.

## Application Flow

Future tool execution asks the policy helper before running. The helper returns
a structured decision. Callers can run allowed actions, prompt users for
interactive approvals, or enter `BLOCKED_TOOL_PERMISSION` /
`BLOCKED_NEEDS_USER_DECISION` without executing the action.

## Interface Contract

The TypeScript foundation under `packages/coding-agent/src/paw/` exports:

- Tool-risk approval evaluation.
- Product-approval gate evaluation.
- Risk-level ordering helpers.

The helpers are pure and derive default behavior from `PawRuntimeConfig`.

## Data Model

No filesystem or database changes.

## UI / Platform Impact

No user-facing CLI behavior changes in this slice.

## Observability

Blocked decisions include a code, message, and suggested action suitable for a
future final report.

## Alternatives Considered

1. Enforce permissions in prompts.
   Rejected because SPEC §7 requires runtime enforcement, not prompt trust.
2. Wait for CLI wiring to define policy.
   Rejected because the safety contract should be tested before any tool
   execution path can call it.
