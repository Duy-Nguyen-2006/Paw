# Design

## Domain Model

US-058 is a wiring story. It connects US-057 (persisted evidence) to US-056
(final report model and markdown rendering) through the existing
`emitPawFinalReport` function. No new types, files, or persistence surfaces are
introduced. The only file modified is `final-report-emission.ts`.

### Evidence Resolution in emitPawFinalReport

After the function validates the session lock, state (`SLICE_DONE`), and
pending-slice checks, and before `createFinalReport` is called, a new block
resolves the effective `nativeVerificationRunResults`:

```typescript
const resolvedNativeVerificationRunResults =
	input.reportInput.nativeVerificationRunResults !== undefined
		? input.reportInput.nativeVerificationRunResults
		: await readPawVerificationEvidence(input.repoRoot, input.sessionId);
```

The resolved value is spread into the `reportInput` passed to
`createFinalReport`:

```typescript
const reportResult = createFinalReport(input.sessionId, {
	...input.reportInput,
	nativeVerificationRunResults: resolvedNativeVerificationRunResults,
});
```

### Precedence

| Source | Condition | Used? |
| --- | --- | --- |
| Caller-provided | `reportInput.nativeVerificationRunResults` is defined | Yes; caller wins |
| Persisted file | Caller did not provide the field; evidence file exists | Yes; read from disk |
| No file | Caller did not provide the field; evidence file absent | `[]` from `readPawVerificationEvidence` |

The explicit `!== undefined` check ensures the caller can intentionally pass `[]`
to suppress persisted evidence. Only when the field is truly absent (not on the
input object) does the function fall through to file-backed evidence.

### Why Not Modify PawFinalReportEmissionInput

The existing `reportInput` type is `Omit<PawFinalReportInput, "sessionId">`,
which already includes the optional `nativeVerificationRunResults` field
(via US-056). No type change is needed. The resolution logic lives inside
`emitPawFinalReport` so that callers who already supply evidence (e.g. a future
orchestrator that runs verification inline and passes results directly) are
unaffected.

### No Changes to Markdown Rendering

`renderPawFinalReportMarkdown` already renders the concise
`## Verification Evidence` section introduced by US-056. Raw stdout, stderr,
exit codes, commands, and reasons remain on the typed `PawFinalReport` model
but are not rendered in default markdown. No rendering changes are needed.

## Application Flow

1. A caller invokes `emitPawFinalReport` with a `reportInput` that omits
   `nativeVerificationRunResults`.
2. `emitPawFinalReport` acquires the session lock, reads the session state,
   confirms `SLICE_DONE` with no pending slices.
3. **New:** The function resolves `nativeVerificationRunResults` by calling
   `readPawVerificationEvidence(repoRoot, sessionId)`.
4. The resolved array is spread into the `reportInput` passed to
   `createFinalReport`.
5. `createPawFinalReport` produces the `PawFinalReport` with populated
   `native_verification_run_results`.
6. `renderPawFinalReportMarkdown` renders the `## Verification Evidence` section
   listing each executed gate with its status.
7. The markdown is written to `summary.md` and the state transitions to
   `FINAL_REPORT`.

When the caller explicitly supplies `nativeVerificationRunResults`, step 3 is
skipped (the caller value is used directly).

## Safety Boundaries

- `readPawVerificationEvidence` returns `[]` on ENOENT, so the function does
  not need to handle missing-file errors.
- The resolution is additive: existing `emitPawFinalReport` paths for lock,
  state, pending-slice, report-input, and transition failures are unchanged.
- The `PawFinalReportEmissionInput` type is not modified; no caller contract
  changes.
- `readPawVerificationEvidence` is an async function that reads a single JSON
  file from the session directory. The performance impact is negligible: one
  additional file read during final report emission.
- The session lock is held during the read, so the evidence file cannot be
  concurrently modified by another process.

## Alternatives Considered

1. Modify `PawFinalReportEmissionInput` to add a separate
   `persistedVerificationEvidence` field.
   - Rejected because the existing `reportInput.nativeVerificationRunResults`
     field already carries the same type. Adding a parallel field would require
     a precedence rule anyway and would confuse the API surface.
2. Move the resolution logic into `createPawFinalReport` or
   `createFinalReport`.
   - Rejected because `createPawFinalReport` is a pure function (no I/O) and
     `createFinalReport` is a local error-handling wrapper. File I/O belongs
     in the application layer (`emitPawFinalReport`), consistent with the
     function's existing pattern of reading state and writing the summary file.
3. Always read persisted evidence and merge it with caller-provided evidence.
   - Rejected because the caller must have explicit control. Merging would
     produce confusing semantics when the caller intentionally passes `[]` to
     suppress evidence (e.g. for a dry-run or diagnostic scenario).
4. Add a `usePersistedEvidence?: boolean` flag to the emission input.
   - Rejected because the default behavior (read when not provided) is the
     common case. An explicit opt-out can be achieved by passing
     `nativeVerificationRunResults: []`.

## Future Work

- Evidence retention policy integration with US-020 (retention cleanup) to
  remove `verification-evidence.json` when sessions are cleaned.
- A `paw report --verbose` flag that reads the evidence file and renders raw
  stdout/stderr per gate.
- Per-slice evidence files if multi-slice verification evidence aggregation
  becomes needed.
