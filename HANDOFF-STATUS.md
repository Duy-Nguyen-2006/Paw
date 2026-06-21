# Paw — HANDOFF-STATUS.md

**Phase A baseline audit** — generated 2026-06-21 (Asia/Ho_Chi_Minh)
**Repo:** github.com/Duy-Nguyen-2006/Paw · branch `main` · HEAD `346221f`
**Environment:** node v26.1.0, npm 11.16.0 (note: package.json `engines.node` = >=22.19.0)

> Scope of this baseline: clone + audit only. No source code was modified. All results below come from real commands run on the maintainer's machine.

## 0. Headline finding (reality vs harness self-report)

The Harness DB reports nearly every story `verify=pass` (1 failure), but the repository **does not pass its own required `npm run check` gate**:

- `tsgo --noEmit` (type-check): **FAIL** — 22 TypeScript errors (exit 2)
- `biome check --error-on-warnings`: **FAIL** — 64 errors + 39 warnings (exit 1)
- `npm run test:paw` (vitest): **PASS** — 675 tests / 78 files

Tests pass because vitest+tsx transpiles per-file without whole-program type-checking. The type errors are real and block `build`, `check`, and `test:release`. Closing this gap is prerequisite to any honest G-gate claim.

## 1. Gate status (actual)

| Gate | Status | Evidence |
|---|---|---|
| Tests (`test:paw`) | PASS | 78 files, 675 tests, ~37s |
| Static `check` (biome + tsgo) | FAIL | tsc 22 errors; biome 64 errors / 39 warnings |
| Guard scripts (pinned-deps / ts-imports / browser-smoke / shrinkwrap) | PASS | all exit 0 |
| Harness audit | WARN | entropy=5; 1 unverified story (US-011) |
| e2e with live provider | MISSING | `e2e=0` for all 86 stories; validations are fixture-only "without provider calls" |
| Provider wiring | NOT WIRED | PAW_PROVIDER_A_* env UNSET (key itself verified live) |
| gitnexus index | NOT INDEXED | Paw absent from registry; no index tool; backlog #1/#2 open |

## 2. Provider (MiniMax-M3 via TokenRouter)

- Endpoint `https://api.tokenrouter.com/v1`: `/models` -> 200 (`MiniMax-M3` present), `/chat/completions` -> 200. Key works.
- `paw-spec/config.yaml` already routes all tiers (cheap/mid/strong) to `MiniMax-M3` via provider `primary` (`base_url_env: PAW_PROVIDER_A_URL`, `api_key_env: PAW_PROVIDER_A_KEY`).
- Those env vars are UNSET -> runtime cannot reach the provider until exported (e.g. via a gitignored `.env`).
- The model returns `<think>...</think>` reasoning that consumes completion tokens (a 16-token probe was cut off at `finish_reason=length`). Token budgets, stop handling, and response parsing must tolerate thinking output. Prompt cache works (`cached_tokens` reported).
- SECURITY: the API key was shared in plaintext; rotate it after this work and never commit it.

## 3. Type-check errors (the 22 blockers)

- **`staleReason` missing** on 7 `*NotLockedResult` types (finalize, reviewer-blocked, reviewer-result, verifier-blocked, verifier-result, worker-blocked, worker-result commands). Largest cluster — contract/type drift between the not-locked result union and its consumers.
- **migrations.ts**: `readdirSync` not imported (TS2304) + 2 implicit-any params.
- **main-runtime-factory.ts:115**: `SettingsManager` imported as `type` but used as a value (TS1361).
- **model-selector-list.ts / tool-execution-render.ts**: `unknown` not satisfying `Api`/`TSchema` generic constraints (4 errors).
- **interactive-loaded-resources.ts:108**: object missing `render`/`invalidate` from `Component`.
- **build-command.ts:462**: union type too complex to represent (TS2590).
- **rollback-command.ts:516**: `toSorted` not in lib target (needs `lib` >= es2023) + 2 implicit-any.

## 4. Harness audit snapshot

- intake=110, story=86, decision=28, backlog=2, trace=87, tool=0, intervention=0
- audit: entropy_score=5, orphaned=0, unverifiedStories=1 (US-011 sandbox/secret policy verify=fail), staleStories=0, brokenTools=0
- Tool registry empty -> the AGENTS.md-required GitNexus impact-analysis (blast-radius) step has no registered provider (backlog #1 & #2). Code edits currently record "degraded" impact proof.

## 5. SonarQube

- Local config: `sonar.projectKey=pi-mono`, `sonar.host.url=http://localhost:9000`.
- The connected SonarQube MCP returns 0 projects -> it points at a different instance than local `localhost:9000`. Recent commits are a long series of `refactor(sonar): extract ... S3776 helpers` (cognitive-complexity cleanup), so Sonar work is active but not visible through the MCP.

## 6. Blockers (BLOCKED_* taxonomy)

- **BLOCKED_BUILD_FAILURE** — `npm run check` red (22 tsc + biome). Top priority.
- **BLOCKED_TOOL_PERMISSION** — gitnexus index for Paw unavailable via MCP; no local `gitnexus` CLI on PATH. Needs the external indexer to register `paw`.
- **BLOCKED_PROVIDER_UNAVAILABLE (config)** — provider env unset; fixable once `.env` is wired.

## 7. Recommended next phases

1. Fix `npm run check` to green (the 22 tsc errors + biome), smallest-diff per cluster; keep 675 tests green. Unblocks build/check/test:release.
2. Wire provider env via gitignored `.env` (PAW_PROVIDER_A_URL/KEY -> tokenrouter / MiniMax-M3); add a liveness smoke that skips when env is absent.
3. Add real e2e: at least one multi-slice loop against a real repo using the live provider, recorded as `e2e>=1` — the core G3->G4 gap.
4. 3-repo validation (G4): Paw + timetable + GLM-API + 1 more; record SHAs + outcomes.
5. Register gitnexus impact-analysis tool in the harness (closes backlog #1/#2).
6. Resolve US-011 verify=fail.

_No code was changed in Phase A._
