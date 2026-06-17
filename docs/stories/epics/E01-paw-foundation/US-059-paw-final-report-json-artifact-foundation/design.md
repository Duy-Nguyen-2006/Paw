# Design

## Domain Model

US-059 adds a JSON persistence surface for the final report and a `--json`
output path on the report CLI command. Two files change:
`session-store.ts` (new path) and `final-report-emission.ts` (write the JSON
artifact). One file changes substantially: `report-command.ts` (new `--json`
flag, new result variants, new formatting). No new types are introduced
beyond the report-command result variants.

### New Session Path: reportJsonFile

`PawSessionPaths` gains a `reportJsonFile` field:

```typescript
reportJsonFile: join(sessionDir, "report.json"),
```

This sits alongside `summaryFile` and `verificationEvidenceFile` in the
session directory. The path is resolved by `resolvePawSessionPaths` and
available to all callers that already receive a `PawSessionPaths` object.

### JSON Artifact Write in emitPawFinalReport

After the existing `writeFile(paths.summaryFile, markdown, "utf-8")` call,
a second write persists the typed report:

```typescript
await writeFile(paths.reportJsonFile, JSON.stringify(reportResult.report, null, 2), "utf-8");
```

The write uses `JSON.stringify` with 2-space indentation for human readability.
The serialized object is the raw `PawFinalReport` produced by
`createPawFinalReport`; no fields are added, removed, or renamed. The JSON
artifact is the canonical machine-readable form of the report while
`summary.md` is the human-readable form.

`PawFinalReportEmissionCompletedResult` gains a `reportJsonFile: string` field
so callers can inspect the path of the persisted JSON.

### Why Not a Separate read/write Pair

US-057 introduced `writePawVerificationEvidence` / `readPawVerificationEvidence`
because verification evidence is consumed across multiple subsystems (verify
command, emission, future orchestrator). The final report JSON artifact is
written once during emission and read once during the report command. A
dedicated read/write pair would add indirection without benefit. If a future
story needs programmatic JSON report reading, a `readPawFinalReportJson`
helper can be extracted at that time.

### Report Command --json Flag

`runPawReportCommand` currently expects exactly one argument (the session id).
The `--json` flag is accepted as the second argument:

```
paw report <session-id>          # markdown (unchanged)
paw report <session-id> --json   # JSON
paw report --json                # error: missing session id
```

The argument parsing in `runPawReportCommand` is updated:

1. If `args` contains `--json`, extract it and set a `json` boolean.
2. Apply the existing arg-count guards (0 args = error, >1 non-json arg =
   error, `--help` = help).
3. Route to `createPawReportCommandResult` (markdown) or
   `createPawReportJsonCommandResult` (JSON).

#### New Result Variants

```typescript
interface PawReportCommandFoundJsonResult {
	status: "found_json";
	sessionId: string;
	json: string;
}

interface PawReportCommandMissingReportJsonResult {
	status: "missing_report_json";
	sessionId: string;
	reportJsonFile: string;
}
```

`PawReportCommandResult` is extended with both variants.

#### createPawReportJsonCommandResult

Reads `report.json` from the session directory. On ENOENT, returns
`missing_report_json` with the relative path to the expected file. On
success, returns `found_json` with the raw JSON string.

#### formatPawReportJsonCommandResult

For `found_json`, prints the JSON string as-is (already pretty-printed on
write). For `missing_report_json`, prints:

```
No final report JSON artifact found for session <id> at <path>. Run the task to completion first.
```

For `missing_project`, reuses the existing message.

### help Update

`printPawReportHelp` is updated to document the `--json` flag:

```
Usage:
  pi paw report <session-id>            Show final report markdown
  pi paw report <session-id> --json     Show final report JSON
  pi paw report --help                  Show this help
```

## Application Flow

### Emission (write path)

1. A caller invokes `emitPawFinalReport`.
2. Lock, state, pending-slice, evidence resolution, report creation, and
   state transition proceed unchanged.
3. `summary.md` is written (existing behavior).
4. **New:** `report.json` is written with `JSON.stringify(report, null, 2)`.
5. The state is written and the result is returned with `reportJsonFile` set.

### Report CLI (read path, --json)

1. User runs `paw report <session-id> --json`.
2. `runPawReportCommand` parses `--json` from args.
3. `createPawReportJsonCommandResult` resolves session paths and reads
   `report.json`.
4. If the file exists, `formatPawReportJsonCommandResult` prints the JSON.
5. If the file does not exist, the error message is printed and
   `process.exitCode = 1`.

### Report CLI (read path, default -- unchanged)

1. User runs `paw report <session-id>`.
2. `runPawReportCommand` detects no `--json` flag.
3. Existing `createPawReportCommandResult` reads `summary.md` and prints it.
4. No behavioral change.

## Safety Boundaries

- The JSON write is additive. If the write fails (disk full, permissions),
  the error propagates after `summary.md` is already written. This is
  acceptable: the markdown artifact is the primary deliverable and the JSON
  artifact is supplementary. A future story could make the writes atomic, but
  that is out of scope here.
- The `report.json` file is written under the session lock, so no concurrent
  write conflict is possible.
- `readFile` in `createPawReportJsonCommandResult` uses UTF-8 and returns the
  raw string. No schema validation is performed on read; the file is trusted
  because it was written by `emitPawFinalReport` under the session lock.
- The `--json` flag is positional (second argument after session id). This
  avoids ambiguity with session ids that might start with `--` (which are
  already invalid session ids per `assertValidSessionId`).
- The `missing_report_json` error distinguishes a missing JSON artifact from
  a missing session or missing markdown report, so the user gets a targeted
  diagnostic.

## Alternatives Considered

1. Auto-generate JSON from markdown on read.
   - Rejected because parsing markdown back to structured data is fragile and
     lossy. Persisting the typed object on write is simpler and lossless.
2. Store JSON and derive markdown on read.
   - Rejected because `summary.md` is the primary artifact consumed by humans
     and tools today. Changing the derivation direction would break the
     existing contract.
3. Use a single `report.json` and derive markdown on read.
   - Rejected for the same reason as (2). The markdown file is the established
     contract.
4. Add `--json` as a flag anywhere in the argument list (not just second
   position).
   - Rejected because the current arg parsing is positional and simple. A
     general flag parser would be over-engineering for a single boolean flag.
5. Validate `report.json` against a JSON schema on read.
   - Rejected because the file is written by the same codebase under a lock.
     Schema validation adds complexity without a demonstrated need. A future
     story could add it if cross-version compatibility becomes a concern.

## Future Work

- A `paw report <session-id> --format <json|markdown>` generic format flag
  if additional output formats are needed.
- Evidence retention integration with US-020 (retention cleanup) to remove
  `report.json` when sessions are cleaned.
- Streaming JSON output for very large reports.
- A `paw report <session-id> --json --pretty=false` compact JSON mode.
