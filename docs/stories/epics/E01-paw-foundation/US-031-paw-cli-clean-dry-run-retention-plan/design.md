# Design

## Domain Model

US-031 adds a command-level read model over existing Paw retention policy:

- Project status: whether `.paw/` exists as a directory.
- Retention config: `persistence.retention` loaded from
  `paw-spec/config.yaml`.
- Session records: `.paw/sessions/*` directories converted to retention records
  using directory mtime as `last_activity_at`.
- Artifact records: `.paw/artifacts/*` directories converted to retention
  records using directory mtime as `created_at`.
- Retention plan: the existing `createPawRetentionPlan` result.

The command does not add new durable data.

## Application Flow

The command flow is:

1. `handlePawCommand` accepts the bounded `paw clean` subcommand.
2. `paw clean --help` prints help and returns without creating `.paw/`.
3. `paw clean` without `--dry-run` reports that only dry-run is implemented,
   sets `process.exitCode = 1`, and deletes nothing.
4. `paw clean --dry-run` resolves `.paw/` paths from the current working
   directory.
5. The command loads retention defaults from `paw-spec/config.yaml` through the
   existing config loader.
6. If `.paw/` is missing, the report shows zero candidates and does not create
   any paths.
7. If `.paw/` exists, the command scans only immediate session and artifact
   directories, converts mtimes into retention records, calls
   `createPawRetentionPlan`, and formats the kept/removable records with
   reasons.

## Interface Contract

New supported commands:

```text
pi paw clean --dry-run
pi paw clean --help
```

The report is human-readable text. JSON output remains out of scope for this
slice.

## Safety Boundaries

The clean command is read-only. It does not call Paw initialization, acquire
locks, refresh locks, write JSON, create directories, delete paths, run
providers, or start normal agent runtime. Missing `.paw/` is a successful
dry-run result with zero candidates.

Destructive cleanup remains future work and must define approval semantics
before deleting anything.

## Alternatives Considered

1. Delete planned removal paths directly.
   - Rejected because cleanup is destructive and the story is explicitly
     bounded to read-only dry-run behavior.
2. Read session `state.json` timestamps.
   - Rejected because this command plans retention for filesystem paths, and
     US-031 requires file/directory mtimes as the record timestamps.
