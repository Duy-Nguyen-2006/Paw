/**
 * Message-lifecycle emit helpers (extracted from ExtensionRunner for S3776).
 *
 * message_end handlers can replace the finalized message as long as the role
 * matches. The helper owns the top-level loop, the running modified flag, and
 * the per-extension delegation to runMessageEndHandlersForExtension.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { type EmitErrorFn, runMessageEndHandlersForExtension } from "./runner-emit-helpers.ts";
import type { Extension, ExtensionContext, MessageEndEvent } from "./types.ts";

export async function emitMessageEndAcrossExtensions(
	extensions: Extension[],
	ctx: ExtensionContext,
	event: MessageEndEvent,
	emitError: EmitErrorFn,
): Promise<AgentMessage | undefined> {
	let currentMessage = event.message;
	let modified = false;

	for (const ext of extensions) {
		const result = await runMessageEndHandlersForExtension(event, ctx, ext, currentMessage, emitError);
		currentMessage = result.message;
		if (result.modified) {
			modified = true;
		}
	}

	return modified ? currentMessage : undefined;
}
