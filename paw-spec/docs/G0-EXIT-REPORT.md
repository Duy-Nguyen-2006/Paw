
# Paw G0 Exit Report

## Scope

This report closes the Phase 0 Gate G0 evidence package for Paw. It verifies
that the G0 decision, spike, threat-model, and configuration artifacts exist and
are internally linked.

G0 exit is not a claim that the full Paw runtime or CLI is complete. Current
implementation evidence through US-026 covers policy modules, persistence
helpers, bounded artifact helpers, and deterministic spike evaluators. Live
provider execution, full CLI orchestration, live cross-distro sandbox execution,
and live large-repo benchmark runs remain future or manual validation where the
linked evidence says so.

## Checklist Evidence

| G0 checklist item | Status | Evidence |
| --- | --- | --- |
| All 21 ADRs accepted (`docs/decisions/ADR-01..21.md`) | Complete | `paw-spec/docs/decisions/ADR-01.md` through `paw-spec/docs/decisions/ADR-21.md` exist and each declares `Status: Accepted`. `paw-spec/README.md` identifies these ADRs as the pre-accepted Gate G0 architecture decision set. |
| All 5 spikes PASS or KILL with recorded evidence | Complete | `paw-spec/docs/decisions/PHASE0-SPIKE-TRACKER.md` lists S1 through S5 as PASS and links each evidence file. The evidence files are `paw-spec/docs/spikes/S1-subagent-runtime.md`, `paw-spec/docs/spikes/S2-cost-latency-cache.md`, `paw-spec/docs/spikes/S3-sandbox.md`, `paw-spec/docs/spikes/S4-scout-large-repo.md`, and `paw-spec/docs/spikes/S5-resilience-drill.md`. |
| MVP DoD written | Complete | `paw-spec/README.md` defines the v1 Definition of Done. `docs/product/paw-overview.md` repeats the runtime-facing Paw v1 DoD: approved SPEC and plan, completed slices, reviewer pass, applicable verification gates, and final report disclosure of evidence, risks, unverified gates, and degraded execution. |
| KPIs written | Complete | `paw-spec/config.yaml` defines SLA and KPI defaults under `sla` and `kpi`, including PR hard gates and advisory-only metrics. |
| Gitignore and persistence policy written | Complete | `paw-spec/config.yaml` defines persistence defaults under `persistence`, including atomic writes, lock TTL, retention, and `.paw/.gitignore` commit/ignore policy. `docs/product/paw-runtime.md` describes the persistence contract and volatile `.paw/` paths. |
| Threat model written | Complete | `paw-spec/docs/THREAT-MODEL.md` records assets, trust boundaries, threats, controls, implemented policy evidence, and future runtime enforcement gaps. |
| `config.yaml` defaults reviewed and frozen for P1 | Complete | `paw-spec/docs/CONFIG-FREEZE.md` freezes `paw-spec/config.yaml` version 1 as the P1 default source and states that defaults come from config, including model names. |

## Spike Evidence Position

| Spike | Result | Evidence position | Runtime limit still open |
| --- | --- | --- | --- |
| S1 SubAgentRuntime | PASS | Interface-level sub-agent runtime and bounded artifact helper evidence. | Real provider invocation and child-process execution remain future work. |
| S2 Cost/latency + cache | PASS | Deterministic injected metrics evaluator evidence for cost, token, active-time, and cache advisory outcomes. | Live HIGH-RISK task execution remains future/manual validation. |
| S3 Sandbox | PASS | Injected fallback-matrix evidence for sandbox primitive detection and no-sandbox R1 blocking through policy evaluation. | Live cross-distro sandbox execution remains future/manual validation. |
| S4 Scout large repo | PASS | Deterministic injected benchmark evaluator evidence for repo-size, timing, token, cache, ripgrep, ctags, and git measurements. | Live 100k-file monorepo execution remains future/manual validation. |
| S5 Resilience drill | PASS | Deterministic injected drill evaluator evidence for failover, degraded flag, resume, final report, and no-data-loss confirmation. | Live provider chaos execution remains future/manual validation. |

## Acceptance Statement

Gate G0 documentation and control-plane evidence are complete for entering P1
contract-freeze work. P1 must continue to treat `paw-spec/config.yaml`,
`paw-spec/docs/decisions/ADR-01.md` through `ADR-21.md`, and the Paw product
docs as the source of truth. Runtime and CLI work must not cite this report as
proof that enforcement exists unless the linked story validation includes that
specific enforcement.
