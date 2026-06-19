import { readFile } from "node:fs/promises";
import { APP_NAME } from "../config.ts";
import { evaluatePawCostLatencyCache, type PawCostLatencyCacheResult } from "./cost-latency-cache.ts";
import { readPawEventLog, type PawEventLogEntry } from "./event-log.ts";
import { readPawSessionState } from "./session-store.ts";
import type { PawTaskClass } from "./contracts.ts";

export interface PawCostParsedArgs {
	sessionId: string;
	taskClass: PawTaskClass;
	json: boolean;
}

export type PawCostParseResult =
	| { kind: "help" }
	| { kind: "error"; message: string }
	| { kind: "ok"; args: PawCostParsedArgs };

export interface PawCostEntry {
	sliceId: string | null;
	tokens: number;
	usd: number;
	providerClass: "hosted" | "local";
	cacheHitRate: number | null;
	timestamp: string;
}

export interface PawCostResult {
	sessionId: string;
	taskClass: PawTaskClass;
	totalUsd: number;
	totalTokens: number;
	entries: PawCostEntry[];
	advisory: PawCostLatencyCacheResult;
}

export function parsePawCostArgs(args: string[]): PawCostParseResult {
	if (args.length === 0) {
		return { kind: "help" };
	}
	if (args[0] === "--help" || args[0] === "-h") {
		return { kind: "help" };
	}
	let sessionId: string | null = null;
	let taskClass: PawTaskClass = "standard";
	let json = false;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--class") {
			const value = args[index + 1];
			if (value !== "trivial" && value !== "standard" && value !== "high_risk") {
				return { kind: "error", message: `Invalid --class value: ${value}` };
			}
			taskClass = value;
			index += 1;
		} else if (arg === "--json") {
			json = true;
		} else if (arg.startsWith("--")) {
			return { kind: "error", message: `Unknown option for "paw cost": ${arg}` };
		} else if (sessionId === null) {
			sessionId = arg;
		} else {
			return { kind: "error", message: `Unexpected positional argument: ${arg}` };
		}
	}
	if (sessionId === null) {
		return { kind: "error", message: "Missing <session-id> for paw cost" };
	}
	return { kind: "ok", args: { sessionId, taskClass, json } };
}

export async function runPawCostCommand(args: string[]): Promise<void> {
	const parsed = parsePawCostArgs(args);
	if (parsed.kind === "help") {
		printPawCostHelp();
		return;
	}
	if (parsed.kind === "error") {
		console.error(`Error: ${parsed.message}`);
		process.exitCode = 1;
		return;
	}
	try {
		const result = await createPawCostResult(parsed.args);
		if (parsed.args.json) {
			console.log(JSON.stringify(result, null, 2));
		} else {
			console.log(formatPawCostResult(result));
		}
	} catch (error) {
		console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
}

export async function createPawCostResult(args: PawCostParsedArgs): Promise<PawCostResult> {
	const repoRoot = process.cwd();
	const events: PawEventLogEntry[] = await readPawEventLog(repoRoot, args.sessionId);
	const costEvents = events.filter((event) => event.event === "cost_recorded");
	const entries: PawCostEntry[] = costEvents.map((event) => {
		const data = (event.data ?? {}) as { tokens?: number; usd?: number; providerClass?: "hosted" | "local"; cacheHitRate?: number };
		return {
			sliceId: event.slice_id,
			tokens: data.tokens ?? 0,
			usd: data.usd ?? 0,
			providerClass: data.providerClass ?? "hosted",
			cacheHitRate: data.cacheHitRate ?? null,
			timestamp: event.ts,
		};
	});
	const totalUsd = entries.reduce((acc, entry) => acc + entry.usd, 0);
	const totalTokens = entries.reduce((acc, entry) => acc + entry.tokens, 0);
	const cacheRates = entries.map((entry) => entry.cacheHitRate).filter((rate): rate is number => rate !== null);
	const averageCacheHit = cacheRates.length > 0 ? cacheRates.reduce((acc, rate) => acc + rate, 0) / cacheRates.length : undefined;
	try {
		await readPawSessionState(repoRoot, args.sessionId);
	} catch {
		// tolerate missing state
	}
	const advisory = evaluatePawCostLatencyCache({
		metrics: {
			taskClass: args.taskClass,
			usdUsed: totalUsd,
			inputTokens: totalTokens,
			activeTimeSec: 0,
			providerClass: "hosted",
			...(averageCacheHit !== undefined ? { cacheHitRate: averageCacheHit } : {}),
		},
	});
	return {
		sessionId: args.sessionId,
		taskClass: args.taskClass,
		totalUsd,
		totalTokens,
		entries,
		advisory,
	};
}

export function formatPawCostResult(result: PawCostResult): string {
	const lines = [
		"Paw cost",
		`session: ${result.sessionId}`,
		`class: ${result.taskClass}`,
		`total usd: ${result.totalUsd.toFixed(4)}`,
		`total tokens: ${result.totalTokens}`,
		`advisory: ${result.advisory.status} - ${result.advisory.evidence}`,
	];
	if (result.entries.length === 0) {
		lines.push("entries: (none)");
	} else {
		for (const entry of result.entries) {
			lines.push(`  ${entry.timestamp} slice=${entry.sliceId ?? "-"} usd=${entry.usd.toFixed(4)} tokens=${entry.tokens} provider=${entry.providerClass}${entry.cacheHitRate !== null ? ` cache=${entry.cacheHitRate.toFixed(2)}` : ""}`);
		}
	}
	return lines.join("\n");
}

function printPawCostHelp(): void {
	console.log(`Usage:
  ${APP_NAME} paw cost <session-id> [--class trivial|standard|high_risk] [--json]

Show Paw session cost aggregation.
`);
}

// readFile kept for future extension to load provider cost registry.
export const _pawCostReadFile = readFile;
