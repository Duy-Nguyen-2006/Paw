# Validation

## Proof Strategy

US-087 is complete when the spawned CLI fixture suite passes for representative
repo shapes and documents no corruption without claiming browser E2E. Live repo
proof on copied real repos also passed and now covers the full SPEC three-real-
repo MVP DoD:

- `/home/duy/Downloads/timetable`
- `/home/duy/Downloads/Project1-Road-Finder/backend`
- `/home/duy/.claude/plugins/marketplaces/ecc`

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Command/result mapping and no-corruption assertions. |
| Integration | Spawned CLI flows across representative fixtures. |
| E2E | Not applicable; this is fixture-based proof, not browser flow. |
| Platform | `paw init`/`status`/`verify`/`finalize`/`report` in isolated repos and copied real repos. |
| Release | Harness evidence captures the validation outcome. |
