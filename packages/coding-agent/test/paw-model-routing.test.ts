
import { describe, expect, test } from "vitest";
import {
	getPawFailoverRoutes,
	isPawThinkingEnabled,
	loadDefaultPawRuntimeConfig,
	resolvePawModelRoute,
} from "../src/paw/index.ts";

describe("Paw model routing policy", () => {
	test("uses loaded default role routing tiers", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(config.role_routing.classify).toBe("cheap");
		expect(config.role_routing.scout_rank).toBe("mid");
		expect(config.role_routing.planner).toBe("strong");
		expect(config.role_routing.reviewer).toBe("strong");
		expect(config.role_routing.worker_highrisk).toBe("strong");
	});

	test("resolves classify standard route to cheap primary fast model without thinking", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(resolvePawModelRoute(config, "classify", "standard")).toEqual({
			role: "classify",
			taskClass: "standard",
			tierName: "cheap",
			providerName: "primary",
			provider: config.providers.primary,
			model: "<configured-fast-model>",
			thinking: false,
		});
	});

	test("resolves scout rank standard route to mid primary configured mid model", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(resolvePawModelRoute(config, "scout_rank", "standard")).toMatchObject({
			role: "scout_rank",
			taskClass: "standard",
			tierName: "mid",
			providerName: "primary",
			provider: config.providers.primary,
			model: "<configured-mid-model>",
			thinking: false,
		});
	});

	test("enables thinking for planner high risk strong route", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(resolvePawModelRoute(config, "planner", "high_risk")).toMatchObject({
			tierName: "strong",
			model: "<configured-strong-model>",
			thinking: true,
		});
	});

	test("does not enable thinking for planner standard because class gate fails", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(isPawThinkingEnabled(config, "planner", "standard")).toBe(false);
		expect(resolvePawModelRoute(config, "planner", "standard")).toMatchObject({
			tierName: "strong",
			thinking: false,
		});
	});

	test("does not enable thinking for worker high risk when role gate fails", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(resolvePawModelRoute(config, "worker_highrisk", "high_risk")).toMatchObject({
			tierName: "strong",
			thinking: false,
		});
	});

	test("enables thinking for reviewer high risk strong route", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(isPawThinkingEnabled(config, "reviewer", "high_risk")).toBe(true);
		expect(resolvePawModelRoute(config, "reviewer", "high_risk")).toMatchObject({
			tierName: "strong",
			thinking: true,
		});
	});

	test("resolves failover routes in configured provider order", () => {
		const config = loadDefaultPawRuntimeConfig();

		expect(getPawFailoverRoutes(config)).toEqual([
			{
				providerName: "secondary",
				provider: {
					adapter: "hosted_b",
					base_url_env: "PAW_PROVIDER_B_URL",
					api_key_env: "PAW_PROVIDER_B_KEY",
				},
			},
			{
				providerName: "local",
				provider: {
					adapter: "ollama",
					base_url: "http://localhost:11434",
					optional: true,
				},
			},
		]);
	});
});
