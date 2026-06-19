import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { loadDefaultPawRuntimeConfig, scanPawRepoForSecrets } from "../src/paw/index.ts";

const tempRoots: string[] = [];
const sourceRoot = join(import.meta.dirname, "..", "..", "..");

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createTempRepo(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "paw-secret-scan-"));
	tempRoots.push(root);
	return root;
}

describe("scanPawRepoForSecrets", () => {
	test("detects API key file", async () => {
		const root = await createTempRepo();
		await mkdir(join(root, "src"), { recursive: true });
		await writeFile(
			join(root, "src/config.ts"),
			`export const api_key = "EXAMPLE_KEY_${"x".repeat(28)}";\n`,
			"utf-8",
		);
		const config = loadDefaultPawRuntimeConfig(sourceRoot);
		const result = await scanPawRepoForSecrets(root, config.secrets, { maxFiles: 50 });
		expect(result.findings.some((f) => f.pattern === "api_keys")).toBe(true);
	});

	test("returns no findings on clean repo", async () => {
		const root = await createTempRepo();
		await mkdir(join(root, "src"), { recursive: true });
		await writeFile(join(root, "src/clean.ts"), "export const a = 1;\n", "utf-8");
		const config = loadDefaultPawRuntimeConfig(sourceRoot);
		const result = await scanPawRepoForSecrets(root, config.secrets, { maxFiles: 50 });
		expect(result.findings).toHaveLength(0);
		expect(result.ok).toBe(true);
	});

	test("blocks on private key material", async () => {
		const root = await createTempRepo();
		await writeFile(
			join(root, "key.pem"),
			"-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAK...\n-----END RSA PRIVATE KEY-----\n",
			"utf-8",
		);
		const config = loadDefaultPawRuntimeConfig(sourceRoot);
		const result = await scanPawRepoForSecrets(root, config.secrets, { maxFiles: 50 });
		expect(result.findings.some((f) => f.pattern === "private_keys")).toBe(true);
		expect(result.blocked).toBe(true);
	});
});
