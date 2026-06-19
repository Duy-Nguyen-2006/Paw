import type { PawSessionLockStaleReason } from "./session-store.ts";

export type PawNotLockedCommandFields = {
	status: "not_locked";
	sessionId: string;
	reason: "unlocked" | "stale";
	staleReason?: PawSessionLockStaleReason;
	lockReleased: boolean;
};

export function mapPawNotLockedCommandFields(
	sessionId: string,
	reason: "unlocked" | "stale",
	lockReleased: boolean,
	staleReason?: PawSessionLockStaleReason,
): PawNotLockedCommandFields {
	if (reason === "stale") {
		return {
			status: "not_locked",
			sessionId,
			reason: "stale",
			staleReason,
			lockReleased,
		};
	}
	return {
		status: "not_locked",
		sessionId,
		reason: "unlocked",
		lockReleased,
	};
}
