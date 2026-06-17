# Design

## Domain Model

US-056 modifies `PawFinalReportInput`, `PawFinalReport`, and
`renderPawFinalReportMarkdown` in `final-report.ts`. It also updates
`PawFinalReportEmissionInput` in `final-report-emission.ts` to forward the new
field. No new files or types are introduced.

### Report Input Enrichment

`PawFinalReportInput` gains one optional field:

```typescript
nativeVerificationRunResults?: readonly PawNativeVerificationRunResult[];
```

The field is optional so that callers who do not have run results (e.g.
orchestrator code that only has gate decisions from a non-executing verify path)
do not need to supply an empty array explicitly.

### Report Model Enrichment

`PawFinalReport` gains one field:

```typescript
native_verification_run_results: readonly PawNativeVerificationRunResult[];
```

where `PawNativeVerificationRunResult` is the existing union type from
`verification-runner.ts` (already carrying per-gate execution evidence):

```typescript
type PawNativeVerificationRunResult =
  | {
      status: "verified";
      gate: string;
      verified: true;
      executed: true;
      command: readonly string[];
      exitCode: number;
      stdout: string;
      stderr: string;
    }
  | {
      status: "unverified";
      gate: string;
      verified: false;
      executed: boolean;
      command?: readonly string[];
      exitCode?: number;
      stdout?: string;
      stderr?: string;
      reason: string;
    };
```

`createPawFinalReport` stores `input.nativeVerificationRunResults ?? []` on the
returned report object. The type is already tested and exported via
`verification-runner.ts`.

### Markdown Renderer Changes

`renderPawFinalReportMarkdown` adds a `## Verification Evidence` section
between `## Verified Gates` and `## Unverified Gates`. The section renders
one line per executed gate:

```text
## Verification Evidence

- working_tree_baseline: verified
- dep_diff: unverified
```

The formatter filters `native_verification_run_results` to entries where
`executed === true` and renders `<gate>: <status>` for both verified and
unverified entries. It intentionally does not render `reason`, because reason
strings can contain command output. When no entries are executed (or the array
is empty), the section reads:

```text
## Verification Evidence

- No native verification gates executed
```

Raw `stdout`, `stderr`, `exitCode`, `command`, and `reason` fields are **not**
rendered in the default markdown. They remain on the typed model for
programmatic consumers and future detailed reporting tooling.

### Emission Forwarding

`PawFinalReportEmissionInput.reportInput` is typed as
`Omit<PawFinalReportInput, "sessionId">`. Since `nativeVerificationRunResults`
is already an optional field on `PawFinalReportInput`, no type change is needed
on the emission input. The existing code already spreads `reportInput` into
`createPawFinalReport`, so the field is forwarded automatically. The
implementation verifies this forwarding path and adds a focused test confirming
run results survive the emission round-trip.

## Application Flow

1. US-055 produces `PawVerifyCommandCompletedResult.nativeVerificationRunResults`
   when `paw verify --native` runs.
2. Future orchestrator code (outside US-056 scope) passes the run results into
   `PawFinalReportInput.nativeVerificationRunResults` when assembling the final
   report.
3. `createPawFinalReport` stores the run results on the report model.
4. `renderPawFinalReportMarkdown` renders the concise verification evidence
   section.
5. US-041's `emitPawFinalReport` writes the rendered markdown to
   `.paw/sessions/<id>/summary.md`.
6. US-045's `paw report <session-id>` reads and prints the persisted markdown,
   which now includes the verification evidence section.

## Safety Boundaries

- The `PawNativeVerificationRunResult` type is already defined and tested in
  `verification-runner.ts`. US-056 does not change its shape.
- The field is optional on `PawFinalReportInput` with a default of `[]`, so
  all existing callers remain valid without changes.
- The default markdown output does not render raw stdout, stderr, exit codes,
  commands, or reasons, preserving report conciseness. Full per-gate evidence
  is available on the typed model for programmatic consumers.
- `PawFinalReportEmission` does not need a type change because
  `reportInput` is typed as `Omit<PawFinalReportInput, "sessionId">` which
  inherits the optional field.
- No new files, types, or exports are introduced.

## Alternatives Considered

1. Render raw stdout/stderr in the markdown under a collapsible section.
   - Rejected because the markdown renderer produces plain text for CLI
     consumption, not HTML. Collapsible sections are not supported. Raw output
     can be hundreds of lines and would dominate the report. Future `--verbose`
     or `--debug` flags (out of scope) can surface it.
2. Add a `--verbose` flag to `renderPawFinalReportMarkdown` in this story.
   - Rejected because the task scope is disclosure of evidence in the typed
     model and concise renderer, not adding new CLI flags. A `--verbose` flag
     is a natural follow-up.
3. Embed run evidence directly into the verified/unverified gate sections
   instead of a separate section.
   - Rejected because the existing `## Verified Gates` and `## Unverified Gates`
     sections render `PawVerifyGateDecision` data (domain-level decisions).
     Mixing execution evidence conflates process outcome with gate evaluation.
     A separate section keeps the two concerns distinct.
4. Only expose run evidence through the typed model, not in markdown at all.
   - Rejected because the SPEC requires the final report to disclose evidence
     and verification status. A concise gate-status section satisfies the
     disclosure requirement without dumping raw output.
5. Store run results in a separate artifact file instead of on the report model.
   - Rejected because the report model is already the serialization surface for
     `paw report`. Adding file I/O for verification evidence is unnecessary
     when the data fits naturally on the existing model.

## Future Work

- A `--verbose` or `--debug` flag on `paw report` to render raw stdout, stderr,
  exit codes, commands, and reasons per gate. The data is already on the typed
  model.
- Per-gate evidence archival to `.paw/artifacts/` for long-running sessions.
- Integration of verification evidence into the orchestrator's final report
  assembly path (outside US-056 scope).
