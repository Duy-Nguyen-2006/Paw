
# Validation

## Proof Strategy

US-076 is complete when `paw build <session-id> --max-steps <n>` can safely run multiple existing one-step build transitions and stop on bounded, terminal outcomes without adding real provider execution or finalization.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Parser accepts `--max-steps`, rejects conflicting `--once`, missing values, zero, float, and nonnumeric values; loop formatter prints summary fields. |
| Integration | Temp-project bounded loop stops at max steps, completes at `no_pending_slices`, stops on default provider unavailable block, and preserves existing one-step coordinator, worker, reviewer, verifier, missing project/session, invalid state, no selected slice, and foreign lock coverage. |
| E2E | Existing `main(["paw","build",...])` route remains before agent runtime. |
| Platform | Temp-directory `.paw/` filesystem, locks, slice journals, session state, and verification evidence persistence. |
| Performance | Bounded by explicit positive integer max steps. |
| Logs/Audit | Structured stdout loop summary with steps run, max steps, stop reason, and final state. |

## Fixtures

- Runtime config copied from repository `paw-spec/config.yaml` into temporary test projects.
- Temporary `.paw/sessions/<id>/state.json`, `session.lock`, slice journals, and verification evidence files.
- Injected worker and reviewer outputs for pass paths, default fail-closed executor for provider-unavailable stop.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-build-command.test.ts
scripts/bin/harness-cli story verify US-076
npm run check
```

## Acceptance Evidence

- Focused build command tests pass.
- Harness story verification passes.
- Root repository check passes.
