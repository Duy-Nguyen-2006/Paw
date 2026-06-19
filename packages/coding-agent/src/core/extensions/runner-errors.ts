/**
 * Extension handler error reporting helpers.
 */

import type { ExtensionError } from "./types.ts";

export function extensionErrorFromUnknown(extensionPath: string, event: string, err: unknown): ExtensionError {
	return {
		extensionPath,
		event,
		error: err instanceof Error ? err.message : String(err),
		stack: err instanceof Error ? err.stack : undefined,
	};
}
