
# Design

## Domain Model

The slice introduces:

- Sandbox platform probe input.
- Detected sandbox primitive set.
- Doctor-style remediation messages.

## Application Flow

Future `paw doctor` and tool runtime code will gather platform facts, pass them
to the detector, and then pass the detected primitives to `evaluatePawSandbox`.
If no primitive is available, the existing sandbox policy forces read-only for
R0 and blocks R1+ unless an unsafe override is explicit.

## Interface Contract

The TypeScript foundation exports:

- Sandbox probe input and detection result types.
- A detector helper that maps platform facts to Paw primitive names.

## Data Model

Probe input is explicit booleans for bubblewrap, Landlock, and user namespaces,
plus optional distro metadata for remediation text.

## UI / Platform Impact

No user-facing CLI behavior changes in this slice. Doctor output data is
returned as structured text for future CLI rendering.

## Observability

Detection result includes warnings and remediation so future traces can explain
why sandbox enforcement degraded.

## Alternatives Considered

1. Probe the local machine with shell commands directly.
   Rejected because Harness has no present sandbox tool capability, and pure
   injected probes are deterministic in tests.
2. Merge detection into `evaluatePawSandbox`.
   Rejected because policy should stay independent from platform probing.
