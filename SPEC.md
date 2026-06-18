
# Paw — SPEC.md v0.4 (Definitive Build Spec — FINAL)

> **Status:** FINAL / build-ready. This is the single source of truth for the v1 (MVP) build.
> **Supersedes:** v0.1 (vision), v0.2 (buildable spec), v0.3 (efficiency/reliability spec).
> **What v0.4 closes:** every open choice from prior reviews is now a *decision*, not an option.
> It adds the missing **orchestration semantics** (multi-slice loop, task boundary, eval scoring oracle),
> a complete **Non-Interactive / CI policy**, **per-class budgets**, a **sandbox fallback matrix**,
> **failover-degradation honesty**, **stale-lock recovery**, and a concrete **timeline + headcount + critical path**.
> **Rule of precedence:** if any prose conflicts with a `[DECIDED]` ADR or a config block, the ADR/config wins.

---

## 0. How to read this document (and the prime directive)

Every capability is tagged: `[V1]` = MVP build now · `[V2]` = next · `[LATER]` = North Star.
Sections are strictly numbered in reading order (no out-of-order emphasis blocks).

**Prime directive for the team:** Build the smallest vertical slice that proves value, with hard guarantees on
**cost, liveness, safety, and resumability**. Cut *scope*, never *quality*. When a number below looks arbitrary,
it is a **starting default** that the eval harness (§19) will tune — but it must be **adaptive by class/model/provider**, never a flat global constant.

---

## 1. The Four Tenets and their non-negotiable resolutions

| Tenet | Wrong approach | v0.4 resolution (DECIDED) |
|---|---|---|
| **T1 — Token-frugal** | Blind truncation | Precision retrieval (ranked `file:line` spans) + bounded handoffs + provider prompt-caching (advisory) + diff-first writes |
| **T2 — Stay smart** | Stuff everything in | Curated/ranked context (short > noisy long) + persistent project facts + extended thinking only where it pays |
| **T3 — Fast** | One big model, one long chain | Per-role model tiers (cheap→strong) + parallel **read-plane** + caching + deterministic checks off the LLM path |
| **T4 — Never stalls** | Hope it finishes | Durable resumable state machine + timeout/retry/failover on every external call + loop caps + **liveness invariant** |

**T1↔T2 reconciliation:** accuracy degrades with long noisy context ("lost in the middle"); precise retrieval is *both* cheaper *and* smarter.
**T3↔T4 reconciliation:** speed comes from a parallel **read plane**; safety/liveness comes from a serial, durable **write plane**. Keep the planes separate.
**T2↔T4 honesty (NEW in v0.4):** when liveness forces a **failover to a lower model tier**, output may degrade. This is allowed, but it must be **labeled `degraded: true`** in the final report — never silent (§9.5).

---

## 2. Product Vision & Positioning (reconciled)

**Positioning (single, consistent message):** *"Paw — senior-engineer discipline for builders."*
Paw turns fuzzy intent into maintainable, production-grade software via: understand-before-change, adaptive
clarification, SPEC+plan before edits, context-isolated sub-agents, anti-overengineering, design quality,
real-behavior verification, and durable project memory.

**Users (DECIDED):**
- **P1 (primary, v1):** semi-technical builders & junior developers.
- **P2 (secondary, served by UX adaptation, not feature removal):** non-technical builders, via *Guided Mode* (plain-language prompts, "use best defaults" everywhere).
- The North Star "anyone can build production software" remains the destination; v1 is the vertical slice toward it.
> Marketing and SPEC now agree: we do **not** claim "non-technical first" in v1; we claim "discipline for builders, friendly to non-technical via Guided Mode."

---

## 3. Architecture Decision Records (all `[DECIDED]`; hard gate before Phase 1)

Each ADR must be written to `docs/decisions/ADR-NN.md` (context, decision, consequences, revisit-trigger, date) and accepted in Phase 0.

| ADR | Decision (v1) | Rationale | Revisit trigger |
|---|---|---|---|
| ADR-1 SubAgent runtime | Implement our own thin `SubAgentRuntime` interface; borrow **concepts only** from pi-subagents (**no runtime dependency**) | Avoid lock-in to a young single-maintainer pkg | We need delegation features beyond our interface |
| ADR-2 Language | TypeScript-only for v1 (Node.js LTS, pnpm). Rust `[LATER]` for indexing | Fast iteration, MCP/Node ecosystem | Measured indexing bottleneck |
| ADR-3 SonarQube | Optional opt-in plugin. Default static analysis = `tsc` + ESLint + Semgrep (+ ruff for Python) | Heavy server can't be a default | Org/CI demand |
| ADR-4 Browser verify | `BrowserVerifier` abstraction; default **Playwright (bundled Chromium)**; MCP is one adapter. `[V2]` | Robust headless Linux, no lock-in | A stable superior MCP emerges |
| ADR-5 Memory storage | Versioned YAML + file locks (v1); SQLite `[LATER]` | Human-readable, git-diffable | Concurrency/scale exceeds locks |
| ADR-6 Providers | `ModelProvider` abstraction; ship **2 hosted adapters + 1 local (Ollama)**; no plugin marketplace v1 | Abstraction now, market later | Third-party provider demand |
| ADR-7 Deploy connectors | `[LATER]`; v1 stops at local build + report | De-risk core | Core stable + demand |
| ADR-8 Default approval | **`balanced`**: product always asked (plain-language); engineering auto unless risk ≥ R3 | strict + non-tech = rubber-stamp | Enterprise mode may default strict |
| ADR-9 Design reference catalog | Small **static curated** catalog; no scraping/cloning | Bounded, legally safe | Needs its own service |
| ADR-10 Cost control | **Hard per-class token+USD budget with confirm-to-continue (interactive) / fail-closed (non-interactive)** | Tracking ≠ protection | Org-level quotas |
| ADR-11 Graph/embeddings | Deferred `[V2]+`; v1 scout = ripgrep + ctags + git | Graph is a product in itself | Proven large-repo latency |
| ADR-12 Target project | Web app + generic Node/TS/Python; non-web gates degrade gracefully | Focus | Mobile/embedded demand |
| ADR-13 Context discipline | Working context **adaptive-capped per model/class**; precision retrieval over dumping; prompt-caching used when available (**advisory metric, not a gate**) | Cheaper AND smarter | — |
| ADR-14 Model routing | Per-role tiers (cheap→mid→strong); extended thinking gated to high-risk + planner/reviewer | Speed + cost without dumbing core reasoning | Tier benchmarks shift |
| ADR-15 Liveness | Durable state machine; every external call has timeout+retry+failover; loop caps; **no silent waits** | Must never hang/be-killed mid-task | — |
| **ADR-16 Task boundary (NEW)** | **A "task" = one user intent = one SPEC = one session, from INTAKE to FINAL_REPORT, possibly spanning multiple slices and multiple `paw` commands (which resume the same session).** All budgets/SLAs/KPIs are **per task** unless explicitly per-slice | Removes the biggest measurement ambiguity | — |
| **ADR-17 Non-interactive policy (NEW)** | In `print`/`json`/CI/daemon modes, any gate needing a human → **fail-closed** (`BLOCKED_*`, non-zero exit). Pre-authorization only via explicit flags up to **R2**; R3–R6 require explicit `--allow`; **R7 can NEVER be auto-approved** | Resolves liveness ↔ R7 ↔ confirm contradiction | — |
| **ADR-18 Sandbox stack (NEW)** | Primary = **bubblewrap (bwrap) + Landlock** where available; ordered fallback (§14.2). If no sandbox → **refuse R≥1 (force read-only)** unless `--no-sandbox-i-understand` | Portable across Ubuntu/Debian/Fedora/Arch; safe-by-default | Stable better primitive |
| **ADR-19 Multi-slice execution (NEW)** | Planner emits an ordered slice list; orchestrator **loops** `IMPLEMENTING→REVIEWING→VERIFYING` per slice with a per-slice sub-budget and per-slice checkpoint | Plans are multi-slice; v0.3 had no loop | — |
| **ADR-20 Eval scoring oracle (NEW)** | Every benchmark `(repo, task)` ships a **deterministic scoring harness** (golden tests + acceptance script + golden-diff). CI uses **record/replay** fixtures; live-model eval runs **nightly** with pinned snapshots | Makes KPIs actually measurable & CI non-flaky | — |
| **ADR-21 Edit strategy (NEW)** | **Diff-first**: apply patch; on failure, fuzzy-apply (≤2 retries); then **full-file rewrite for files ≤ 400 lines**; else `BLOCKED`. Every applied change recorded in a slice journal with content hashes for idempotency | "never reprint file" was too absolute | — |

