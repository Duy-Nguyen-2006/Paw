/**
 * Shared compaction persistence after manual or auto compaction (reduces duplicate branches).
 */

import type { Agent } from "@earendil-works/pi-agent-core";
import type { CompactionResult } from "./compaction/index.ts";
import type { ExtensionRunner } from "./extensions/index.ts";
import type { CompactionEntry, SessionManager } from "./session-manager.ts";

export interface AppliedCompactionOutcome {
	compactionResult: CompactionResult;
	savedCompactionEntry: CompactionEntry | undefined;
}

export function applyCompactionToSession(
	sessionManager: SessionManager,
	agent: Agent,
	summary: string,
	firstKeptEntryId: string,
	tokensBefore: number,
	details: unknown,
	fromExtension: boolean,
): AppliedCompactionOutcome {
	sessionManager.appendCompaction(summary, firstKeptEntryId, tokensBefore, details, fromExtension);
	const newEntries = sessionManager.getEntries();
	const sessionContext = sessionManager.buildSessionContext();
	agent.state.messages = sessionContext.messages;

	const savedCompactionEntry = newEntries.find((e) => e.type === "compaction" && e.summary === summary) as
		| CompactionEntry
		| undefined;

	return {
		compactionResult: { summary, firstKeptEntryId, tokensBefore, details },
		savedCompactionEntry,
	};
}

export async function emitCompactionExtensionEvents(
	extensionRunner: ExtensionRunner,
	savedCompactionEntry: CompactionEntry | undefined,
	fromExtension: boolean,
): Promise<void> {
	if (!extensionRunner || !savedCompactionEntry) {
		return;
	}
	await extensionRunner.emit({
		type: "session_compact",
		compactionEntry: savedCompactionEntry,
		fromExtension,
	});
}
