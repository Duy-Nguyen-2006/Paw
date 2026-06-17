# Design

## Domain Model

US-055 modifies `PawVerifyCommandCompletedResult` in `verify-command.ts` and
the formatter in the same file. No new files are introduced.

### Result Enrichment

`PawVerifyCommandCompletedResult` gains one field:

```typescript
nativeVerificationRunResults: readonly PawNativeVerificationRunResult[];
```

where `PawNativeVerificationRunResult` is the existing union type from
`verification-runner.ts` that carries per-gate execution evidence:

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

The field is always present on completed results. When the executor path was
used it contains one entry per planned gate with populated exit codes and
summarized output. When the non-executing path was used it is an empty array.

### Formatter Changes

`formatPawVerifyCommandResult` renders a concise one-line summary of executed
gates rather than a detailed per-gate exit-code/stdout/stderr section. The
summary is appended to the existing output:

```text
native executed gates: working_tree_baseline(verified), dep_diff(unverified)
```

When no gates were executed (or when the array is empty) the line reads:

```text
native executed gates: none
```

The gate names and statuses come from
`formatNativeExecutedGateNames(results)`, which filters to executed entries and
joins `<gate>(<status>)` strings. This concise format keeps the verify output
readable for day-to-day use while the full per-gate evidence (exit codes,
stdout, stderr, reasons) remains available programmatically on the result
object for future detailed reporting and debugging tooling.

## Application Flow

1. `runPawVerifyCommand` detects `--native` and constructs the policy-checked
   subprocess executor (unchanged from US-054).
2. `createPawVerifyCommandResult` receives the executor on
   `PawVerifyCommandInput.nativeVerificationExecutor`.
3. When the executor is present, the existing code already calls
   `runPawNativeVerificationPlan(nativeVerificationPlan, executor, options)`
   and receives `PawNativeVerificationRunResult[]`. The result is currently
   consumed only by `mapPawNativeVerificationRunResults` which discards the
   per-gate evidence. US-055 stores the raw run results on the completed
   result alongside the mapped decisions.
4. When no executor is present, `nativeVerificationRunResults` is set to `[]`.
5. `formatPawVerifyCommandResult` renders the concise executed-gates summary
   line using `formatNativeExecutedGateNames`.

## Safety Boundaries

- The `PawNativeVerificationRunResult` type is already defined and tested in
  `verification-runner.ts`. US-055 does not change its shape.
- The concise formatter output is bounded by nature; full per-gate detail
  (exit codes, stdout, stderr) is available on the result object for programmatic
  consumers but not rendered in the text output.
- The non-executing path is unchanged in behavior; the only difference is an
  empty array on a field that the formatter skips.
- No new types, files, or exports are introduced beyond the field addition and
  formatter update.
- `PawNativeVerificationRunResult` is already re-exported from the Paw package
  index via `verification-runner.ts`. If not, an export line is added to
  `index.ts`.

## Alternatives Considered

1. Store only exit codes per gate, not full `PawNativeVerificationRunResult`.
   - Rejected because the full result object already exists, is tested, and
     includes stdout/stderr that are needed for debugging. A subset would
     require a new type for no benefit.
2. Embed per-gate evidence directly in `PawVerifyGateDecision`.
   - Rejected because `PawVerifyGateDecision` is the domain-level
     verified/unverified decision produced by `evaluatePawVerifyGate`. Mixing
     execution evidence into it conflates process outcome with gate evaluation.
     The two serve different consumers.
3. Store run results in a separate file instead of the in-memory result.
   - Rejected because the result object is already the serialization surface
     for `paw verify`. Adding file I/O for debugging evidence is premature
     before the final report emission layer (US-041) decides on evidence
     archival.
4. Only expose run results through `--json` output.
   - Rejected because the task does not add `--json`. The formatted text output
     is the current surface and per-gate evidence belongs there for debugging.
5. Render detailed per-gate exit codes, stdout, and stderr in the text formatter.
   - Rejected because the concise summary keeps verify output readable. Full
     per-gate detail (exit codes, stdout, stderr, reasons) is available on the
     result object for programmatic consumers and can be surfaced by future
     detailed reporting tooling.

## Future Work

A detailed per-gate report (exit codes, truncated stdout/stderr, failure
reasons) rendered as a text block in the formatter output is deferred. The
`PawNativeVerificationRunResult[]` data is already captured on the result
object; a future story can add a `--verbose` flag or a dedicated report command
to render it.
