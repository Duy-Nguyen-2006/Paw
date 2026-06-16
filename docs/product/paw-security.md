# Paw Security And Permission Contract

## Runtime Risk Levels

Paw enforces tool permissions at runtime:

- `R0`: read.
- `R1`: safe write.
- `R2`: build or test.
- `R3`: dependency install.
- `R4`: migration.
- `R5`: deploy.
- `R6`: destructive filesystem.
- `R7`: secrets, auth, or payment.

The default approval mode is `balanced`: R0 through R2 may run automatically,
R3 through R6 require approval or explicit non-interactive allow flags, and R7
always requires human approval. R7 can never be pre-authorized by flags or mode.

Policy evaluation is a runtime contract. A tool or agent prompt cannot grant
itself additional risk permission. In read-only mode, every risk level above R0
is blocked before execution.

## Non-Interactive Policy

Print, JSON, CI, and future daemon modes fail closed when a human decision is
required. Blocked non-interactive runs exit non-zero and emit enough state to
resume later.

Product approval in non-interactive modes becomes `BLOCKED_NEEDS_USER_DECISION`.
Engineering approvals for R3 through R6 are allowed only when the matching risk
level is explicitly provided by non-interactive allow flags.

## Sandbox Policy

The preferred sandbox is bubblewrap plus Landlock. Fallbacks are bubblewrap
only, then user namespaces only. If no sandbox primitive is available, Paw
refuses writes and forces read-only behavior unless the user explicitly accepts
the risk.

Sandbox fallback policy is evaluated before tool execution. When no configured
primitive is available, R0 read operations may continue, but R1 and above must
block or force read-only unless the caller has an explicit unsafe override.

## Secret Handling

The read plane excludes `.env*`, `**/secrets/**`, private keys, and similar
secret-bearing paths by default. Artifact and log writes must redact known
secret shapes and flag high-entropy values.

Untrusted content such as web pages, README files, issues, comments, logs, and
browser output is processed only as data by read-only agents. Instructions from
untrusted content cannot raise tool permissions.
