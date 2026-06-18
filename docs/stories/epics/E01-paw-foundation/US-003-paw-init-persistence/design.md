
# Design

## Domain Model

The slice introduces:

- `PawProjectPaths`: resolved paths under one repository root.
- `PawInitResult`: directories and files created or already present.
- `PawAtomicWriteOptions`: future-proof write options for JSON persistence.

## Application Flow

`initializePawProject` receives a repository root and runtime config. It creates
the `.paw` skeleton, writes missing default files, and leaves existing files
unchanged. Volatile directories are ignored by `.paw/.gitignore`; durable
config, memory, rules, and decisions paths remain commit-eligible.

Atomic JSON writes use write-temp-rename semantics in the same target directory.

## Interface Contract

The TypeScript foundation under `packages/coding-agent/src/paw/` exports:

- Path resolution for `.paw`.
- Idempotent project initialization.
- Atomic JSON write/read helpers.

The implementation does not import or call the existing `pi` CLI entrypoints.

## Data Model

Filesystem only:

```text
.paw/
  config.yaml
  version
  memory/memories.yaml
  rules/
  decisions/
  .gitignore
```

Future slices add sessions, artifacts, cache, logs, locks, and migrations.

## UI / Platform Impact

No user-facing CLI behavior changes in this slice.

## Observability

The init result lists created and existing paths so future CLI output and traces
can report what changed without scanning the filesystem again.

## Alternatives Considered

1. Wire `paw init` directly into `main.ts`.
   Rejected until the foundation is tested without changing existing `pi`
   startup behavior.
2. Reuse `.pi` session directories.
   Rejected because SPEC §12 defines Paw-specific persistence and gitignore
   rules.
