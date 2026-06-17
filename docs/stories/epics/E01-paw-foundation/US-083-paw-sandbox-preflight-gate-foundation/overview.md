# US-083: Paw Sandbox Preflight Gate Foundation

## Summary

Add an explicit, injected sandbox preflight gate for Paw worker and reviewer build orchestration so write-capable sub-agent work can fail closed before provider execution when no configured sandbox primitive is available.

## Scope

- Add a reusable sub-agent sandbox preflight helper.
- Allow worker and reviewer orchestration to accept optional sandbox preflight input.
- Allow `PawBuildCommandInput` to pass sandbox preflight input through to worker and reviewer steps.
- Block before executor/provider calls when injected sandbox facts have no configured primitive for write-capable work.
- Preserve default `paw build` behavior when no preflight input is supplied.
- Keep tests fake-only with injected primitive lists.
- Do not perform live sandbox probing, launch sandbox processes, execute tools, or add CLI flags.

## Acceptance Criteria

- Tests prove worker build preflight blocks with `SANDBOX_UNAVAILABLE` before provider completion.
- Tests prove reviewer build preflight blocks with `SANDBOX_UNAVAILABLE` before provider completion.
- Tests prove available configured primitives allow normal provider-backed worker execution.
- Tests prove default build behavior remains provider-unavailable without injected preflight.
