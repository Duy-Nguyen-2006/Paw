# Test Matrix

This file maps product behavior to proof. Do not mark a row implemented until
tests, validation evidence, or docs-only acceptance evidence exist.

## Status Values

| Status | Meaning |
| --- | --- |
| planned | Accepted as intended behavior, not implemented |
| in_progress | Actively being built |
| implemented | Implemented and proof exists |
| changed | Contract changed after earlier implementation |
| retired | No longer part of the product contract |

## Matrix

| Story | Contract | Unit | Integration | E2E | Platform | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| US-001 | Paw Phase 0 contracts and foundation | yes | yes | no | no | implemented | Focused Paw contract test and root `npm run check` passed; see `docs/stories/epics/E01-paw-foundation/US-001-paw-phase0-contracts/validation.md`. |
| US-002 | Paw session state-machine foundation | yes | yes | no | no | implemented | Focused Paw state tests and root `npm run check` passed; see `docs/stories/epics/E01-paw-foundation/US-002-paw-session-state-machine/validation.md`. |
| US-003 | Paw init persistence foundation | yes | yes | no | yes | implemented | Focused Paw persistence tests and root `npm run check` passed; see `docs/stories/epics/E01-paw-foundation/US-003-paw-init-persistence/validation.md`. |
| US-004 | Paw session state persistence and locks | yes | yes | no | yes | implemented | Focused Paw session-store tests and root `npm run check` passed; see `docs/stories/epics/E01-paw-foundation/US-004-paw-session-locks/validation.md`. |
| US-005 | Paw runtime approval policy | yes | yes | no | no | implemented | Focused Paw approval-policy tests and root `npm run check` passed; see `docs/stories/epics/E01-paw-foundation/US-005-paw-approval-policy/validation.md`. |
| US-006 | Paw runtime budget policy | yes | yes | no | no | implemented | Focused Paw budget-policy tests and root `npm run check` passed; see `docs/stories/epics/E01-paw-foundation/US-006-paw-budget-policy/validation.md`. |
| US-007 | Paw classifier and risk scoring policy | yes | yes | no | no | implemented | Focused Paw risk-classifier tests and root `npm run check` passed; see `docs/stories/epics/E01-paw-foundation/US-007-paw-risk-classifier/validation.md`. |
| US-008 | Paw context budget policy | yes | yes | no | no | implemented | Focused Paw context-budget tests and root `npm run check` passed; see `docs/stories/epics/E01-paw-foundation/US-008-paw-context-budget/validation.md`. |
| US-009 | Paw resilience and liveness policy | yes | yes | no | no | implemented | Focused Paw resilience-policy tests and root `npm run check` passed; see `docs/stories/epics/E01-paw-foundation/US-009-paw-resilience-policy/validation.md`. |
| US-010 | Paw edit strategy policy | yes | yes | no | no | implemented | Focused Paw edit-policy tests and root `npm run check` passed; see `docs/stories/epics/E01-paw-foundation/US-010-paw-edit-policy/validation.md`. |
| US-011 | Paw sandbox and secret policy | yes | yes | no | no | implemented | Focused Paw security-policy tests and root `npm run check` passed; see `docs/stories/epics/E01-paw-foundation/US-011-paw-security-policy/validation.md`. |
| US-012 | Paw model routing policy | yes | yes | no | no | implemented | Focused Paw model-routing tests and root `npm run check` passed; see `docs/stories/epics/E01-paw-foundation/US-012-paw-model-routing/validation.md`. |
| US-013 | Paw slice journal persistence | yes | yes | no | yes | implemented | Focused Paw slice-journal tests and root `npm run check` passed; see `docs/stories/epics/E01-paw-foundation/US-013-paw-slice-journal/validation.md`. |
| US-014 | Paw artifact path persistence | yes | yes | no | yes | implemented | Focused Paw artifact tests and root `npm run check` passed; see `docs/stories/epics/E01-paw-foundation/US-014-paw-artifacts/validation.md`. |
| US-015 | Paw checkpoint metadata persistence | yes | yes | no | yes | implemented | Focused Paw checkpoint tests and root `npm run check` passed; see `docs/stories/epics/E01-paw-foundation/US-015-paw-checkpoints/validation.md`. |
| US-016 | Paw sub-agent response fallback | yes | yes | no | no | implemented | Focused Paw sub-agent response tests and root `npm run check` passed; see `docs/stories/epics/E01-paw-foundation/US-016-paw-subagent-response/validation.md`. |
| US-017 | Paw final report assembly | yes | yes | no | no | implemented | Focused Paw final report tests and root `npm run check` passed; see `docs/stories/epics/E01-paw-foundation/US-017-paw-final-report/validation.md`. |
| US-018 | Paw active-time clock policy | yes | yes | no | no | implemented | Focused Paw active-time tests and root `npm run check` passed; see `docs/stories/epics/E01-paw-foundation/US-018-paw-active-time/validation.md`. |
| US-019 | Paw planner slice queue validation | yes | yes | no | no | implemented | Focused Paw plan-slice tests and root `npm run check` passed; see `docs/stories/epics/E01-paw-foundation/US-019-paw-plan-slices/validation.md`. |
| US-020 | Paw retention cleanup planning | yes | yes | no | no | implemented | Focused Paw retention policy tests and root `npm run check` passed; see `docs/stories/epics/E01-paw-foundation/US-020-paw-retention-policy/validation.md`. |
| US-021 | Paw SubAgentRuntime foundation | yes | yes | no | no | implemented | Focused Paw sub-agent runtime tests and root `npm run check` passed; see `docs/stories/epics/E01-paw-foundation/US-021-paw-subagent-runtime/validation.md`. |
| US-022 | Paw S1 bounded sub-agent artifact isolation | yes | yes | no | yes | implemented | Focused Paw sub-agent artifact isolation tests and root `npm run check` passed; see `docs/stories/epics/E01-paw-foundation/US-022-paw-subagent-artifact-isolation/validation.md`. |
| US-023 | Paw S3 sandbox detection and fallback evidence | yes | yes | no | yes | implemented | Focused Paw sandbox detector tests and root `npm run check` passed; see `docs/stories/epics/E01-paw-foundation/US-023-paw-sandbox-detector/validation.md`. |
| US-024 | Paw S4 scout large-repo benchmark evaluator | yes | yes | no | yes | implemented | Focused Paw scout benchmark tests and root `npm run check` passed; see `docs/stories/epics/E01-paw-foundation/US-024-paw-scout-benchmark/validation.md`. |
| US-025 | Paw S5 provider resilience drill evaluator | yes | yes | no | yes | implemented | Focused Paw resilience drill tests and root `npm run check` passed; see `docs/stories/epics/E01-paw-foundation/US-025-paw-resilience-drill/validation.md`. |
| US-026 | Paw S2 cost latency cache evaluator | yes | yes | no | yes | implemented | Focused Paw cost latency cache tests and root `npm run check` passed; see `docs/stories/epics/E01-paw-foundation/US-026-paw-cost-latency-cache/validation.md`. |
| US-027 | Paw G0 exit evidence package | no | no | no | no | implemented | Docs-only G0 evidence package added; see `docs/stories/epics/E01-paw-foundation/US-027-paw-g0-exit-evidence/validation.md`, `paw-spec/docs/G0-EXIT-REPORT.md`, `paw-spec/docs/THREAT-MODEL.md`, and `paw-spec/docs/CONFIG-FREEZE.md`. |
| US-028 | Paw CLI init command routing | yes | yes | no | yes | implemented | Focused Paw init command test and root `npm run check` passed; see `docs/stories/epics/E01-paw-foundation/US-028-paw-cli-init-command-routing/validation.md`. Full Paw CLI and runtime orchestration remain future work. |
| US-029 | Paw CLI doctor sandbox report | yes | yes | no | yes | implemented | Focused Paw doctor command test and root `npm run check` passed; see `docs/stories/epics/E01-paw-foundation/US-029-paw-cli-doctor-sandbox-report/validation.md`. Full Paw CLI/runtime and full cross-distro sandbox validation remain future work. |
| US-030 | Paw CLI status read-only session summary | yes | yes | no | yes | implemented | Focused Paw status command test and root `npm run check` passed; see `docs/stories/epics/E01-paw-foundation/US-030-paw-cli-status-read-only-session-summary/validation.md`. Full Paw CLI/runtime orchestration remains future work. |
| US-031 | Paw CLI clean dry-run retention plan | yes | yes | no | yes | implemented | Focused Paw clean command test and root `npm run check` passed; see `docs/stories/epics/E01-paw-foundation/US-031-paw-cli-clean-dry-run-retention-plan/validation.md`. Destructive cleanup remains future work. |

## Evidence Rules

- Unit proof covers pure domain and application rules.
- Integration proof covers backend enforcement, data integrity, provider
  behavior, jobs, or service contracts.
- E2E proof covers user-visible browser flows.
- Platform proof covers only shell, deployment, mobile, desktop, or runtime
  behavior that cannot be proven in lower layers.
- A story can be implemented without every proof column if the story packet
  explains why.
