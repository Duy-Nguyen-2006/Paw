# Design

## Domain Model

US-029 adds a command-level diagnostic report around existing sandbox policy
objects:

- Probe facts: injected or live read-only facts matching
  `PawSandboxProbeFacts`.
- Sandbox detection: existing `detectPawSandboxPrimitives` result.
- Doctor report: formatted command output containing status, primitives,
  warnings, remediation, egress allowlist, evidence, and a bounded validation
  note.

## Application Flow

The command flow is:

1. `handlePawCommand` accepts the bounded `paw doctor` subcommand.
2. `paw doctor --help` prints help and returns without loading config.
3. Unknown `paw doctor` options report command misuse and set
   `process.exitCode = 1`.
4. `paw doctor` loads `paw-spec/config.yaml` through the existing Paw config
   loader.
5. The doctor command collects read-only probe facts:
   - PATH executable check for `bwrap`.
   - Read `/etc/os-release` when present.
   - Read `/proc/sys/kernel/unprivileged_userns_clone` on Linux when present.
   - Check `/sys/kernel/security/landlock`.
6. The command calls `detectPawSandboxPrimitives`.
7. The formatter prints the concise report.

## Interface Contract

New supported commands:

```text
pi paw doctor
pi paw doctor --help
```

The report is human-readable text. JSON output remains out of scope for this
slice.

## Safety Boundaries

The live command does not execute shell commands and does not write files. It
only reads config and host capability files or checks PATH executability.

When user namespaces are disabled, remediation includes an advisory sysctl
command:

```text
sudo sysctl kernel.unprivileged_userns_clone=1
```

The report also states that live probing is read-only and not complete
cross-distro validation.

## Alternatives Considered

1. Extend the sandbox detector with filesystem probing.
   - Rejected because US-023 kept the detector pure and testable with injected
     facts.
2. Add JSON output now.
   - Rejected because the story asks for a concise report and the current Paw
     CLI slice does not yet define JSON mode.