> **Gate G0:** All 21 ADRs accepted before any Phase-1 production code.

---

## 4. UX model & the approval split (DECIDED)

- **Adaptive interview** (replaces v0.1's fixed "30"): default **3–8 questions**, scales with Risk Score (§7), hard cap **20**. "Use best defaults for the rest" is always offered and **records explicit assumptions** into the SPEC.
- **Approval split:**
  - *Product decisions* (what/who/why, scope, non-goals, success) → **user**, in plain language.
  - *Engineering decisions* (how) → **policy/rules engine**, auto unless risk ≥ R3.
  - Every escalation states: **what** / **why-risky** / **consequence-of-saying-no** / **recommended choice**.
- **Guided Mode (P2):** same engine, simpler vocabulary, more "recommended default" pre-selections, no jargon in prompts.

---

## 5. v1 Scope — the MVP Vertical Slice

```text
paw → INTAKE → CLASSIFY → CLARIFY(3–8) → SPEC.md(+Plain-Language Summary) + product approval
    → SCOUT(ripgrep/ctags/git, R0) → PLAN(ordered vertical slices)
    → [for each slice]:  WORKER(atomic, checkpoint) → REVIEWER(diff+behavior) → VERIFY(tsc/eslint/test/build)
    → FINAL REPORT (evidence + risks + unverified + degraded?)
```

**IN v1:**
- CLI: `paw`, `init`, `spec`, `plan`, `build`, `verify`, `status`, `rollback`, `resume`, `report`, `doctor`, `clean`.
- Modes: `interactive`, `print (-p)`, `json (--json)`. (`daemon` = `[LATER]`.)
- 4 sub-agents: scout / planner / worker / reviewer.
- 1–2 hosted providers + optional local, via `ModelProvider` abstraction.
- **Efficiency & Reliability Engine (§8)**, **Multi-slice orchestration (§6)**, **Non-Interactive policy (§9.6)**.
- `.paw/` persistence + locks + atomic writes + gitignore + migration (§12).
- Shadow-worktree checkpoint/rollback (§13).
- Runtime security + sandbox + secret redaction (§11).
- Eval harness + KPIs + scoring oracle (§19).

**NOT in v1** (deferred): oracle, ponytail/architecture/design/security reviewers, browser-verifier, sonar-reviewer, memory-curator, deploy-verifier; graph/embeddings; SonarQube & browser gates (opt-in `[V2]`); provider marketplace; Rust; SQLite memory; deploy connectors; daemon/RPC.
> Security itself is **not** deferred — only the separate *security-reviewer agent* is. Runtime sandboxing/gating/redaction are all `[V1]`.

**MVP Definition of Done:** runs the full slice on **3 real repos** (Next.js web app, FastAPI service, Node CLI) without corruption; meets §19 KPIs; passes §20 checklist.

---

## 6. Runtime: Task boundary, Complexity routing, Multi-slice loop `[V1]`

### 6.1 Task boundary (ADR-16)
- One **task** = one user intent = one `SPEC.md` = one **session id**.
- A task may span multiple **slices** and multiple CLI invocations; later `paw build`/`paw verify` **resume the same session**, not new tasks.
- **All budgets, SLAs, and KPIs are per-task**, with **per-slice sub-budgets** (§8.6).

### 6.2 Complexity routing
| Class | Pipeline | Clarify Q | Reasoning tier |
|---|---|---|---|
| trivial | worker → verify | 0–2 | cheap; no extended thinking; **still runs verify + R-gating** |
| standard | scout → plan → (slice loop) → verify | 3–8 | thinking on planner only |
| high-risk | standard + approvals (+ `[V2]` reviewers) | ≤ ~20 | thinking on planner + reviewer |

> **Classifier safety rule (DECIDED):** the classifier is **conservatively biased** — when in doubt it picks the higher class. `trivial` is only chosen when: ≤1 file, no cross-layer, no R≥3, no security path. Misclassification false-negative rate is a tracked KPI.

### 6.3 State machine (persisted, resumable, multi-slice — ADR-19)
```text
IDLE → INTAKE → CLASSIFYING → CLARIFYING → SPEC_DRAFTED → SPEC_APPROVED → SCOUTING
    → PLAN_DRAFTED → PLAN_APPROVED → SLICE_SELECT
        → IMPLEMENTING → REVIEWING → VERIFYING → SLICE_DONE
            → (more slices? → SLICE_SELECT)  (none left? → FINAL_REPORT)
    → FINAL_REPORT → IDLE

BLOCKED_{NEEDS_USER_DECISION, BUDGET_EXCEEDED, TEST_FAILURE, BUILD_FAILURE,
         TOOL_PERMISSION, CONTEXT_MISSING, PROVIDER_UNAVAILABLE, SANDBOX_UNAVAILABLE,
         PATCH_APPLY_FAILED}
```
- `SLICE_SELECT` pops the next slice from the planner's ordered list and allocates its sub-budget.
- A failed slice → `BLOCKED_*` with the offending slice id; `paw resume` continues from that slice (completed slices are not redone — idempotency §8.5).

---

## 7. Risk scoring & permission model (runtime-enforced) `[V1]`

- **Risk Score inputs:** #files, cross-layer, security paths (auth/payment/secrets), new dependency, schema/DB change, destructive command, infra/deploy.
- **Tool risk levels (enforced at the tool runtime, NOT via prompt):**
  `R0` read · `R1` safe write · `R2` build/test · `R3` dep install · `R4` migration · `R5` deploy · `R6` destructive FS · `R7` secrets/auth/payment.
- **Approval matrix (default `balanced`, ADR-8):**
  - R0–R2 → auto.
  - R3–R6 → require approval (interactive) / explicit `--allow` (non-interactive).
  - **R7 → ALWAYS require explicit human approval; can NEVER be auto-approved, in any mode (runtime invariant).**

---

## 8. Efficiency & Reliability Engine `[V1]`

### 8.1 Token frugality (T1)
**Adaptive context budget (ADR-13 — per model & class, not flat):**
```yaml
context:
  # window target = min(model_context_limit * 0.5, class_cap)
  class_cap_tokens:        { trivial: 16000, standard: 48000, high_risk: 96000 }
  subagent_handoff_max_tokens:
                           { scout: 4000, planner: 3000, worker: 2000, reviewer: 2500 }  # was a flat 2000
  tool_output_max_tokens:  1500      # stdout/logs truncated head+tail beyond this
  file_read_max_bytes:     262144    # >256KB or binary => metadata only, never inline
  drilldown:               by_artifact_ref
```
- **Precision retrieval (key lever):** scout returns **ranked `file:line-span` references + 1-line rationale**, never whole files. Worker/reviewer read only needed spans (+small symbol window via ctags/AST), on demand.
- **Pre-injection guard:** rejects oversized/raw blobs (full-repo dumps, full logs, base64 screenshots) before they enter context.
- **Diff-first writes & structured I/O:** edits use patch format (ADR-21); sub-agent outputs are JSON (schema-constrained / function-call).
- **Dedup & caching:** scout output cached by **git-tree hash**; ctags/symbol index under `.paw/cache/` invalidated by mtime/diff; rolling **session summary** replaces raw transcript in context (raw stays on disk).
- **Handoff recall guard (NEW):** if a sub-agent's bounded handoff would drop refs the planner marked "required," it **escalates with a `drilldown` pointer** rather than silently truncating. Recall of required spans is a KPI.

### 8.2 Provider prompt caching — advisory, not a gate (ADR-13, corrected)
- Assemble context **most-stable-first** so provider prefix caches hit: `[system policy] → [project facts/rules] → [SPEC summary] → [task-volatile]`.
- **Cache support is provider-specific** and the metric is **advisory** (dashboard only, never a CI gate):

| Provider class | Caching mechanism | Min cacheable prefix | KPI applicability |
|---|---|---|---|
| Hosted A (auto-cache) | automatic prefix cache | ~1024 input tokens | tracked, advisory |
| Hosted B (explicit) | explicit cache markers + TTL (~5 min) | ~1024 (large), ~2048 (small models) | tracked, advisory |
| Local (Ollama/llama.cpp) | engine-level **KV-cache reuse** (not billing-level) | n/a | **N/A — excluded from cache KPI** |

> Target ">70% input from cache" is a **goal for multi-turn hosted tasks only**, surfaced on the dashboard. It is **not** a build-blocking check (resolves the v0.3 CI-coupling and local-model contradictions).

### 8.3 Intelligence preservation (T2)
- **Right context > more context:** rank by relevance; actively exclude irrelevant files.
- **Persistent project facts** (`.paw/memory`, `.paw/rules`) injected as the stable prefix so the model never re-derives architecture/conventions (saves tokens AND keeps decisions consistent).
- **Reasoning where it pays (ADR-14):** extended thinking only for high-risk tasks and planner/reviewer roles. Trivial skips it.
- **Hard-step pattern (with quality guard):** cheap model **drafts**, strong model **verifies the delta**. **If the cheap draft's self-confidence is low OR the strong verifier disagrees, escalate to a full strong pass** (prevents silent quality loss).
- **Anti-context-rot:** eviction order = runtime evidence (L7), then session detail (L8); **never evict L0–L3** (policy/intent/SPEC/plan). Sub-agents get only their relevant slice.

### 8.4 Speed (T3)
**Model routing tiers (ADR-14; names are config, never hardcoded):**
| Role / step | Tier | Why |
|---|---|---|
| classify, extract, format, schema-validate, summarize | cheap/fast | mechanical, high-volume |
| scout ranking, simple worker edits | mid | balance |
| planner, reviewer, high-risk worker | strong (+thinking) | hard reasoning |
- **Two execution planes:**
  - **Read plane (parallel, fast):** scout shards, read-only reviewers, deterministic checks run concurrently against a **fixed snapshot** (§13.3 — captures the *working tree incl. uncommitted changes*, not bare HEAD).
  - **Write plane (serial, durable):** worker writes one slice at a time under a lock. **No parallel edits in v1.**
- **Off-LLM fast paths:** tsc/eslint/ripgrep/tests run as native processes in parallel; results summarized to ≤1.5k tokens; the LLM never reads raw output. Trivial fast-path skips scout/plan/reviewer (still verifies). Warm provider connections + cached prefix → lower TTFT.

### 8.5 Idempotency & resumability (ADR-21)
- Every state transition persisted **atomically** (write-temp-rename) to `.paw/sessions/<id>/state.json`.
- Each slice has a **journal** recording applied changes with **content hashes**. Before applying a change, the worker **compares the current file hash**: if the change is already present → **no-op**; if the base changed unexpectedly → re-derive the patch or `BLOCKED_PATCH_APPLY_FAILED`.
- Completed slices are **never redone** on resume. Ctrl-C mid-write never yields a half-written file (atomic writes everywhere).

### 8.6 Budgets — per class & per slice (ADR-10, ADR-16) — NOT flat
```yaml
budget:
  per_task:
    trivial:   { max_usd: 0.10, max_tokens: 40000,  warn_at_pct: 70 }
    standard:  { max_usd: 0.75, max_tokens: 250000, warn_at_pct: 70 }
    high_risk: { max_usd: 3.00, max_tokens: 1200000, warn_at_pct: 60 }
  per_slice:                                   # multi-slice guard (ADR-19)
    soft_fraction_of_task: 0.4                 # one slice shouldn't silently eat the whole task budget
  on_exceed:
    interactive:     confirm                   # ask user to continue
    non_interactive: abort                     # fail-closed (ADR-17)
```

### 8.7 Liveness invariant (T4, ADR-15) — enforced in the orchestrator
> **Every step must do exactly one of: (a) advance the state machine, (b) enter a `BLOCKED_*` state with a human-readable reason + suggested action, or (c) escalate to the user. A step may NEVER silently wait, spin, or exit without a terminal/blocked state.**

```yaml
resilience:
  llm_call:  { timeout_sec: 60,  retries: 3, backoff: exponential_jitter, on_5xx_or_429: failover_model }
  tool_call: { timeout_sec: 120, kill_on_timeout: true }
  subagent:  { wall_clock_sec: 180, on_timeout: blocked }
  loop_caps: { max_subagent_iterations: 6 }    # planner↔reviewer disagreement → escalate w/ both positions
```
- Provider 429/5xx → retry w/ jitter → **failover to secondary provider/model** → if all fail → `BLOCKED_PROVIDER_UNAVAILABLE` (resumable), never crash.
- Hung subprocess → watchdog kills at timeout; partial output discarded safely.
- **Active-time clock (MISS-3 fix):** the SLA clock measures **agent active machine time only**; it **pauses** while in any `BLOCKED_NEEDS_USER_DECISION`/approval-wait state, so human think-time never counts against latency SLAs.

---

## 9. Reliability behaviors that were previously under-specified `[V1]`

### 9.1 Degradeable gates
A gate that can't run → `Not verified: <reason>`; task ends `done_with_unverified[...]`, never an infinite wait or false "done."

### 9.2 Patch-apply fallback (ADR-21)
diff → fuzzy-apply (≤2) → full-file rewrite (files ≤400 lines) → `BLOCKED_PATCH_APPLY_FAILED` with the failing hunk. No silent corruption.

### 9.3 Stale-lock recovery (NEW)
Locks store `{pid, host, heartbeat_ts, ttl}`. A lock whose **PID is dead** or whose **heartbeat expired (> ttl, default 120s)** is **auto-reclaimed** with a logged warning. The 2nd instance never waits forever (liveness).

### 9.4 Provider failover honesty (MISS-6 fix)
Any failover to a **lower tier** sets `degraded: true` on the affected step; the FINAL REPORT lists which steps ran degraded and recommends a re-run on the primary tier. Failover is **never silent**.

### 9.5 Read-snapshot vs dirty working tree (MISS-5 fix)
The read-plane "fixed snapshot" is built by capturing the **current working tree including uncommitted changes** into the shadow worktree (§13.3) — scout/reviewer therefore analyze **what is actually on disk**, not bare `HEAD`.

### 9.6 Non-Interactive / CI Policy (ADR-17) — the contradiction killer

| Gate / event | `interactive` | `print` / `json` / CI | `daemon` `[LATER]` |
|---|---|---|---|
| Product approval (SPEC) | prompt user | **fail-closed** → `BLOCKED_NEEDS_USER_DECISION`, exit≠0, emit SPEC for review | RPC callback or fail-closed |
| Engineering R3–R6 | prompt | allowed **only** if `--allow R3[,R4…]` passed, else fail-closed | RPC or fail-closed |
| **R7 (secrets/auth/payment)** | prompt | **ALWAYS fail-closed — no flag can pre-authorize** | **ALWAYS fail-closed** |
| Budget exceeded | confirm-to-continue | **abort** (or block if `--budget-on-exceed=block`) | abort |
| planner↔reviewer ≥6 iters | escalate to user | **fail-closed** with both positions in the report | RPC or fail-closed |
| Provider all-down | block + retry | `BLOCKED_PROVIDER_UNAVAILABLE`, exit≠0, resumable | block |

**Flags:** `--yes-to R0-R2` (cap; cannot exceed R2), `--allow R3,R4` (explicit per-level), `--max-usd <n>`, `--budget-on-exceed=abort|block`, `--read-only`.
**Invariant:** in non-interactive modes the agent **always terminates** in `done` / `done_with_unverified` / `BLOCKED_*` (with a non-zero exit code for blocked) — it **never hangs and never auto-approves R7**.

---

## 10. Adaptive interview & SPEC.md format `[V1]`

- **Core questions (always 3–6):** problem, primary user, success outcome, scope, non-goals, definition-of-done.
- **Conditional banks** chosen by task type (UI / backend / refactor / bugfix). Each Q: reason + 3–6 options + custom + "suggest default."
- **`SPEC.md` structure:**
  `## 0. Plain-Language Summary` (the part the user approves) → Summary → User/Problem/Outcome → Scope/Non-Goals → User Journey (happy + failure) → UX states (empty/loading/error) → Design Direction (UI) → Data → API (req/resp/errors/idempotency/pagination) → Security → **Accessibility (see §10.1)** → Performance/SLA → Architecture Constraints → Risks → **measurable Acceptance Criteria** → Verification Plan (which gates apply / won't run + why) → **Assumptions Made** → Open Questions → Approvals.
- Vague terms (fast/simple/secure/optimized) must be **quantified or flagged**.

### 10.1 Accessibility honesty (small fix)
WCAG 2.1 AA verification needs the design/browser gates, which are `[V2]`. Therefore in **v1**: the SPEC **records** a11y requirements and runs a **lightweight deterministic a11y lint** (alt text, label-for, contrast on static CSS) where possible, but full AA is explicitly marked **`not verified in v1`** in the report. Full AA verification ships with the `[V2]` design engine (§17).

---

## 11. Security (runtime-enforced) `[V1]`

- **Sandbox (ADR-18):** shell/tools run inside **bubblewrap + Landlock** (where available) with a **repo-scoped FS allowlist** and **network default-deny** except an **egress allowlist** (configured provider hosts + package registries + `localhost` for local models). The string denylist (`rm -rf`, `sudo`, `curl|sh`, `git reset --hard`) is a **secondary** layer only (string matching is bypassable).
- **Runtime gating:** a tool above the allowed risk level **cannot execute** regardless of model output; `--read-only` blocks writes at the runtime, not via prompt.
- **Secret handling (defense in depth, MISS/SC fix):**
  1. **Primary — don't read:** scout/read-plane **exclude** `.env*`, `**/secrets/**`, key files from the read allowlist by default.
  2. **Secondary — redact at the I/O *write* layer:** `.env` values, API keys, tokens, cookies, auth headers, private keys are redacted when written to artifacts/logs (not only on display). Redaction is best-effort and combined with (1); high-entropy strings flagged.
  3. Volatile `.paw/` dirs are gitignored (§12).
- **Prompt injection:** untrusted content (web/README/issues/comments/logs/browser) is processed **only by read-only sub-agents** whose output is a **structured summary, never executable instructions**; the model cannot self-escalate tool risk. **Red-team test required** (KPI, 100% block).

---

## 12. Persistence: `.paw/` `[V1]`
```text
.paw/
  config.yaml | version
  sessions/<id>/{transcript.jsonl, summary.md, state.json, slice-journal.jsonl, session.lock}
  artifacts/<UTC>-<slug>-<shortid>/...        # scout/planner/worker/reviewer reports, screenshots
  memory/{memories,pending,rejected}.yaml
  rules/{project,design,security,architecture}-rules.yaml
  decisions/ADR-*.md
  cache/{repo-index,ctags,scout}/
  logs/
  .gitignore                                  # written by `paw init`
```
- **Commit:** `config.yaml`, `version`, `memory/memories.yaml`, `rules/`, `decisions/`.
- **Gitignore:** `sessions/`, `artifacts/`, `cache/`, `logs/`, `memory/{pending,rejected}.yaml`.
- **Concurrency:** repo + memory locks (§9.3 stale-lock recovery); 2nd instance runs read-only with a warning or waits up to ttl, never silent concurrent writes.
- **Atomicity / migration:** write-temp-rename everywhere; `.paw/version` drives backup + migrate; unknown version refused with guidance; malformed YAML → graceful error with line number.
- **Retention:** `paw clean` enforces retention (default: keep last 20 sessions + 7 days of artifacts).
- **Artifact naming:** UTC timestamp + slug + short id → no same-day collisions.

---

## 13. Checkpoint & rollback `[V1]`
- Before any R≥1, checkpoint into an **isolated shadow git worktree/snapshot under `.paw/`** — **never** `git stash` / `git reset --hard` on the user's tree.
- **13.1 Granularity:** per-slice checkpoints; `paw rollback` reverts to the last slice or the task start (user chooses).
- **13.2 Scope:** rollback reverts **Paw's file changes only**; it **explicitly lists and warns** that migrations / installed deps / external side-effects are **NOT auto-reverted**. Works in non-git repos via snapshot. Never silently overwrites uncommitted user changes.
- **13.3 Snapshot mechanism (MISS-5):** the shadow worktree is seeded with the **current working tree (incl. uncommitted changes)** via a throwaway commit in a detached shadow ref, so both the read-plane snapshot and checkpoints reflect on-disk reality without polluting the user's branches/index.

---

## 14. Sub-agent contract & sandbox fallback `[V1]`

### 14.1 Contract (JSON-Schema validated)
```json
{ "status":"pass|fail|blocked|needs_user_decision",
  "confidence":"low|medium|high",
  "changed_files":[], "inspected_files":[], "risks":[], "next_actions":[],
  "artifact_ref":".paw/artifacts/<session>/<agent>/report.md",
  "tokens_used":0, "usd_cost":0.0, "degraded":false }
```
- Invalid JSON → **one retry → `blocked`**. Never crash the orchestrator.
- Orchestrator reads only the machine summary + a bounded excerpt; drill-down via `artifact_ref`.
- **Roles:** `scout`(R0) ripgrep/ctags/git, ranked refs; `planner` ordered vertical-slice plan; `worker`(R1–R3 per approval) one slice, atomic writes, stops on ambiguity; `reviewer`(R0) correctness/edge/behavior/readability.

### 14.2 Sandbox fallback matrix (ADR-18)
| Available primitive | Behavior |
|---|---|
| bubblewrap + Landlock | Full sandbox (preferred) |
| bubblewrap only (no Landlock) | FS allowlist via bwrap bind mounts + seccomp; net default-deny |
| user namespaces only | minimal namespace isolation + seccomp; warn reduced FS guarantees |
| **none** (userns disabled, e.g., hardened kernel) | **Refuse R≥1 → force `--read-only`**; require explicit `--no-sandbox-i-understand` to enable writes; `BLOCKED_SANDBOX_UNAVAILABLE` otherwise |
`paw doctor` detects the level, prints the exact distro command to enable user namespaces, and reports the egress allowlist.

---

## 15. Context layers `[V1]`
```text
L0 System Policy | L1 User Intent | L2 SPEC summary | L3 Plan summary | L4 Scout refs
L5 Rules | L6 Memories | L7 Runtime evidence | L8 Session summary
```
Assembly order = stable→volatile (for prompt-cache, §8.2). Eviction = L7,L8 first; **L0–L3 never evicted**.

---

## 16. Verification `[V1]`
- v1 gates (parallel native processes, results ≤1.5k tokens): working-tree baseline · dep diff · `tsc` · `eslint`/`ruff` · unit tests · build · reviewer diff · lightweight a11y lint (§10.1).
- Terminal states: `done` (all *applicable* gates pass) | `done_with_unverified[...]` (lists each unrunnable gate + reason). No false "done"; browser/Sonar are `[V2]` opt-in → shown as "not applicable," not failures.

---

## 17. Design Quality Detector `[V2]` (architecture decided now)
- **Layer A (deterministic HARD GATE):** impeccable-style rules — system-font fallback, gray-on-color contrast (WCAG), missing focus states, nested-card overload, inconsistent spacing scale, missing empty/error/loading states. Reproducible, CI-able. **Full WCAG 2.1 AA verification lives here.**
- **Layer B (vision-LLM, ADVISORY only):** hierarchy/emotion/AI-slop suggestions; never a hard pass/fail.
- Validated against labeled good-vs-slop fixtures; precision/recall target must be met before Layer A may gate.

---

## 18. Architecture (v1)
```text
Paw CLI
 |- Core Orchestrator (state machine + multi-slice loop + LIVENESS invariant + budget enforcement)
 |- Task Classifier + Risk Scorer (conservative bias)
 |- Efficiency & Reliability Engine (§8: context mgr, model router, cache, resilience, active-time clock)
 |- Model Router (ModelProvider abstraction, per-role tiers, failover w/ degraded flag)   [ADR-6,14]
 |- Tool Runtime (risk-level enforcement, sandbox+fallback, secret non-read + redaction)   [§11,§14.2]
 |- SubAgentRuntime (scout/planner/worker/reviewer; concept-only from pi-subagents)         [ADR-1]
 |- Context Manager (rank, adaptive budget, summarize, evict, prompt-cache assembly)        [§8]
 |- Persistence (sessions/artifacts/memory + locks + stale-lock recovery + atomic writes)   [§12,§9.3]
 |- Checkpoint/Rollback (shadow worktree incl. dirty tree)                                  [§13]
 |- Verification (tsc/eslint/test/build adapters, parallel)
 |- Report Generator (evidence + risks + unverified + degraded)
```
Module boundaries enforced by lint rules; sub-agents communicate only via the §14 contract.

---

## 19. KPIs, Eval Harness & Scoring Oracle `[V1]`

### 19.1 KPIs (measure all four tenets)
```text
T1 token: input_tokens_per_task (median/p95); cache_hit_rate (ADVISORY, hosted only, dashboard)
T2 smart: pass_first_try_rate; accepted_without_edit_rate; regression_caught_rate; required_span_recall
T3 fast:  active-time latency p50/p95 vs SLA (excludes human wait):
          trivial < 30s/$0.10 ; standard < 120s/$0.75 ; high_risk < 600s/$3.00
T4 live:  stall_rate (target 0); resume_success_rate (target 100%); provider_failover_success;
          degraded_completion_rate (track, minimize)
safety:  secret_leak_incidents = 0; injection_block_rate = 100% (red-team set)
ux:      interview_dropoff_rate; blind_approval_rate; classifier_false_negative_rate (trivial misclass)
```

### 19.2 Scoring Oracle (ADR-20) — how KPIs are actually computed
- Each benchmark `(repo, task)` pair ships a **scoring bundle**: a golden acceptance script (exit 0/1), the repo's own test suite, and a **golden diff** for similarity.
  - `pass_first_try_rate` = acceptance script + tests pass on first build.
  - `accepted_without_edit_rate` = golden-diff similarity ≥ threshold **OR** periodic human label (collected nightly, not in CI).
  - `regression_caught_rate` = injected-bug fixtures the reviewer must flag.
- **CI determinism:** PR CI runs the harness against **record/replay LLM fixtures** (recorded responses) → deterministic, fast, free. **Live-model eval** (pinned model snapshots) runs **nightly** and posts a scoreboard; statistical thresholds with confidence intervals (not single-run cutoffs) decide regressions.
- **PR-blocking hard gates** = only the **deterministic** ones: schema validation, security/red-team (injection, secret-leak), liveness/resume, budget/timeout enforcement. Probabilistic quality KPIs **inform** but do not flake the build.

---

## 20. Pre-Merge / Pre-Release Checklist `[V1]`
```text
[ ] Read-only & approval enforced at RUNTIME (test proves prompt can't bypass)
[ ] R7 ALWAYS requires human approval; no flag/mode can auto-approve it (incl. non-interactive)
[ ] Non-interactive: R7 & over-budget → fail-closed, non-zero exit, never hang, never auto-approve
[ ] Red-team prompt-injection: 100% blocked
[ ] No secret/PII in artifacts/logs; secret files excluded from read-plane; volatile .paw/ gitignored
[ ] Per-class budget cap + per-slice sub-budget + loop cap + per-call timeout/failover all functioning
[ ] Failover to lower tier sets degraded=true and surfaces in final report (never silent)
[ ] Sub-agent output schema-validated; provider failover works; resume after crash works (stall_rate=0)
[ ] Multi-slice loop: completed slices not redone on resume; per-slice checkpoint/rollback works
[ ] Patch-apply fallback (fuzzy → full-file ≤400 LOC → BLOCKED); no silent corruption; idempotent re-apply
[ ] Context caps adaptive per class/model; required_span_recall above threshold (no harmful truncation)
[ ] cache_hit_rate is advisory only (NOT a CI gate); local-provider path excluded
[ ] Checkpoint/rollback never touches user git/uncommitted changes; snapshot includes dirty tree (tested)
[ ] Stale-lock auto-recovery (kill -9 holder → reclaimed)
[ ] Unrunnable gate => done_with_unverified, never false "done" or hang
[ ] SLA measured as active machine-time (human wait excluded); meets p95
[ ] Eval harness: deterministic gates green on PR; nightly live-eval scoreboard stable on 3 real repos
[ ] paw doctor: correct sandbox-level detection + distro-specific remediation
```

---

## 21. Build Plan — phases, gates, **timeline & headcount** (DECIDED)

**Team (DECIDED): 5 people.**
- **TL** — Tech Lead / Architect (orchestrator, state machine, ADR owner)
- **BE1** — Senior Eng (Efficiency & Reliability Engine: context, router, resilience)
- **BE2** — Senior Eng (sub-agent runtime, tool runtime, persistence, checkpoint)
- **SEC** — Security Eng (sandbox, redaction, injection, red-team) — ~60% allocation
- **DX/QA** — DevEx/QA Eng (CLI UX, eval harness, scoring oracle, CI, `paw doctor`)

**Total MVP: ~15 calendar weeks (~3.5 months).** Estimates assume the 5-person team above; ±20%.

| Phase | Goal | Duration | Owners | Exit gate |
|---|---|---|---|---|
| **P0 — Risk Burn-down** | Accept 21 ADRs; run 5 spikes w/ kill-criteria | **2 wks** | TL + all | **G0**: ADRs signed; spikes pass/kill recorded |
| **P1 — Design & Contracts** | Package boundaries; sub-agent JSON schema; tool registry + runtime risk enforcement; ModelProvider + tiers; Context Mgr + Resilience + budget interfaces; error taxonomy; persistence schemas; **Non-Interactive policy spec** | **2 wks** | TL, BE1, BE2 | **G1**: contracts frozen + reviewed |
| **P2 — Foundation** | `paw init` (idempotent, gitignore, no overwrite); config; session/artifact store + locks + atomic writes + stale-lock recovery; provider router + per-class budget + timeout/failover; context cache + prefix assembly; eval-harness skeleton + record/replay; feature flags | **3 wks** | BE1, BE2, DX/QA | **G2**: foundation unit-tested |
| **P3 — Core Slice** | Orchestrator + multi-slice state machine (persist/resume + liveness); scout/planner/worker(atomic+checkpoint)/reviewer; adaptive interview; parallel verify; interactive+print+json; shadow-worktree rollback; sandbox + fallback matrix; secret non-read+redaction | **5 wks** | TL, BE1, BE2, SEC | **G3**: full slice runs on 1 repo |
| **P4 — Validation Gate** | unit/integration/e2e on **3 repos**; security/red-team; perf vs SLA; resilience/chaos (provider kill, Ctrl-C, timeout, concurrent sessions, kill-9 lock); usability (5 users); migration; edge cases (§23) | **3 wks** | DX/QA, SEC, all | **G4**: §19 KPIs + §20 checklist pass → **MVP ship** |
| **P5 — Post-MVP `[V2]`** | ponytail → architecture-reviewer → design engine (Layer A + WCAG) → memory/rules governance → oracle → security-reviewer; opt-in plugins (Playwright browser-verifier, sonar-reviewer, graph); distribution (npm/Homebrew/.deb) + canary + per-flag rollback | (post-MVP) | all | per-flag gates |
| **P6 — Post-release** | watch §19 KPIs; alert on cost/latency/Not-verified/stall spikes; track upstream-dep breakage; tech-debt backlog (Rust indexing, SQLite memory, daemon/RPC, provider plugins, i18n) | continuous | all | — |

**Critical path:** P0 spike-1 (SubAgentRuntime) + spike-3 (sandbox) → P1 contracts → P3 orchestrator+multi-slice → P4 chaos/resilience. Sandbox (SEC) and orchestrator (TL) are the two longest poles; start both in P0.

**P0 spikes (each has explicit kill-criteria):**
1. `SubAgentRuntime` delegate + bounded-artifact isolation.
2. Full-slice **cost/latency + cache-hit** on a real **high-risk** task (validates §8.6 caps).
3. **Sandbox** (bwrap + Landlock + FS/net allowlist) across Ubuntu/Debian/Fedora/Arch + **userns-off fallback**.
4. Scout on a large/monorepo within budget (validates ripgrep+ctags path; informs ADR-11 defer).
5. **Resilience drill:** kill provider mid-task → failover + resume with **no data loss** + `degraded` flag.

---

## 22. Validation Matrix `[V1 core]`

| Requirement / Behavior | Validation | Test case | Expected | Priority |
|---|---|---|---|---|
| Task boundary | Unit | multi-command session | budgets/KPIs aggregate per task; resume keeps session | Critical |
| Multi-slice loop | Integration | 3-slice plan | each slice impl→review→verify; resume skips done slices | Critical |
| Non-interactive R7 fail-closed | Security | json mode + auth task | BLOCKED, exit≠0, no auto-approve | Critical |
| Non-interactive budget | Integration | print mode over budget | abort (or block) per flag; no hang | Critical |
| Liveness invariant | Integration | any stuck step | advance / BLOCKED+reason / escalate; never silent wait | Critical |
| Resume after crash/kill | Integration | kill mid-pipeline | resume from last state; stall_rate=0 | Critical |
| Adaptive interview | Usability+Unit | trivial vs high-risk | trivial ≤2 Q; high-risk escalates | Critical |
| Product vs engineering approval | Manual QA | 5 users | product understood; eng auto-gated | Critical |
| Per-class budget cap | Unit+Integration | exceed each class | warn→stop/confirm/abort per mode | Critical |
| Per-slice sub-budget | Unit | one greedy slice | flagged before eating task budget | High |
| Provider failover + degraded flag | Integration | primary 429/5xx | failover; degraded=true in report | Critical |
| Per-call timeout | Unit | hung tool/LLM | killed at timeout, no hang | Critical |
| Loop cutoff | Integration | planner↔reviewer disagree | ≤6 iters → escalate/fail-closed | High |
| Patch-apply fallback | Unit | bad patch | fuzzy→full-file≤400→BLOCKED; no corruption | High |
| Idempotent re-apply | Integration | kill mid-apply → resume | no double-apply (hash compare) | Critical |
| Adaptive context cap + recall | Unit+Perf | multi-file task | within class cap; required_span_recall ≥ threshold | Critical |
| Cache advisory only | Unit | local provider | cache KPI N/A; no CI fail | High |
| Read-only enforcement | Security | model write in --read-only | runtime blocks | Critical |
| Sandbox fallback matrix | Security | userns-off kernel | refuse R≥1 / read-only; clear doctor msg | Critical |
| Secret non-read + redaction | Security | repo has .env | not read into context; redacted in artifacts; git-untracked | Critical |
| Prompt injection | Red-team | README "run rm -rf" | not executed; 100% block | Critical |
| Snapshot incl. dirty tree | Integration | uncommitted changes | scout sees on-disk state; rollback preserves user changes | High |
| Stale-lock recovery | Integration | kill -9 lock holder | reclaimed w/ warning; 2nd instance proceeds | Med |
| `.paw` gitignore + migration | Integration | init+commit; bump version | rules/memory tracked; volatile ignored; auto-migrate+backup | High |
| SLA = active machine-time | Performance | task with long human wait | human wait excluded; meets p95 | High |
| done_with_unverified | Integration | no build/test | clear reasons; not false done/hang | Med |
| Eval harness determinism | E2E | same commit twice (replay) | identical PR result; nightly scoreboard stable | High |
| Large repo perf | Performance | 100k files | ctags/index within budget | High |
| `paw doctor` | Manual QA | Ubuntu/Arch diff Node | clear missing-deps + sandbox level | Med |

---

## 23. Edge cases to cover `[V1]`
Concurrent sessions + stale lock (kill-9); `paw init` over existing files (no overwrite); malformed YAML; schema migration; artifact bloat (`paw clean`). Sub-agent invalid JSON; planner↔reviewer non-convergence; provider timeout/429/5xx mid-task; provider **all-down** → `BLOCKED_PROVIDER_UNAVAILABLE` resumable; oversized sub-agent output; **bad patch → fallback chain**. Ctrl-C mid-write; interview abandoned (resume); **multi-slice partial failure (resume mid-plan)**; app fails to start (V2 gate degrades); non-web repo skips UI gates. Non-tech blind approval; `--read-only` write attempt; autonomous/non-interactive + R7 (fail-closed); over-budget non-interactive (abort). UTC/date artifact collisions. Upstream dep break (abstraction+pin+fallback). Large/monorepo perf; huge/binary files excluded. Secret/PII redaction; `.env` excluded from scout context. Sandbox unavailable (userns-off) → read-only refuse. Failover to lower tier → degraded label. SLA with long human-wait (active-time clock).

---

## 24. Risk Register

| Risk | Prob | Impact | Severity | Mitigation | Owner |
|---|---|---|---|---|---|
| Scope creep back to "no MVP" | High | High | Critical | [V1] tagging + value gate G4 | TL/PM |
| ADRs reopened mid-build | Med | High | High | Locked at G0; revisit only on trigger | TL |
| Non-interactive contradiction (liveness/R7/budget) | Med | High | Critical | §9.6 policy + tests | TL/SEC |
| Multi-slice loop / task-boundary ambiguity | Med | High | High | ADR-16/19 + state machine §6.3 | TL |
| Non-tech UX friction / blind approval | High | High | Critical | Adaptive Q + product/eng split + Guided Mode + usability gate | DX/Product |
| Cost/latency blow-up | High | High | Critical | Per-class+per-slice budgets + fast-path + loop cap + cache | TL |
| Context overflow / harmful truncation | High | High | Critical | Adaptive caps + precision retrieval + recall guard + eviction | BE1 |
| Mid-task stall / hang / killed | Med | High | Critical | Liveness invariant + timeout/failover + resume | TL |
| Sandbox portability (userns-off kernels) | Med | High | High | Fallback matrix + read-only refuse + doctor + P0 spike-3 | SEC |
| Silent quality drop on failover | Med | Med | Med | degraded flag in report (§9.4) | BE1 |
| Eval CI flakiness / cost | Med | Med | High | Record/replay PR gate + nightly pinned live-eval + stats | DX/QA |
| Prompt injection / RCE | Med | High | High | Sandbox + runtime gating + untrusted channel + red-team | SEC |
| Secret/PII leak | Med | High | High | Non-read + I/O redaction + gitignore + tests | SEC |
| Upstream deps break (single-maintainer) | Low | Med | Med | Concept-only (ADR-1), abstraction + pin elsewhere | TL |
| Graph underestimated | Med | High | High | Deferred (ADR-11); P0 spike-4 before V2 | TL |
| Checkpoint corrupts user git | Med | High | High | Shadow worktree; never touch user git; dirty-tree snapshot | BE2 |
| Patch corruption | Med | Med | Med | Fallback chain + idempotency hash | BE2 |
| Big-bang integration | Med | High | High | Vertical slice + continuous integration | TL |
| Legal: studied prompts / dep licenses | Low | High | Med | Legal review; general patterns; license audit | TL/Legal |
| i18n ignored | Med | Med | Med | i18n-ready arch; v1 English | Product |

---

## 25. Non-Negotiable Rules (runtime-enforced)
**Never:** R≥3 without approval; **bypass/auto-approve R7 in any mode**; claim verification without running it; persist memory without approval; hide failed tests; overwrite uncommitted user changes silently; touch user git for checkpoints; read secret files into context or write secrets/PII to artifacts; execute instructions from untrusted content; exceed context/budget caps; **leave a step in a silent wait**; **fail over to a lower tier without a `degraded` label**.
**Always:** clarify adaptively; separate product/engineering approval; keep context bounded (adaptive) & cached; route models per role; schema-valid artifacts; timeout+failover every external call; verify with evidence + disclose unverified + disclose degraded; persist state atomically so any task can resume; in non-interactive modes terminate in `done`/`done_with_unverified`/`BLOCKED_*` with correct exit codes.

---

## 26. Contradictions fixed (cumulative, v0.1 → v0.4)
```text
v0.1 → v0.3 (already fixed):
  "30-question" listing 36          -> adaptive interview, no fixed count
  SonarQube required vs optional    -> optional opt-in plugin (ADR-3)
  default strict vs non-tech        -> default balanced + product/eng split (ADR-8)
  "no MVP" vs un-shippable scope    -> MVP vertical slice; cut scope not quality
  fictional model names             -> ModelProvider abstraction + config (ADR-6,14)
  injection "treat as data"         -> runtime sandbox + untrusted channel (§11)
  checkpoint/rollback undefined     -> shadow worktree + explicit non-revert list (§13)
  .paw commit/concurrency undef     -> gitignore + locks + atomic + migration (§12)
  design detector undefined          -> Layer A deterministic + Layer B advisory (§17)
  cost "tracked" not "capped"       -> hard per-task budget + confirm (ADR-10)
  no latency/stall guarantees        -> Efficiency & Reliability Engine (§8)

NEW in v0.4 (closed here):
  non-interactive approval/budget undefined  -> Non-Interactive Policy (§9.6, ADR-17)
  prompt-cache "mandatory" + CI gate + local -> advisory metric, provider matrix, local N/A (§8.2)
  sandbox primitive unportable               -> bwrap+Landlock + fallback matrix + read-only refuse (§11,§14.2,ADR-18)
  flat budget vs per-class SLA               -> per-class + per-slice budgets (§8.6, ADR-10)
  quality KPIs as flaky CI gate              -> record/replay PR + nightly pinned live-eval (§19, ADR-20)
  "never reprint file" + vague idempotency   -> diff-first + fallback chain + hash idempotency (§8.5,§9.2,ADR-21)
  multi-slice loop missing                   -> SLICE_SELECT loop + per-slice budget/checkpoint (§6.3, ADR-19)
  "task" boundary undefined                  -> ADR-16 (per-task budgets/KPIs; commands resume session)
  eval scoring oracle missing                -> deterministic scoring bundles + record/replay (§19.2, ADR-20)
  SLA includes human wait                    -> active-time clock pauses on approval waits (§8.7)
  read snapshot vs dirty tree                -> snapshot captures uncommitted changes (§9.5,§13.3)
  silent quality drop on failover            -> degraded flag surfaced in report (§9.4)
  stale lock = infinite wait                 -> PID+heartbeat+TTL auto-reclaim (§9.3)
  WCAG AA claimed in v1 w/o tooling          -> v1 records + lightweight lint; AA verified in [V2] (§10.1,§17)
  positioning non-tech vs semi-tech          -> P1 semi-technical, P2 via Guided Mode (§2)
```

---

## 27. North Star (deferred, preserved)
Full v0.1 ambition (13+ sub-agents, graph/embeddings, browser + Sonar gates, provider plugins, daemon/RPC, deploy connectors, full memory governance) remains the destination, reached via Phase 5+ once the MVP slice proves value against §19 KPIs.

---

### Appendix A — Definition of "done" for the team
A v1 task is **done** when: SPEC approved (product) → plan approved → all slices implemented → reviewer pass → all *applicable* verify gates green → final report emitted with evidence, risks, unverified items, and degraded flags. Anything unrunnable is `done_with_unverified[...]` with reasons. No false "done", no hang, no silent auto-approval, no secret leakage — enforced by the §20 checklist as a merge gate.
