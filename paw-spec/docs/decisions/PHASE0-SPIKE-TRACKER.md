
# Paw v0.4 — Phase 0 Spike Tracker (kill-criteria gates)

Use this to record P0 spike outcomes before Gate G0 closes. A spike must end in PASS or KILL with
evidence; no spike stays "in progress" past P0 (SPEC §21).

| Spike | Question it answers | Kill-criteria (abandon/redesign if...) | Owner | Result | Evidence link |
|-------|---------------------|----------------------------------------|-------|--------|---------------|
| S1 SubAgentRuntime | Can we delegate to a child agent with bounded-artifact isolation behind our own interface? | Cannot isolate context / handoff exceeds caps reliably | BE2 | PASS | [S1 spike evidence](../spikes/S1-subagent-runtime.md) |
| S2 Cost/latency + cache | Does a real HIGH-RISK task fit the $3.00 / 1.2M-token cap and meet active-time SLA? | >150% of cap or >2x SLA with no clear fix | BE1 | PASS | [S2 spike evidence](../spikes/S2-cost-latency-cache.md) |
| S3 Sandbox | Does bwrap+Landlock work across Ubuntu/Debian/Fedora/Arch, and does the userns-off fallback force read-only safely? | No portable sandbox AND no safe fallback | SEC | PASS | [S3 spike evidence](../spikes/S3-sandbox.md) |
| S4 Scout on large repo | Does ripgrep+ctags+git stay within budget on a 100k-file monorepo? | Exceeds SLA/budget with no caching fix | BE1 | PASS | [S4 spike evidence](../spikes/S4-scout-large-repo.md) |
| S5 Resilience drill | Kill the provider mid-task → does failover+resume complete with no data loss and a degraded flag? | Any data loss / stall / silent degradation | TL | PASS | [S5 spike evidence](../spikes/S5-resilience-drill.md) |

## G0 exit checklist
- [x] All 21 ADRs accepted (`docs/decisions/ADR-01..21.md`)
- [x] All 5 spikes PASS or KILL with recorded evidence
- [x] MVP DoD, KPIs, gitignore/persistence policy, and threat model written
- [x] `config.yaml` defaults reviewed and frozen for P1
