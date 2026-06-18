
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const aiSrcIndex = fileURLToPath(new URL("../ai/src/index.ts", import.meta.url));
const aiSrcOAuth = fileURLToPath(new URL("../ai/src/oauth.ts", import.meta.url));
const agentSrcIndex = fileURLToPath(new URL("../agent/src/index.ts", import.meta.url));
const tuiSrcIndex = fileURLToPath(new URL("../tui/src/index.ts", import.meta.url));

const sourceAliases = [
	{ find: /^@earendil-works\/pi-ai$/, replacement: aiSrcIndex },
	{ find: /^@earendil-works\/pi-ai\/oauth$/, replacement: aiSrcOAuth },
	{ find: /^@earendil-works\/pi-agent-core$/, replacement: agentSrcIndex },
	{ find: /^@earendil-works\/pi-tui$/, replacement: tuiSrcIndex },
	{ find: /^@mariozechner\/pi-ai$/, replacement: aiSrcIndex },
	{ find: /^@mariozechner\/pi-ai\/oauth$/, replacement: aiSrcOAuth },
	{ find: /^@mariozechner\/pi-agent-core$/, replacement: agentSrcIndex },
	{ find: /^@mariozechner\/pi-tui$/, replacement: tuiSrcIndex },
];

export default defineConfig({
	plugins: [
		{
			name: "pi-extension-import-meta-resolve",
			transform(code, id) {
				if (!id.endsWith("src/core/extensions/loader.ts")) return;
				return code.replace(/import\.meta\.resolve/g, "globalThis.__piVitestImportMetaResolve");
			},
		},
	],
	test: {
		globals: true,
		environment: "node",
		testTimeout: 30000,
		setupFiles: [fileURLToPath(new URL("./test/vitest.setup.ts", import.meta.url))],
		server: {
			deps: {
				external: [/@silvia-odwyer\/photon-node/],
			},
		},
	},
	resolve: {
		alias: sourceAliases,
	},
});
