
# Overview

## Current Behavior

US-027 existed in the Harness matrix as planned with no story packet. G0 spike
and policy evidence existed across Paw docs, product docs, story validation
files, and `paw-spec/config.yaml`, but there was no single exit evidence report
or threat model tying the G0 checklist together.

## Target Behavior

Paw has an explicit G0 evidence package:

- `paw-spec/docs/G0-EXIT-REPORT.md` maps each G0 checklist item to evidence.
- `paw-spec/docs/THREAT-MODEL.md` records threats, controls, implementation
  evidence, and future runtime enforcement gaps.
- `paw-spec/docs/CONFIG-FREEZE.md` freezes `paw-spec/config.yaml` defaults for
  P1 and forbids hardcoded model names.
- `paw-spec/docs/decisions/PHASE0-SPIKE-TRACKER.md` marks only evidence-backed
  G0 checklist items complete.
- `docs/TEST_MATRIX.md` records US-027 as a docs-only implemented slice.

## Affected Users

- Paw implementers entering P1.
- Reviewers checking whether G0 evidence supports P1 work.
- Future agents that need to distinguish completed policy evidence from future
  runtime enforcement.

## Affected Product Docs

- `docs/product/paw-overview.md`
- `docs/product/paw-runtime.md`
- `docs/product/paw-security.md`
- `paw-spec/README.md`
- `paw-spec/config.yaml`

## Non-Goals

- Implementing Paw runtime or CLI behavior.
- Running live provider, sandbox, or large-repo spike drills.
- Changing `paw-spec/config.yaml` values.
- Reopening Paw ADR decisions.
