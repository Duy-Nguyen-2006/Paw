# Validation

## Proof Strategy

US-086 is complete when the default build path exercises the composed provider
executor, keeps fail-closed behavior, and passes focused runtime tests.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Provider routing and fail-closed defaults. |
| Integration | Build command and sub-agent runtime wiring. |
| E2E | Not applicable; no user-facing provider flags in this slice. |
| Platform | Default provider tests isolate `ENV_AGENT_DIR`. |
| Release | Root repository check passes. |
