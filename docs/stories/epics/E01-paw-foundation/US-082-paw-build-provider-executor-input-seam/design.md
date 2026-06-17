# Design

## Build Executor Resolution

`PawBuildCommandInput` now supports two mutually exclusive executor forms:

- `executor`, the existing direct runtime executor injection.
- `providerExecutor`, a higher-level provider executor input passed to `createPawProviderSubAgentRuntimeExecutor`.

A small resolver chooses the direct executor first, creates the composed provider executor when explicitly requested, or falls back to the existing unavailable executor.

## Conflict Handling

Supplying both executor forms is rejected before reading or mutating session state. This keeps programmatic callers from accidentally mixing two execution paths.

## Safe Defaults

CLI `paw build` still calls `createPawBuildCommandResult` without `providerExecutor`, so default behavior remains fail-closed with `PROVIDER_UNAVAILABLE` blocked output.

## Out Of Scope

- CLI provider flags.
- Real model registry construction.
- Credential discovery or provider calls.
- Sandbox/tool execution.
- Rollback/checkpoint execution.
