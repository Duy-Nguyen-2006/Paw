# Paw P1 Config Freeze

## Decision

`paw-spec/config.yaml` version 1 is frozen as the P1 default runtime
configuration source.

For P1, runtime defaults must come from this config file or from user-provided
configuration layered on top of it. Code must not hardcode concrete provider
model IDs, budget values, context caps, retry counts, approval matrices,
sandbox defaults, verification gates, or retention defaults when those values
exist in `paw-spec/config.yaml`.

Model names are config data. Role routing resolves through stable role and tier
names, then through `model_tiers.*.model`. Concrete model IDs must not be
hardcoded in runtime code, tests that claim production defaults, or docs that
describe the executable default behavior.

## Frozen P1 Default Surface

| Config area | Frozen default source |
| --- | --- |
| Providers and model routing | `providers`, `model_tiers`, `role_routing`, `thinking` |
| Context discipline | `context`, `prompt_cache` |
| Budget policy | `budget` |
| Resilience and liveness | `resilience` |
| Complexity routing and classifier | `routing` |
| Approval and permission model | `approval` |
| Sandbox, secrets, and injection handling | `sandbox`, `secrets`, `injection` |
| Edit strategy | `edit` |
| Persistence and retention | `persistence` |
| Verification gates | `verify` |
| SLA and KPI targets | `sla`, `kpi` |

## Change Rule

P1 changes to these defaults must update `paw-spec/config.yaml` first. Any
supporting prose in `docs/product/*`, `paw-spec/docs/*`, story packets, or
validation notes must follow the config value. If prose conflicts with an ADR
or config value, the ADR or config wins as stated in `paw-spec/README.md`.

Changes that alter security posture, approval behavior, sandbox fallback,
secret handling, model routing semantics, verification gates, or persistence
retention require explicit story evidence. If the change reopens an accepted
architecture decision, update or supersede the relevant ADR rather than silently
changing the default.

## Review Notes

- The config keeps provider names and model tiers stable while allowing concrete
  model IDs to change as config data.
- Hosted failover and optional local model behavior are expressed in
  `model_tiers.failover_order`, not in code.
- The default network posture is `sandbox.network: default_deny` with explicit
  egress allowlist entries.
- Non-interactive approval policy fails closed by default.
- Prompt cache targets are advisory only and must not become CI gates.
- Verification gates under `verify.v1_gates` define intended v1 gate names;
  unavailable gates must be reported as unverified rather than falsely passing.

## P1 Entry Position

The config is frozen for P1 defaults, but runtime enforcement still has to load
and apply these values in the relevant CLI, orchestrator, provider, tool,
sandbox, verification, and reporting paths.
