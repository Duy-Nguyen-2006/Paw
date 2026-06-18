
import type { PawValidationIssue } from "./contracts.ts";

export type PawResilienceDrillEventName =
	| "provider_failure"
	| "retry_attempted"
	| "failover_started"
	| "degraded_marked"
	| "resume_started"
	| "resume_completed"
	| "final_report_emitted"
	| "no_data_loss_confirmed"
	| "data_loss_detected";

export type PawResilienceDrillEvent = {
	name: PawResilienceDrillEventName;
};

export type PawResilienceDrillInput = {
	events: readonly PawResilienceDrillEvent[];
	providerName?: string;
	sessionId?: string;
};

export type PawResilienceDrillResult =
	| {
			ok: true;
			status: "PASS";
			evidence: string;
			issues: readonly [];
	  }
	| {
			ok: false;
			status: "KILL";
			evidence: string;
			issues: readonly PawValidationIssue[];
	  };

type RequiredDrillEvent = Exclude<
	PawResilienceDrillEventName,
	"retry_attempted" | "resume_started" | "data_loss_detected"
>;

const REQUIRED_DRILL_EVENTS: readonly RequiredDrillEvent[] = [
	"provider_failure",
	"failover_started",
	"degraded_marked",
	"resume_completed",
	"final_report_emitted",
	"no_data_loss_confirmed",
];

export function evaluatePawResilienceDrill(input: PawResilienceDrillInput): PawResilienceDrillResult {
	const eventNames = new Set(input.events.map((event) => event.name));
	const issues: PawValidationIssue[] = [];

	for (const eventName of REQUIRED_DRILL_EVENTS) {
		if (!eventNames.has(eventName)) {
			issues.push(getMissingEventIssue(eventName));
		}
	}

	if (eventNames.has("data_loss_detected")) {
		issues.push({
			path: "/events/data_loss_detected",
			message: "Data loss detected during provider resilience drill.",
		});
	}

	const evidence = formatResilienceDrillEvidence(input, eventNames);

	if (issues.length > 0) {
		return {
			ok: false,
			status: "KILL",
			evidence,
			issues,
		};
	}

	return {
		ok: true,
		status: "PASS",
		evidence,
		issues: [],
	};
}

function getMissingEventIssue(eventName: RequiredDrillEvent): PawValidationIssue {
	switch (eventName) {
		case "provider_failure":
			return {
				path: "/events/provider_failure",
				message: "Missing provider failure event.",
			};
		case "failover_started":
			return {
				path: "/events/failover_started",
				message: "Missing failover after provider failure.",
			};
		case "degraded_marked":
			return {
				path: "/events/degraded_marked",
				message: "Missing degraded flag after provider failure.",
			};
		case "resume_completed":
			return {
				path: "/events/resume_completed",
				message: "Missing resume completion after failover.",
			};
		case "final_report_emitted":
			return {
				path: "/events/final_report_emitted",
				message: "Missing final report emission after resume.",
			};
		case "no_data_loss_confirmed":
			return {
				path: "/events/no_data_loss_confirmed",
				message: "Missing no-data-loss confirmation.",
			};
	}
}

function formatResilienceDrillEvidence(
	input: PawResilienceDrillInput,
	eventNames: ReadonlySet<PawResilienceDrillEventName>,
): string {
	const provider = input.providerName === undefined ? "unknown provider" : input.providerName;
	const session = input.sessionId === undefined ? "unknown session" : input.sessionId;

	return [
		`Injected provider resilience drill evidence for ${provider} in ${session}.`,
		`provider failure=${formatObserved(eventNames.has("provider_failure"))}.`,
		`failover=${formatObserved(eventNames.has("failover_started"))}.`,
		`degraded flag=${formatObserved(eventNames.has("degraded_marked"))}.`,
		`resume=${formatObserved(eventNames.has("resume_completed"))}.`,
		`final report=${formatObserved(eventNames.has("final_report_emitted"))}.`,
		`no-data-loss confirmation=${formatObserved(eventNames.has("no_data_loss_confirmed"))}.`,
		`data loss=${eventNames.has("data_loss_detected") ? "detected" : "not detected"}.`,
	].join(" ");
}

function formatObserved(observed: boolean): string {
	return observed ? "observed" : "missing";
}
