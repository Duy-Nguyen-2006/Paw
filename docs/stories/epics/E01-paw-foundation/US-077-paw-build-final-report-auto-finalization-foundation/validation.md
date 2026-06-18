
# Validation

## Proof Strategy

US-077 is complete when a bounded build loop that exhausts all pending slices emits final report artifacts, advances to `FINAL_REPORT`, and preserves verifier decision disclosure without changing non-terminal loop stops.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Loop formatting includes final-report metadata when auto-finalization succeeds. |
| Integration | Temp-project full bounded loop reaches `FINAL_REPORT`, writes `summary.md` and `report.json`, preserves unverified verifier gates, while max-step and provider-unavailable stops do not finalize. |
| E2E | Existing `main(["paw","build",...])` route remains before agent runtime. |
| Platform | Temp-directory `.paw/` filesystem, locks, session state, final report artifacts, and verification evidence persistence. |
| Performance | Bounded by explicit positive integer max steps. |
| Logs/Audit | Structured stdout loop summary includes final-report status and artifact paths. |

## Fixtures

- Runtime config copied from repository `paw-spec/config.yaml` into temporary test projects.
- Temporary `.paw/sessions/<id>/state.json`, `session.lock`, slice journals, verification evidence, `summary.md`, and `report.json` files.
- Injected worker and reviewer outputs for pass paths, default fail-closed executor for provider-unavailable stop.

## Commands

```text
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-build-command.test.ts
scripts/bin/harness-cli story verify US-077
npm run check
```

## Acceptance Evidence

- Focused build command tests pass.
- Harness story verification passes.
- Root repository check passes.
