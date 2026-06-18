
# US-087: Paw Spawned CLI Validation Proof

## Summary

Add fixture-based spawned CLI validation for representative repos so the Paw
command surface has durable proof across Next.js-like, FastAPI-like, and Node
CLI-like projects. Live repo proof also exists on copied real repos and now
covers the SPEC three-real-repo MVP DoD:

- `/home/duy/Downloads/timetable` for the Next.js web app shape
- `/home/duy/Downloads/Project1-Road-Finder/backend` for the FastAPI service
- `/home/duy/.claude/plugins/marketplaces/ecc` for the standalone Node CLI

## Scope

- Validate `paw init`, `paw status`, `paw verify`, `paw finalize`, and `paw report`.
- Exercise isolated provider and user config in spawned repos.
- Check sentinel no-corruption behavior.
- Do not claim browser E2E.
- Keep the live proof artifact explicit and tied to the three required repo shapes.

## Acceptance Criteria

- Spawned CLI fixtures pass for representative repo shapes.
- No corruption sentinel checks remain green.
- Proof is documented as platform/integration validation, not browser E2E.
