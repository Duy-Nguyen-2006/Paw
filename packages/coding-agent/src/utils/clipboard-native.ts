import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export type ClipboardModule = {
	setText: (text: string) => Promise<void>;
	hasImage: () => boolean;
	getImageBinary: () => Promise<Array<number>>;
};

type ClipboardRequire = (id: string) => unknown;

const moduleRequire = createRequire(import.meta.url);
const executableDirRequire = createRequire(pathToFileURL(join(dirname(process.execPath), "package.json")).href);
const hasDisplay = process.platform !== "linux" || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);

export function loadClipboardNative(
	requires: readonly ClipboardRequire[] = [moduleRequire, executableDirRequire],
): ClipboardModule | null {
	for (const requireClipboard of requires) {
		try {
			return requireClipboard("@mariozechner/clipboard") as ClipboardModule;
		} catch {
			// Try the next resolution root.
		}
	}
	return null;
}

const clipboard = !process.env.TERMUX_VERSION && hasDisplay ? loadClipboardNative() : null;

export { clipboard };
