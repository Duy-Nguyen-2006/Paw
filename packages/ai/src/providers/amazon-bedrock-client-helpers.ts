/**
 * Bedrock runtime client configuration (extracted from amazon-bedrock.ts for S3776).
 */

import { BedrockRuntimeClient, type BedrockRuntimeClientConfig } from "@aws-sdk/client-bedrock-runtime";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import type { Model } from "../types.ts";
import { createHttpProxyAgentsForTarget } from "../utils/node-http-proxy.ts";
import type { BedrockOptions } from "./amazon-bedrock.ts";

export function getConfiguredBedrockRegion(options: { region?: string }): string | undefined {
	if (typeof process === "undefined") {
		return options.region;
	}
	return options.region || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || undefined;
}

export function hasConfiguredBedrockProfile(): boolean {
	if (typeof process === "undefined") {
		return false;
	}
	return Boolean(process.env.AWS_PROFILE);
}

export function getStandardBedrockEndpointRegion(baseUrl: string | undefined): string | undefined {
	if (!baseUrl) {
		return undefined;
	}
	try {
		const { hostname } = new URL(baseUrl);
		const match = hostname.toLowerCase().match(/^bedrock-runtime(?:-fips)?\.([a-z0-9-]+)\.amazonaws\.com(?:\.cn)?$/);
		return match?.[1];
	} catch {
		return undefined;
	}
}

export function shouldUseExplicitBedrockEndpoint(
	baseUrl: string,
	configuredRegion: string | undefined,
	hasConfiguredProfile: boolean,
): boolean {
	const endpointRegion = getStandardBedrockEndpointRegion(baseUrl);
	if (!endpointRegion) {
		return true;
	}
	return !configuredRegion && !hasConfiguredProfile;
}

export function buildBedrockRuntimeClientConfig(
	model: Model<"bedrock-converse-stream">,
	options: BedrockOptions,
): BedrockRuntimeClientConfig {
	const config: BedrockRuntimeClientConfig = {
		profile: options.profile,
	};
	const configuredRegion = getConfiguredBedrockRegion(options);
	const hasConfiguredProfile = hasConfiguredBedrockProfile();
	const endpointRegion = getStandardBedrockEndpointRegion(model.baseUrl);
	const useExplicitEndpoint = shouldUseExplicitBedrockEndpoint(model.baseUrl, configuredRegion, hasConfiguredProfile);

	if (useExplicitEndpoint) {
		config.endpoint = model.baseUrl;
	}

	const bearerToken = options.bearerToken || process.env.AWS_BEARER_TOKEN_BEDROCK || undefined;
	const useBearerToken = bearerToken !== undefined && process.env.AWS_BEDROCK_SKIP_AUTH !== "1";

	applyBedrockNodeRuntimeConfig(config, model, {
		configuredRegion,
		hasConfiguredProfile,
		endpointRegion,
		useExplicitEndpoint,
	});

	if (useBearerToken) {
		config.token = { token: bearerToken };
		config.authSchemePreference = ["httpBearerAuth"];
	}

	return config;
}

export function createBedrockRuntimeClient(
	model: Model<"bedrock-converse-stream">,
	options: BedrockOptions,
): BedrockRuntimeClient {
	return new BedrockRuntimeClient(buildBedrockRuntimeClientConfig(model, options));
}

function applyBedrockNodeRuntimeConfig(
	config: BedrockRuntimeClientConfig,
	model: Model<"bedrock-converse-stream">,
	ctx: {
		configuredRegion: string | undefined;
		hasConfiguredProfile: boolean;
		endpointRegion: string | undefined;
		useExplicitEndpoint: boolean;
	},
): void {
	if (typeof process !== "undefined" && (process.versions?.node || process.versions?.bun)) {
		const arnRegionMatch = model.id.match(/^arn:aws(?:-[a-z0-9-]+)?:bedrock:([a-z0-9-]+):/);
		if (arnRegionMatch) {
			config.region = arnRegionMatch[1];
		} else if (ctx.configuredRegion) {
			config.region = ctx.configuredRegion;
		} else if (ctx.endpointRegion && ctx.useExplicitEndpoint) {
			config.region = ctx.endpointRegion;
		} else if (!ctx.hasConfiguredProfile) {
			config.region = "us-east-1";
		}

		if (process.env.AWS_BEDROCK_SKIP_AUTH === "1") {
			config.credentials = {
				accessKeyId: "dummy-access-key",
				secretAccessKey: "dummy-secret-key",
			};
		}

		const proxyAgents = createHttpProxyAgentsForTarget(model.baseUrl);
		if (proxyAgents) {
			config.requestHandler = new NodeHttpHandler(proxyAgents);
		} else if (process.env.AWS_BEDROCK_FORCE_HTTP1 === "1") {
			config.requestHandler = new NodeHttpHandler();
		}
		return;
	}

	config.region =
		ctx.configuredRegion ||
		(ctx.endpointRegion && ctx.useExplicitEndpoint ? ctx.endpointRegion : undefined) ||
		"us-east-1";
}
