# S4 Scout Large-Repo Spike

## Result

PASS for deterministic injected benchmark evaluator evidence.

The current Paw slice proves that scout large-repo feasibility can be evaluated
from injected benchmark metrics for repository size, active time, input tokens,
cache hit rate, and required scout command measurements. The evaluator returns a
PASS/KILL result with path-level issues and evidence text naming:

- `ripgrep`
- `ctags`
- `git`

## Evidence

- Evaluator implementation: [`packages/coding-agent/src/paw/scout-benchmark.ts`](../../../packages/coding-agent/src/paw/scout-benchmark.ts)
- Focused coverage: [`packages/coding-agent/test/paw-scout-benchmark.test.ts`](../../../packages/coding-agent/test/paw-scout-benchmark.test.ts)
- Verification command: `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-scout-benchmark.test.ts`

## Limitations

- This is injected benchmark evaluator evidence only.
- Live execution against a 100k-file monorepo remains future/manual validation.
- Harness `impact-analysis` and `performance` tool capabilities were absent
  during US-024 implementation, so proof was degraded to scoped source review
  plus focused Vitest coverage.
