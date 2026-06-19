/**
 * Agent-lifecycle emit helpers (extracted from ExtensionRunner for S3776).
 *
 * before_agent_start handlers can chain a systemPrompt override that the
 * runner must expose through ctx.getSystemPrompt for any later handler that
 * reads from the context. This helper owns:
 *   1. cloning the base context so handlers see the live systemPromptState,
 *   2. delegating to the per-handler loop in runner-emit-helpers.ts.
 */

import type { ImageContent } from "@earendil-works/pi-ai";
import type { BuildSystemPromptOptions } from "../system-prompt.ts";
import {
	type EmitErrorFn,
	emitBeforeAgentStartAcrossExtensions,
} from "./runner-emit-helpers.ts";
import type { BeforeAgentStartCombinedResult } from "./runner-types.ts";
import type { Extension, ExtensionContext } from "./types.ts";

export async function emitBeforeAgentStartWithContextOverride(
	extensions: Extension[],
	baseCtx: ExtensionContext,
	prompt: string,
	images: ImageContent[] | undefined,
	systemPrompt: string,
	systemPromptOptions: BuildSystemPromptOptions,
	emitError: EmitErrorFn,
	assertActive: () => void,
): Promise<BeforeAgentStartCombinedResult | undefined> {
	const systemPromptState = { value: systemPrompt };
	const ctx = cloneContextWithSystemPrompt(baseCtx, systemPromptState, assertActive);
	return emitBeforeAgentStartAcrossExtensions(
		extensions,
		ctx,
		prompt,
		images,
		systemPromptState,
		systemPromptOptions,
		emitError,
	);
}

function cloneContextWithSystemPrompt(
	baseCtx: ExtensionContext,
	systemPromptState: { value: string },
	assertActive: () => void,
): ExtensionContext {
	const cloned = Object.defineProperties(
		{},
		Object.getOwnPropertyDescriptors(baseCtx),
	) as ExtensionContext;
	cloned.getSystemPrompt = () => {
		assertActive();
		return systemPromptState.value;
	};
	return cloned;
}
