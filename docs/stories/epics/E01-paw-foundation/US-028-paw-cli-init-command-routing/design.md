
# Design

## Domain Model

This story does not add a new Paw domain model. It routes a CLI command to the
existing persistence contract:

- Runtime config: loaded from `paw-spec/config.yaml`.
- Paw project initialization: creates durable `.paw/` directories and files.
- Init result: created path count and existing path count.

## Application Flow

The command flow is:

1. `main` checks for Paw commands before normal runtime setup.
2. `handlePawCommand` accepts only the bounded `paw init` slice.
3. `paw init --help` prints command help and returns.
4. `paw init` loads the default Paw runtime config from the current working
   directory ancestry.
5. The handler calls `initializePawProject(process.cwd(), config)`.
6. The handler prints `.paw` initialization status and created/existing counts.

Expected CLI misuse is handled inside the command route:

- Unknown Paw subcommands set `process.exitCode = 1`.
- Unknown `paw init` options set `process.exitCode = 1`.
- Config loading or initialization errors are reported as command errors.

## Interface Contract

New supported command:

```text
pi paw init
pi paw init --help
```

Main help mentions `pi paw init` only. It does not claim that a standalone
`paw` executable is wired.

## Data Model

No new data schema is introduced. The command relies on the existing
idempotent persistence helper, which creates missing durable `.paw/` paths and
does not overwrite existing durable files.

## UI / Platform Impact

This is a CLI-only platform slice. It should be covered by a focused command
test that runs against a temporary working directory.

## Observability

No runtime logs or telemetry are added. Command output is the operational
evidence for created and existing path counts.

## Alternatives Considered

1. Parse Paw commands through the general argument parser.
   - Rejected for this slice because Paw commands must return before agent
     runtime setup, matching package/config command routing.
2. Add a standalone `paw` binary now.
   - Rejected because US-028 only wires the bounded `pi paw init` route.
