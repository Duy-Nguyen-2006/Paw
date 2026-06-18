
# Design

## Pure Evaluator

`evaluatePawToolRuntimeRequest` accepts runtime config and injected request facts. It returns a dry-run allowed, blocked, or invalid decision and never executes tools.

## Policy Composition

The evaluator applies checks in fail-closed order:

1. Request shape validation.
2. Secret path exclusion via `isPawSecretPath`.
3. Untrusted source write blocking via `evaluatePawUntrustedSource`.
4. Approval policy via `evaluatePawToolApproval`.
5. Sandbox policy via `evaluatePawSandbox` for write-capable requests.

## No Execution Boundary

All decisions include `executed: false` and `filesChanged: false`. This slice does not include tool adapters, shell commands, subprocesses, file writes, sandbox launch, provider tool calls, or CLI routing.

## Out Of Scope

- Real tool execution.
- Worker-generated tool-call parsing.
- CLI `paw tool` command.
- Patch application.
- Live sandbox process creation or probing.
- Provider/tool loop integration.
