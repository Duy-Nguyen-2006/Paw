export type PawSandboxPrimitiveName = "bubblewrap_landlock" | "bubblewrap_only" | "userns_only";

export type PawSandboxDistroFacts = {
	name: string;
	version?: string;
};

export type PawSandboxProbeFacts = {
	bubblewrapAvailable: boolean;
	landlockAvailable: boolean;
	userNamespacesAvailable: boolean;
	distro?: PawSandboxDistroFacts;
};

export type PawSandboxDetectionStatus = "available" | "reduced" | "unavailable";

export type PawSandboxDetectionResult = {
	status: PawSandboxDetectionStatus;
	detectedPrimitives: readonly PawSandboxPrimitiveName[];
	warnings: readonly string[];
	remediation: readonly string[];
	evidence: string;
};

export function detectPawSandboxPrimitives(facts: PawSandboxProbeFacts): PawSandboxDetectionResult {
	const detectedPrimitives: PawSandboxPrimitiveName[] = [];
	const warnings: string[] = [];
	const remediation: string[] = [];

	if (facts.bubblewrapAvailable && facts.landlockAvailable) {
		detectedPrimitives.push("bubblewrap_landlock");
	}

	if (facts.bubblewrapAvailable) {
		detectedPrimitives.push("bubblewrap_only");
	}

	if (facts.userNamespacesAvailable) {
		detectedPrimitives.push("userns_only");
	}

	if (detectedPrimitives.length === 0) {
		if (!facts.userNamespacesAvailable) {
			warnings.push("User namespaces are disabled; Paw cannot use the userns_only fallback.");
			remediation.push("Enable unprivileged user namespaces or run Paw in read-only mode.");
		}

		warnings.push(
			"No supported Paw sandbox primitive was detected; write-capable Paw work must not run unsandboxed.",
		);
		remediation.push("Install bubblewrap and enable Landlock support for the preferred Paw sandbox.");
	} else if (detectedPrimitives[0] !== "bubblewrap_landlock") {
		if (facts.bubblewrapAvailable) {
			warnings.push("Landlock is unavailable; Paw will fall back from bubblewrap+Landlock.");
			remediation.push("Use a kernel and distro configuration with Landlock enabled for the strongest Paw sandbox.");
		} else {
			warnings.push("bubblewrap is unavailable; Paw can only use the user namespace fallback.");
			remediation.push("Install bubblewrap to enable the configured bubblewrap_only fallback.");
		}
	}

	return {
		status: getDetectionStatus(detectedPrimitives),
		detectedPrimitives,
		warnings,
		remediation,
		evidence: formatInjectedProbeEvidence(facts),
	};
}

function getDetectionStatus(detectedPrimitives: readonly PawSandboxPrimitiveName[]): PawSandboxDetectionStatus {
	if (detectedPrimitives.length === 0) {
		return "unavailable";
	}

	if (detectedPrimitives[0] === "bubblewrap_landlock") {
		return "available";
	}

	return "reduced";
}

function formatInjectedProbeEvidence(facts: PawSandboxProbeFacts): string {
	const platform = facts.distro === undefined ? "unknown distro" : formatDistroFacts(facts.distro);

	return [
		`Injected platform probe facts for ${platform}.`,
		`bubblewrapAvailable=${String(facts.bubblewrapAvailable)}.`,
		`landlockAvailable=${String(facts.landlockAvailable)}.`,
		`userNamespacesAvailable=${String(facts.userNamespacesAvailable)}.`,
	].join(" ");
}

function formatDistroFacts(distro: PawSandboxDistroFacts): string {
	return distro.version === undefined ? distro.name : `${distro.name} ${distro.version}`;
}
