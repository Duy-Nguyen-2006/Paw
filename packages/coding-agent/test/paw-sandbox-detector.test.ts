
import { describe, expect, test } from "vitest";
import { detectPawSandboxPrimitives, evaluatePawSandbox, loadDefaultPawRuntimeConfig } from "../src/paw/index.ts";

describe("Paw sandbox detector", () => {
	test("detects bubblewrap plus Landlock as the strongest primitive", () => {
		const result = detectPawSandboxPrimitives({
			bubblewrapAvailable: true,
			landlockAvailable: true,
			userNamespacesAvailable: true,
			distro: { name: "Fedora", version: "41" },
		});

		expect(result.detectedPrimitives).toEqual(["bubblewrap_landlock", "bubblewrap_only", "userns_only"]);
		expect(result.status).toBe("available");
		expect(result.warnings).toEqual([]);
		expect(result.evidence).toContain("Fedora 41");
	});

	test("detects bubblewrap-only as a reduced sandbox when Landlock is unavailable", () => {
		const result = detectPawSandboxPrimitives({
			bubblewrapAvailable: true,
			landlockAvailable: false,
			userNamespacesAvailable: true,
			distro: { name: "Debian" },
		});

		expect(result.detectedPrimitives).toEqual(["bubblewrap_only", "userns_only"]);
		expect(result.status).toBe("reduced");
		expect(result.warnings).toContain("Landlock is unavailable; Paw will fall back from bubblewrap+Landlock.");
		expect(result.remediation).toContain(
			"Use a kernel and distro configuration with Landlock enabled for the strongest Paw sandbox.",
		);
	});

	test("detects userns-only when bubblewrap is unavailable", () => {
		const result = detectPawSandboxPrimitives({
			bubblewrapAvailable: false,
			landlockAvailable: true,
			userNamespacesAvailable: true,
		});

		expect(result.detectedPrimitives).toEqual(["userns_only"]);
		expect(result.status).toBe("reduced");
		expect(result.warnings).toContain("bubblewrap is unavailable; Paw can only use the user namespace fallback.");
		expect(result.remediation).toContain("Install bubblewrap to enable the configured bubblewrap_only fallback.");
	});

	test("reports no primitives and user namespace remediation when userns is disabled", () => {
		const result = detectPawSandboxPrimitives({
			bubblewrapAvailable: false,
			landlockAvailable: false,
			userNamespacesAvailable: false,
			distro: { name: "Ubuntu", version: "24.04" },
		});

		expect(result.detectedPrimitives).toEqual([]);
		expect(result.status).toBe("unavailable");
		expect(result.warnings).toEqual([
			"User namespaces are disabled; Paw cannot use the userns_only fallback.",
			"No supported Paw sandbox primitive was detected; write-capable Paw work must not run unsandboxed.",
		]);
		expect(result.remediation).toContain("Enable unprivileged user namespaces or run Paw in read-only mode.");
		expect(result.remediation).toContain(
			"Install bubblewrap and enable Landlock support for the preferred Paw sandbox.",
		);
		expect(result.evidence).toContain("Ubuntu 24.04");
	});

	test("keeps R1 blocked when detector returns no sandbox primitives", () => {
		const config = loadDefaultPawRuntimeConfig();
		const detection = detectPawSandboxPrimitives({
			bubblewrapAvailable: false,
			landlockAvailable: false,
			userNamespacesAvailable: false,
		});

		expect(
			evaluatePawSandbox({
				config: config.sandbox,
				availablePrimitives: detection.detectedPrimitives,
				riskLevel: "R1",
			}),
		).toMatchObject({
			status: "blocked",
			code: "SANDBOX_UNAVAILABLE",
			degraded: true,
			riskLevel: "R1",
		});
	});
});
