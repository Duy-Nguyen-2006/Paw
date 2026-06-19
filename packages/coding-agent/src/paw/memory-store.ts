import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

export interface PawMemoryEntry {
	id: string;
	key: string;
	value: string;
	tags: readonly string[];
	created_at: string;
	expires_at: string | null;
}

export interface PawMemoryStoreConfig {
	retentionDays: number;
	allowExternal: boolean;
	deduplicateByHash: boolean;
}

export const DEFAULT_PAW_MEMORY_CONFIG: PawMemoryStoreConfig = {
	retentionDays: 90,
	allowExternal: false,
	deduplicateByHash: true,
};

export interface PawMemoryRecordInput {
	key: string;
	value: string;
	tags?: readonly string[];
	ttlSec?: number;
}

export interface PawMemoryStore {
	add(input: PawMemoryRecordInput): Promise<PawMemoryEntry>;
	get(key: string): Promise<PawMemoryEntry | null>;
	listByTag(tag: string): Promise<readonly PawMemoryEntry[]>;
	prune(now?: Date): Promise<number>;
}

interface PawMemoryFile {
	version: 1;
	entries: PawMemoryEntry[];
}

export class PawFileMemoryStore implements PawMemoryStore {
	private readonly filePath: string;
	private cache: PawMemoryFile | null = null;
	private readonly now: () => Date;
	private readonly config: PawMemoryStoreConfig;

	constructor(options: { filePath: string; config?: PawMemoryStoreConfig; now?: () => Date }) {
		this.filePath = options.filePath;
		this.config = options.config ?? DEFAULT_PAW_MEMORY_CONFIG;
		this.now = options.now ?? (() => new Date());
	}

	async add(input: PawMemoryRecordInput): Promise<PawMemoryEntry> {
		const file = await this.load();
		const id = this.makeId(input.key, input.value);
		const createdAt = this.now();
		const expiresAt = input.ttlSec !== undefined ? new Date(createdAt.getTime() + input.ttlSec * 1000).toISOString() : null;
		const entry: PawMemoryEntry = {
			id,
			key: input.key,
			value: input.value,
			tags: input.tags ?? [],
			created_at: createdAt.toISOString(),
			expires_at: expiresAt,
		};
		const existingIndex = file.entries.findIndex((existing) => existing.id === id);
		if (existingIndex !== -1) {
			file.entries[existingIndex] = entry;
		} else {
			file.entries.push(entry);
		}
		await this.persist(file);
		return entry;
	}

	async get(key: string): Promise<PawMemoryEntry | null> {
		const file = await this.load();
		return file.entries.find((entry) => entry.key === key) ?? null;
	}

	async listByTag(tag: string): Promise<readonly PawMemoryEntry[]> {
		const file = await this.load();
		return file.entries.filter((entry) => entry.tags.includes(tag));
	}

	async prune(now: Date = new Date()): Promise<number> {
		const file = await this.load();
		const before = file.entries.length;
		file.entries = file.entries.filter((entry) => entry.expires_at === null || new Date(entry.expires_at) > now);
		if (file.entries.length !== before) {
			await this.persist(file);
		}
		return before - file.entries.length;
	}

	private async load(): Promise<PawMemoryFile> {
		if (this.cache !== null) return this.cache;
		try {
			const content = await readFile(this.filePath, "utf-8");
			const parsed = JSON.parse(content) as PawMemoryFile;
			this.cache = parsed;
			return parsed;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				const initial: PawMemoryFile = { version: 1, entries: [] };
				this.cache = initial;
				return initial;
			}
			throw error;
		}
	}

	private async persist(file: PawMemoryFile): Promise<void> {
		await writeFile(this.filePath, JSON.stringify(file, null, 2), "utf-8");
		this.cache = file;
	}

	private makeId(key: string, value: string): string {
		return `sha256:${createHash("sha256").update(`${key}\n${value}`).digest("hex")}`;
	}
}

export async function createPawFileMemoryStore(repoRoot: string, config: PawMemoryStoreConfig = DEFAULT_PAW_MEMORY_CONFIG): Promise<PawFileMemoryStore> {
	const filePath = join(repoRoot, ".paw", "memory.json");
	return new PawFileMemoryStore({ filePath, config });
}

export const _pawMemoryDirectoryHelpers = { dirname };
