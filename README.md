
# Paw

Paw is a coding-agent workspace focused on disciplined software delivery:
clear specifications, incremental implementation, durable session state, and
verification before changes are treated as complete.

This repository is forked from the Pi agent harness and is being shaped into a
Paw-oriented development environment.

## What This Repo Contains

| Area | Purpose |
| --- | --- |
| `packages/coding-agent` | Interactive coding-agent CLI and Paw runtime foundations |
| `packages/agent` | Agent runtime primitives |
| `packages/ai` | Multi-provider model integration |
| `packages/tui` | Terminal UI components |
| `docs` | Product notes, architecture notes, and story validation |
| `paw-spec` | Paw specification, ADRs, schemas, and runtime defaults |

## Development

Install dependencies without lifecycle scripts:

```bash
npm install --ignore-scripts
```

Run the standard project checks:

```bash
npm run check
```

Run the non-e2e test suite:

```bash
./test.sh
```

Run the local CLI from sources:

```bash
./pi-test.sh
```

## Paw Direction

Paw is intended to support:

- specification-driven task intake
- resumable task sessions under `.paw/`
- bounded sub-agent artifacts
- explicit approval, budget, sandbox, and verification policies
- final reports that disclose evidence, risks, degraded execution, and
  unverified gates

Current development is incremental. Feature support should be judged by the
implemented stories and validation evidence in this repository, not by roadmap
language alone.

## Safety Notes

- Do not commit secrets or credentials.
- Install dependencies with `--ignore-scripts` unless lifecycle scripts have
  been explicitly reviewed.
- Treat lockfile and shrinkwrap changes as reviewed code.
- Run focused tests for touched behavior before pushing changes.

## License

MIT
