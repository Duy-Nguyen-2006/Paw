# S3 Sandbox Spike

## Result

PASS for injected fallback-matrix evidence.

The current Paw slice proves that sandbox primitive detection can be decided from injected platform probe facts without direct shell probing or sandbox process execution. The detector maps probe facts into Paw's configured primitive names in strongest-to-weakest order:

- `bubblewrap_landlock`
- `bubblewrap_only`
- `userns_only`

When no primitive is available, the detector emits doctor-style warnings and remediation for disabled user namespaces and missing sandbox support. Existing `evaluatePawSandbox` behavior remains the enforcement point: R1 write-capable work is blocked when the detector returns no primitives.

## Evidence

- Detector implementation: [`packages/coding-agent/src/paw/sandbox-detector.ts`](../../../packages/coding-agent/src/paw/sandbox-detector.ts)
- Focused coverage: [`packages/coding-agent/test/paw-sandbox-detector.test.ts`](../../../packages/coding-agent/test/paw-sandbox-detector.test.ts)
- Verification command: `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/paw-sandbox-detector.test.ts`

## Limitations

- This is injected-probe fallback-matrix evidence only.
- Live cross-distro sandbox execution across Ubuntu, Debian, Fedora, and Arch remains future/manual validation.
- Harness `impact-analysis` and `sandbox` tool capabilities were absent during US-023 implementation, so proof was degraded to scoped source review plus focused Vitest coverage.
