import type { PawRuntimeConfig, PawTaskClass } from "./contracts.ts";

export type PawModelRoutingRole = keyof PawRuntimeConfig["role_routing"];
export type PawModelTierName = PawRuntimeConfig["role_routing"][PawModelRoutingRole];
export type PawProviderName = keyof PawRuntimeConfig["providers"];
export type PawProviderConfig = PawRuntimeConfig["providers"][PawProviderName];
export type PawModelTier = PawRuntimeConfig["model_tiers"][PawModelTierName];

export type PawResolvedModelRoute = {
	role: PawModelRoutingRole;
	taskClass: PawTaskClass;
	tierName: PawModelTierName;
	providerName: PawProviderName;
	provider: PawProviderConfig;
	model: string;
	thinking: boolean;
};

export type PawFailoverRoute = {
	providerName: PawProviderName;
	provider: PawProviderConfig;
};

export function getPawModelTier(config: PawRuntimeConfig, tierName: PawModelTierName): PawModelTier {
	return config.model_tiers[tierName];
}

export function resolvePawModelRoute(
	config: PawRuntimeConfig,
	role: PawModelRoutingRole,
	taskClass: PawTaskClass,
): PawResolvedModelRoute {
	const tierName = config.role_routing[role];
	const tier = getPawModelTier(config, tierName);
	const providerName = resolvePawProviderName(config, tier.provider);

	return {
		role,
		taskClass,
		tierName,
		providerName,
		provider: config.providers[providerName],
		model: tier.model,
		thinking: isPawThinkingEnabled(config, role, taskClass, tierName),
	};
}

export function isPawThinkingEnabled(
	config: PawRuntimeConfig,
	role: PawModelRoutingRole,
	taskClass: PawTaskClass,
	tierName = config.role_routing[role],
): boolean {
	const tier = getPawModelTier(config, tierName);

	return (
		tier.thinking &&
		config.thinking.enabled_for_classes.includes(taskClass) &&
		config.thinking.enabled_for_roles.includes(role)
	);
}

export function getPawFailoverRoutes(config: PawRuntimeConfig): PawFailoverRoute[] {
	return config.model_tiers.failover_order.map((providerName) => {
		const resolvedProviderName = resolvePawProviderName(config, providerName);

		return {
			providerName: resolvedProviderName,
			provider: config.providers[resolvedProviderName],
		};
	});
}

function resolvePawProviderName(config: PawRuntimeConfig, providerName: string): PawProviderName {
	if (isPawProviderName(config, providerName)) {
		return providerName;
	}

	throw new Error(`Unknown Paw provider "${providerName}" in model routing config.`);
}

function isPawProviderName(config: PawRuntimeConfig, providerName: string): providerName is PawProviderName {
	return Object.hasOwn(config.providers, providerName);
}
