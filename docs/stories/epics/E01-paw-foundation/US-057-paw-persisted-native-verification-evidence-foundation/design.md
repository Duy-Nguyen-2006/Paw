
# Design

## Domain Model

US-057 adds a persistence surface for `PawNativeVerificationRunResult[]` in the
session directory. It modifies `session-store.ts` (new path, read, and write
functions) and `verify-command.ts` (persistence call after completion). No new
types or files are introduced beyond the evidence JSON file itself.

### Session Paths Enrichment

`PawSessionPaths` gains one field:

```typescript
verificationEvidenceFile: string;
```

`resolvePawSessionPaths` resolves it to
`join(sessionDir, "verification-evidence.json")`.

### Evidence Read/Write Functions

`writePawVerificationEvidence` and `readPawVerificationEvidence` are added to
`session-store.ts`:

```typescript
export async function writePawVerificationEvidence(
  repoRoot: string,
  sessionId: string,
  results: readonly PawNativeVerificationRunResult[],
): Promise<void>;

export async function readPawVerificationEvidence(
  repoRoot: string,
  sessionId: string,
): Promise<readonly PawNativeVerificationRunResult[]>;
```

`writePawVerificationEvidence` resolves the session paths, then calls
`writePawJsonAtomic(paths.verificationEvidenceFile, results)`. The function
accepts an empty array and writes `[]` to the file, ensuring the file always
contains valid JSON after a verify run.

`readPawVerificationEvidence` resolves the session paths and attempts
`readPawJson`. When the file does not exist (ENOENT), it returns `[]`. Any
other read error is thrown.

The functions import `PawNativeVerificationRunResult` from
`verification-runner.ts`. The type is already exported and tested.

### Verify Command Persistence

In `createPawVerifyCommandResult`, after the switch on `verification.status`
returns a `completed` or `completed_with_unverified` result, the function calls
`writePawVerificationEvidence(repoRoot, sessionId, nativeVerificationRunResults)`
before returning. This ensures the evidence is persisted atomically before the
caller receives the result.

When the non-executing path is used, `nativeVerificationRunResults` is `[]` and
the file is written with an empty array. This is intentional: it records that
a verify run occurred with no native execution, distinguishing it from the case
where no verify has been run at all (no file).

The persistence call occurs after `completePawVerification` transitions the
state and before `releasePawSessionLock`, matching the existing ordering
convention in the verify command flow.

### No Changes to PawSessionState

The `PawSessionState` type and `state.json` file are not modified. Verification
evidence is a separate data file in the session directory, not part of the state
machine. This keeps the state machine shape stable and avoids coupling gate
execution evidence to state transitions.

### JSON File Format

The persisted `verification-evidence.json` is a JSON array:

```json
[
  {
    "status": "verified",
    "gate": "working_tree_baseline",
    "verified": true,
    "executed": true,
    "command": ["git", "diff", "--quiet"],
    "exitCode": 0,
    "stdout": "",
    "stderr": ""
  },
  {
    "status": "unverified",
    "gate": "dep_diff",
    "verified": false,
    "executed": true,
    "command": ["git", "diff", "HEAD~1", "--name-only"],
    "exitCode": 1,
    "stdout": "package.json\n",
    "stderr": "",
    "reason": "Dependencies changed since last commit."
  }
]
```

When no native execution occurred:

```json
[]
```

The file uses `writePawJsonAtomic` which writes to a temp file and renames,
providing crash-safe persistence.

## Application Flow

1. `paw verify <session-id> --native` runs via `runPawVerifyCommand`.
2. `createPawVerifyCommandResult` acquires the session lock, runs the native
   verification plan, and calls `completePawVerification` to transition the
   state to SLICE_DONE.
3. **New:** Before returning, `createPawVerifyCommandResult` calls
   `writePawVerificationEvidence(repoRoot, sessionId, nativeVerificationRunResults)`.
4. The evidence file is written atomically to
   `.paw/sessions/<id>/verification-evidence.json`.
5. The session lock is released.
6. Future orchestrator code reads the evidence via
   `readPawVerificationEvidence(repoRoot, sessionId)` when assembling
   `PawFinalReportInput.nativeVerificationRunResults` (connecting US-055 and
   US-056 through durable storage).

## Safety Boundaries

- The `PawNativeVerificationRunResult` type is already defined, tested, and
  exported from `verification-runner.ts`. US-057 does not change its shape.
- `writePawJsonAtomic` provides crash-safe atomic writes via temp-file-rename,
  consistent with all other Paw persistence.
- The evidence file is separate from `state.json`, avoiding any change to the
  state machine contract.
- `readPawVerificationEvidence` returns `[]` on ENOENT, so callers do not need
  to check for file existence.
- Empty arrays are written for non-executing verify runs, ensuring the file
  always contains valid JSON after any verify run.
- The persisted JSON carries full per-gate evidence (exit codes, stdout, stderr,
  commands, reasons) for programmatic consumers. No markdown rendering is added
  in this story.
- No changes to the session lock protocol or lock file format.

## Alternatives Considered

1. Add a `verificationEvidence` field to `PawSessionState`.
   - Rejected because the state machine type is a pure transition structure
     with bounded fields. Gate execution evidence is orthogonal to state
     transitions and would bloat the state shape. A separate file follows the
     existing pattern (slice-journal.jsonl is separate from state.json).
2. Append verification evidence to `slice-journal.jsonl`.
   - Rejected because the slice journal records state transitions, not
     per-gate execution data. Mixing the two conflates process events with
     evidence storage. The evidence file is per-session (not per-slice) because
     verify runs once per slice but the file aggregates evidence for the final
     report.
3. Store evidence only in memory on the verify command result, with no
   persistence.
   - Rejected because the task intent is durable evidence that survives process
     boundaries. In-memory results are lost when the CLI process exits.
4. Render evidence into `summary.md` at persist time.
   - Rejected because US-056 already handles markdown rendering in the final
     report. Persisting raw JSON and rendering separately keeps concerns
     distinct. The summary.md is written by the final-report-emission path
     (US-041), not by the verify command.
5. Use a per-slice evidence file (`<slice-id>-verification-evidence.json`).
   - Rejected because in v1 only one slice is verified at a time and the final
     report needs evidence from the current slice. A per-session file is
     simpler. Per-slice evidence files are a natural extension if multi-slice
     verification evidence aggregation becomes needed.

## Future Work

- Orchestrator integration: pass `readPawVerificationEvidence` results into
  `PawFinalReportInput.nativeVerificationRunResults` when assembling the final
  report.
- Per-slice evidence files if multi-slice verification evidence aggregation is
  needed.
- Evidence retention policy integration with US-020 (retention cleanup).
- A `paw report --verbose` flag that reads the evidence file and renders raw
  stdout/stderr per gate.
