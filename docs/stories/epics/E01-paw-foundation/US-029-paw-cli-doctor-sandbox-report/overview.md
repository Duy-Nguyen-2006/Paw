# Overview

## Current Behavior

Paw has a sandbox detector and `pi paw init` routing, but no bounded CLI
diagnostic that reports whether the current host appears to have Paw sandbox
primitives available. Users and agents must infer sandbox readiness from tests
or implementation details.

## Target Behavior

`pi paw doctor` loads `paw-spec/config.yaml`, performs read-only sandbox
diagnostics, and prints a concise report with:

- Sandbox status.
- Detected primitives, or `none`.
- Warnings and remediation when the detector reports degraded or unavailable
  primitives.
- Configured sandbox egress allowlist from
  `config.sandbox.egress_allowlist`.

`pi paw doctor --help` prints help without loading config or writing project
files. Unknown `paw doctor` options set `process.exitCode = 1` and return
handled instead of throwing.

## Affected Users

- Paw implementers validating local sandbox readiness.
- Agents and reviewers checking whether write-capable Paw work should remain
  blocked or read-only.

## Affected Product Docs

- `docs/product/paw-overview.md`
- `docs/product/paw-security.md`
- `paw-spec/config.yaml`

## Non-Goals

- Implementing full Paw runtime orchestration.
- Claiming full cross-distro sandbox validation.
- Executing write-capable work, package installs, shell commands, or sandboxed
  child processes.
- Adding standalone `paw` binary routing.
