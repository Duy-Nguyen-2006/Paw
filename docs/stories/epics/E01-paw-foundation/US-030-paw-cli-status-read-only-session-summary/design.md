# Design

## Domain Model

US-030 adds a command-level read model over existing Paw persistence state:

- Project status: whether `.paw/` exists as a directory.
- Config summary: `.paw/config.yaml` parsed with the existing runtime config
  parser.
- Version summary: `.paw/version` value, missing, or read error.
- Session summary: directories under `.paw/sessions`, valid state counts, and
  invalid/unreadable state count.

The command does not add new durable data.

## Application Flow

The command flow is:

1. `handlePawCommand` accepts the bounded `paw status` subcommand.
2. `paw status --help` prints help and returns without creating `.paw/`.
3. Unknown `paw status` options report command misuse and set
   `process.exitCode = 1`.
4. `paw status` resolves `.paw/` paths from the current working directory.
5. If `.paw/` is missing, the formatter reports the project is not initialized
   and suggests `pi paw init`.
6. If `.paw/` exists, the report reads `.paw/config.yaml`, `.paw/version`, and
   `.paw/sessions/*/state.json`.
7. Valid session states are counted by state name through the existing state
   validators/readers. Invalid or unreadable state files are counted, not
   thrown to the user.

## Interface Contract

New supported commands:

```text
pi paw status
pi paw status --help
```

The report is human-readable text. JSON output remains out of scope for this
slice.

## Safety Boundaries

The status command is read-only. It does not call Paw initialization, acquire
locks, refresh locks, write JSON, create directories, run providers, or start
normal agent runtime. Missing `.paw/` is a successful status result, not a
command failure.

## Alternatives Considered

1. Reuse session-store lock helpers to inspect locks.
   - Rejected because the story asks for session state summaries only, and
     lock helpers can perform ownership and stale checks that are not required
     for a read-only status slice.
2. Parse session `state.json` directly in the status command.
   - Rejected because the existing session reader already validates unknown
     JSON through explicit parsing and state-machine validation.
