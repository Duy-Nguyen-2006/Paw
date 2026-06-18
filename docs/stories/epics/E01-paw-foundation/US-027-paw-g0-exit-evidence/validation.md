
# Validation

## Proof Strategy

This docs-only story is complete when the new G0 evidence docs exist, the spike
tracker and test matrix point at the evidence package, markdown links to local
files resolve, and no runtime completion is claimed beyond existing evidence.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Not applicable; no product code changes. |
| Integration | Not applicable; no runtime integration changes. |
| E2E | Not applicable; no user-visible runtime flow changes. |
| Platform | Not applicable; no shell/platform behavior changes. |
| Performance | Not applicable; no executable performance behavior changes. |
| Logs/Audit | Docs record G0 evidence, threat model, config freeze, and future runtime enforcement gaps. |

## Fixtures

- Existing Paw docs and spike evidence files.
- Existing Harness story matrix row for US-027.

## Commands

```text
scripts/bin/harness-cli story verify US-027
npm run check
```

## Acceptance Evidence

- Harness story verification passed with the configured lightweight docs
  evidence check: `scripts/bin/harness-cli story verify US-027`.
- Root check passed with no fixes applied: `npm run check`.
