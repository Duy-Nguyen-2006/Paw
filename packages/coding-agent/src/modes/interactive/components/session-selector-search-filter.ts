/**
 * Session filter/sort helpers (reduces filterAndSortSessions S3776).
 */

import type { SessionInfo } from "../../../core/session-manager.ts";

import type { MatchResult, NameFilter, ParsedSearchQuery, SortMode } from "./session-selector-search.ts";

/** Apply the name filter to a session list. */
export function applyNameFilter(sessions: SessionInfo[], nameFilter: NameFilter): SessionInfo[] {
	if (nameFilter === "all") return sessions;
	return sessions.filter((session) => Boolean(session.name?.trim()));
}

/** Filter sessions in incoming order, preserving the source order (no scoring/sorting). */
export function filterSessionsPreserveOrder(
	sessions: SessionInfo[],
	parsed: ParsedSearchQuery,
	matchFn: (s: SessionInfo, parsed: ParsedSearchQuery) => MatchResult,
): SessionInfo[] {
	const out: SessionInfo[] = [];
	for (const s of sessions) {
		const res = matchFn(s, parsed);
		if (res.matches) out.push(s);
	}
	return out;
}

/** Score all sessions, drop non-matches, and sort by score with modified-desc tiebreak. */
export function sortSessionsByScore(
	sessions: SessionInfo[],
	parsed: ParsedSearchQuery,
	matchFn: (s: SessionInfo, parsed: ParsedSearchQuery) => MatchResult,
): SessionInfo[] {
	const scored: { session: SessionInfo; score: number }[] = [];
	for (const s of sessions) {
		const res = matchFn(s, parsed);
		if (!res.matches) continue;
		scored.push({ session: s, score: res.score });
	}

	scored.sort((a, b) => {
		if (a.score !== b.score) return a.score - b.score;
		return b.session.modified.getTime() - a.session.modified.getTime();
	});

	return scored.map((r) => r.session);
}

/** Pick a sort strategy based on the requested mode. */
export function pickSessionSortStrategy(sortMode: SortMode): "preserve" | "relevance" {
	return sortMode === "recent" ? "preserve" : "relevance";
}
