/**
 * Project trust event emit helper (extracted from ExtensionRunner for S3776).
 *
 * Project trust handlers live on the LoadExtensionsResult.extensions list but
 * use a different signature (ProjectTrustContext, not ExtensionContext) and
 * short-circuit on the first yes/no decision.
 */

import { extensionErrorFromUnknown } from "./runner-errors.ts";
import type {
	Extension,
	ExtensionError,
	LoadExtensionsResult,
	ProjectTrustContext,
	ProjectTrustEvent,
	ProjectTrustEventResult,
	ProjectTrustHandler,
} from "./types.ts";

export interface ProjectTrustEmitResult {
	result?: ProjectTrustEventResult;
	errors: ExtensionError[];
}

type ProjectTrustHandlers = ProjectTrustHandler[];

export async function emitProjectTrustAcrossExtensions(
	extensions: Extension[],
	event: ProjectTrustEvent,
	ctx: ProjectTrustContext,
): Promise<ProjectTrustEmitResult> {
	const errors: ExtensionError[] = [];

	for (const ext of extensions) {
		const handlers = ext.handlers.get("project_trust") as ProjectTrustHandlers | undefined;
		if (!handlers || handlers.length === 0) continue;

		const decision = await runProjectTrustHandlersForExtension(event, ctx, ext, handlers, errors);
		if (decision) {
			return { result: decision, errors };
		}
	}

	return { errors };
}

async function runProjectTrustHandlersForExtension(
	event: ProjectTrustEvent,
	ctx: ProjectTrustContext,
	ext: Extension,
	handlers: ProjectTrustHandlers,
	errors: ExtensionError[],
): Promise<ProjectTrustEventResult | undefined> {
	for (const handler of handlers) {
		try {
			const handlerResult = await handler(event, ctx);
			if (handlerResult.trusted === "undecided") {
				continue;
			}
			return handlerResult;
		} catch (err) {
			errors.push(extensionErrorFromUnknown(ext.path, event.type, err));
		}
	}
	return undefined;
}

export async function emitProjectTrustEvent(
	extensionsResult: LoadExtensionsResult,
	event: ProjectTrustEvent,
	ctx: ProjectTrustContext,
): Promise<ProjectTrustEmitResult> {
	return emitProjectTrustAcrossExtensions(extensionsResult.extensions, event, ctx);
}

