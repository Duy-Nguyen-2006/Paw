
# Exec Plan

## Goal

Implement the bounded `pi paw doctor` CLI diagnostic without enabling
write-capable Paw runtime behavior.

## Scope

In scope:

- Add a doctor command module.
- Add a pure report builder and formatter with injected probe facts.
- Add read-only live probe collection for the CLI command.
- Route `pi paw doctor` and `pi paw doctor --help` through the existing Paw
  handler.
- Add focused Vitest coverage for available, reduced/unavailable, help,
  unknown options, and main routing.
- Update story docs and test matrix evidence.

Out of scope:

- Full Paw command set completion.
- Standalone `paw` executable routing.
- Sandbox execution, child processes, package installation, or write-capable
  work.
- Full cross-distro live validation.

## Risk Classification

Risk flags:

- Public contract, because a new CLI command route is exposed.
- Security-adjacent diagnostics, because sandbox status is reported, but no
  enforcement or write permission behavior changes.
- Existing behavior, because the Paw handler route expands.
- Weak proof, because live sandbox capability varies by host and distro.

Hard gates:

- None. The prompt narrows the slice to read-only diagnostics.

Lane: normal, bounded by read-only behavior and focused tests.

## Work Phases

1. Read existing Paw CLI routing, sandbox detector, tests, product security
   docs, config, and test matrix.
2. Run degraded impact analysis for the Paw handler.
3. Add focused doctor command tests.
4. Implement the doctor report helper, formatter, read-only live probe, and
   handler route.
5. Update story packet and matrix evidence.
6. Run focused Vitest, root check, and Harness story verification.
7. Record durable story proof.

## Stop Conditions

Pause for human confirmation if:

- The command would need to execute write-capable work.
- The command would need to modify `main.ts`.
- The implementation would need to claim complete cross-distro sandbox
  validation.
