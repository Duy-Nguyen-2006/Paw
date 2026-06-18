# Design

## Wiring

The build command uses the composed provider executor for the default provider
runtime path. The wiring is exercised through sub-agent runtime tests rather
than by introducing new CLI surface.

## Safety

Default behavior remains fail-closed when provider wiring is absent. Tests keep
runtime state isolated so local environment settings do not affect model calls.
