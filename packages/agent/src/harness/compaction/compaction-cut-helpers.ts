/**
 * Compaction cut-point helpers (extracted from compaction.ts for S3776).
 */

import type { AgentMessage } from "../../types.ts";
import type { SessionTreeEntry } from "../types.ts";

export function isCompactionCutMessageRole(role: string): boolean {
	return (
		role === "bashExecution" ||
		role === "custom" ||
		role === "branchSummary" ||
		role === "compactionSummary" ||
		role === "user" ||
		role === "assistant"
	);
}

export function findValidCutPoints(entries: SessionTreeEntry[], startIndex: number, endIndex: number): number[] {
	const cutPoints: number[] = [];
	for (let i = startIndex; i < endIndex; i++) {
		const entry = entries[i];
		if (entry.type === "message") {
			const role = entry.message.role;
			if (isCompactionCutMessageRole(role)) {
				cutPoints.push(i);
			}
			continue;
		}
		if (entry.type === "branch_summary" || entry.type === "custom_message") {
			cutPoints.push(i);
		}
	}
	return cutPoints;
}

export function selectCutIndex(
	entries: SessionTreeEntry[],
	startIndex: number,
	endIndex: number,
	cutPoints: number[],
	keepRecentTokens: number,
	estimateMessageTokens: (message: AgentMessage) => number,
): number {
	let accumulatedTokens = 0;
	let cutIndex = cutPoints[0];

	for (let i = endIndex - 1; i >= startIndex; i--) {
		const entry = entries[i];
		if (entry.type !== "message") continue;
		const messageTokens = estimateMessageTokens(entry.message);
		accumulatedTokens += messageTokens;
		if (accumulatedTokens >= keepRecentTokens) {
			for (let c = 0; c < cutPoints.length; c++) {
				if (cutPoints[c] >= i) {
					cutIndex = cutPoints[c];
					break;
				}
			}
			break;
		}
	}
	return cutIndex;
}

export function adjustCutIndexToAllowedBoundary(
	entries: SessionTreeEntry[],
	startIndex: number,
	cutIndex: number,
): number {
	let adjusted = cutIndex;
	while (adjusted > startIndex) {
		const prevEntry = entries[adjusted - 1];
		if (prevEntry.type === "compaction" || prevEntry.type === "message") {
			break;
		}
		adjusted--;
	}
	return adjusted;
}
