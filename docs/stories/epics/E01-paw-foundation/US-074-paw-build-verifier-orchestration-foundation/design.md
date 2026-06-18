
# Design

## Command

`paw build <session-id> --once` reads the session state before dispatch. `IMPLEMENTING` still uses worker orchestration, `REVIEWING` still uses reviewer orchestration, and `VERIFYING` now calls `createPawVerifyCommandResult(repoRoot, sessionId, { lockOptions })`.

## Verifier Behavior

The verifier path intentionally reuses the existing verify command implementation instead of introducing a separate verifier sub-agent executor. Without a native verification executor, the verify command evaluates configured gates as unavailable, records unverified decisions, advances `VERIFYING` to `SLICE_DONE`, writes empty native evidence, and releases the owned lock.

## Output

`formatPawBuildCommandResult` detects completed verifier results by their verification decision fields and renders the build result with planned gates, native executed gates, verified gates, unverified gates, state transition, and lock-release status.

## Out Of Scope

- Real provider execution for worker or reviewer roles.
- Native verifier subprocess execution from `paw build`.
- Multi-slice orchestration loops beyond one bounded build step.
