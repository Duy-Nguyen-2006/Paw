# ADR-18: Sandbox stack

- **Status:** Accepted
- **Date:** 2026-06-16
- **Deciders:** SEC, Tech Lead

## Context
String denylists are bypassable; a real sandbox is required. But raw user namespaces are disabled on
some distros/kernels (hardened Debian/RHEL/enterprise), so a single hard requirement would fail to
initialize on real user machines.

## Decision
Primary sandbox = **bubblewrap + Landlock** with a repo-scoped FS allowlist and **network
default-deny** + egress allowlist. Ordered fallback: bwrap-only → userns-only. If **no** sandbox is
available, **refuse R≥1 (force `--read-only`)** unless the user passes `--no-sandbox-i-understand`.
The string denylist is a **secondary** layer only.

## Consequences
- (+) Portable across Ubuntu/Debian/Fedora/Arch; safe-by-default (never silently runs writes unsandboxed).
- (+) `paw doctor` detects the level and prints the exact remediation command.
- (-) Egress allowlist (provider hosts + registries + localhost) must be configured correctly.

## Revisit trigger
A stable, superior sandbox primitive emerges, or Landlock coverage changes.

## Related
SPEC §11, §14.2, §21 (spike-3); config.yaml: sandbox.
