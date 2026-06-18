
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const sourceEntries = new Map<string, string>([
	["@earendil-works/pi-agent-core", new URL("../../agent/src/index.ts", import.meta.url).href],
	["@earendil-works/pi-ai", new URL("../../ai/src/index.ts", import.meta.url).href],
	["@earendil-works/pi-ai/oauth", new URL("../../ai/src/oauth.ts", import.meta.url).href],
	["@earendil-works/pi-tui", new URL("../../tui/src/index.ts", import.meta.url).href],
	["@mariozechner/pi-agent-core", new URL("../../agent/src/index.ts", import.meta.url).href],
	["@mariozechner/pi-ai", new URL("../../ai/src/index.ts", import.meta.url).href],
	["@mariozechner/pi-ai/oauth", new URL("../../ai/src/oauth.ts", import.meta.url).href],
	["@mariozechner/pi-tui", new URL("../../tui/src/index.ts", import.meta.url).href],
]);

Object.defineProperty(globalThis, "__piVitestImportMetaResolve", {
	configurable: true,
	value: (specifier: string) =>
		sourceEntries.get(specifier) ?? new URL(require.resolve(specifier), import.meta.url).href,
});
