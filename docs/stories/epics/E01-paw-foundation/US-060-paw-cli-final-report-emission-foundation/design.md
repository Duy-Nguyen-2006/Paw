
# Design

## Command shape

```text
paw finalize <session-id> --summary <text> [--evidence <text>]...
```

## Flow

1. `parsePawFinalizeArgs` validates positional session id and required `--summary`.
2. `createPawFinalizeCommandResult` checks project and session state file.
3. `acquirePawSessionLock` — on live foreign lock, return `locked` without mutation.
4. `emitPawFinalReport` with `verifyDecisions: []` (status `done` per final-report).
5. `releasePawSessionLock` when current owner; map emission outcomes to CLI results.

## verifyDecisions

No verifier decision persistence exists for finalize; `createPawFinalReport`
accepts an empty `verifyDecisions` array. Do not invent synthetic unverified gates.

## Evidence default

When the caller supplies no `--evidence` values, pass
`["manual finalization requested"]` to `emitPawFinalReport`.
