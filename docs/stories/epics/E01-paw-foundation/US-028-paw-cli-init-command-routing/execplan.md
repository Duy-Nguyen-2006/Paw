
# Exec Plan

## Goal

Implement the bounded `pi paw init` CLI slice without claiming full Paw CLI or
runtime orchestration completion.

## Scope

In scope:

- Add a Paw init command handler.
- Route `pi paw init` and `pi paw init --help` before normal agent runtime
  setup.
- Load `paw-spec/config.yaml` through the existing Paw config loader.
- Call `initializePawProject(process.cwd(), config)`.
- Print concise initialized/created/existing output.
- Add focused Vitest coverage for init files, idempotency, help, misuse, and
  main routing.
- Update story docs and test matrix evidence.

Out of scope:

- Standalone `paw` binary wiring.
- Other Paw commands such as `spec`, `plan`, `build`, `status`, or `report`.
- Runtime orchestration, session resume, workers, reviewers, verifiers, or
  provider execution.
- Changing durable `.paw` no-overwrite behavior.

## Risk Classification

Risk flags:

- Public contract, because a new CLI command route is exposed.
- Existing behavior, because `main` routing changes before normal runtime.
- Weak proof, limited to focused command tests and root checks.

Hard gates:

- None.

Lane: normal.

## Work Phases

1. Read current CLI routing, argument help, Paw config, persistence, existing
   persistence tests, product docs, and matrix.
2. Add the focused command tests.
3. Implement the Paw init handler and main routing.
4. Update main help output.
5. Add story packet and matrix evidence without claiming full Paw CLI.
6. Run focused Vitest, root check, and Harness story verification.
7. Record Harness story evidence.

## Stop Conditions

Pause for human confirmation if:

- The command needs to overwrite existing `.paw` files.
- The slice would require wiring a standalone `paw` executable.
- The implementation would need to start Paw orchestration or provider-backed
  runtime behavior.
