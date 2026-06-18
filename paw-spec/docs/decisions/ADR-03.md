
# ADR-03: Static analysis / SonarQube

- **Status:** Accepted
- **Date:** 2026-06-16
- **Deciders:** Tech Lead, DX/QA

## Context
SonarQube Community needs a Java server + database (GBs of RAM). That is impossible to require as a
default for a local CLI targeting individual builders.

## Decision
SonarQube is an **optional opt-in plugin**. Default static analysis = `tsc` + ESLint + Semgrep
(+ `ruff` for Python).

## Consequences
- (+) Zero heavy setup for the default path; fast onboarding.
- (+) Sonar still available for teams/CI that want it (`[V2]`).
- (-) Default coverage is lighter than a full Sonar quality gate.

## Revisit trigger
Team/CI demand a managed Sonar plugin as a first-class gate.

## Related
SPEC §16; verify.v2_optin_gates in config.yaml.
