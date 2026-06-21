/**
 * Session-related emit helpers (extracted from ExtensionRunner for S3776).
 *
 * Covers the generic `emit<TEvent>` dispatcher and the `session_shutdown`
 * event. Both delegate to processSessionBeforeHandlersForExtension for the
 * per-extension work; the helpers only own the top-level loops and the
 * cancellation short-circuit.
 */

import type { EmitDispatchFn, EmitErrorFn } from "./runner-emit-helpers.ts";
import { processSessionBeforeHandlersForExtension } from "./runner-emit-helpers.ts";
import type { RunnerEmitEvent, RunnerEmitResult, SessionBeforeEventResult } from "./runner-types.ts";
import type { Extension, ExtensionContext, SessionShutdownEvent } from "./types.ts";

export async function emitSessionShutdownAcrossExtensions(
	hasHandlers: (eventType: string) => boolean,
	dispatch: EmitDispatchFn<SessionShutdownEvent>,
	event: SessionShutdownEvent,
): Promise<boolean> {
	if (hasHandlers("session_shutdown")) {
		await dispatch(event);
		return true;
	}
	return false;
}

export async function emitRunnerEventAcrossExtensions<TEvent extends RunnerEmitEvent>(
	extensions: Extension[],
	ctx: ExtensionContext,
	event: TEvent,
	emitError: EmitErrorFn,
): Promise<RunnerEmitResult<TEvent>> {
	let result: SessionBeforeEventResult | undefined;

	for (const ext of extensions) {
		result = await processExtensionHandlersForEvent(extensions, ctx, event, ext, result, emitError);
		if (result?.cancel) {
			return result as RunnerEmitResult<TEvent>;
		}
	}

	return result as RunnerEmitResult<TEvent>;
}

async function processExtensionHandlersForEvent<TEvent extends RunnerEmitEvent>(
	_extensions: Extension[],
	ctx: ExtensionContext,
	event: TEvent,
	ext: Extension,
	result: SessionBeforeEventResult | undefined,
	emitError: EmitErrorFn,
): Promise<SessionBeforeEventResult | undefined> {
	const handlers = ext.handlers.get(event.type);
	if (!handlers?.length) {
		return result;
	}
	return processSessionBeforeHandlersForExtension(event, ctx, ext, handlers, result, emitError);
}
