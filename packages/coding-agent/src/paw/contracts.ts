import { type Static, Type } from "typebox";

export type PawValidationIssue = {
	path: string;
	message: string;
};

export type PawValidationResult<T> =
	| {
			ok: true;
			value: T;
	  }
	| {
			ok: false;
			issues: PawValidationIssue[];
	  };

const RiskLevelSchema = Type.Union([
	Type.Literal("R0"),
	Type.Literal("R1"),
	Type.Literal("R2"),
	Type.Literal("R3"),
	Type.Literal("R4"),
	Type.Literal("R5"),
	Type.Literal("R6"),
	Type.Literal("R7"),
]);

const TaskClassSchema = Type.Union([Type.Literal("trivial"), Type.Literal("standard"), Type.Literal("high_risk")]);

const AgentRoleSchema = Type.Union([
	Type.Literal("scout"),
	Type.Literal("planner"),
	Type.Literal("worker"),
	Type.Literal("reviewer"),
]);

const TierNameSchema = Type.Union([Type.Literal("cheap"), Type.Literal("mid"), Type.Literal("strong")]);

const ProviderSchema = Type.Object(
	{
		adapter: Type.String({ minLength: 1 }),
		base_url_env: Type.Optional(Type.String({ minLength: 1 })),
		api_key_env: Type.Optional(Type.String({ minLength: 1 })),
		base_url: Type.Optional(Type.String({ minLength: 1 })),
		optional: Type.Optional(Type.Boolean()),
	},
	{ additionalProperties: false },
);

const ModelTierSchema = Type.Object(
	{
		provider: Type.String({ minLength: 1 }),
		model: Type.String({ minLength: 1 }),
		thinking: Type.Boolean(),
	},
	{ additionalProperties: false },
);

const ClassNumberMapSchema = Type.Object(
	{
		trivial: Type.Number(),
		standard: Type.Number(),
		high_risk: Type.Number(),
	},
	{ additionalProperties: false },
);

const RoleNumberMapSchema = Type.Object(
	{
		scout: Type.Number(),
		planner: Type.Number(),
		worker: Type.Number(),
		reviewer: Type.Number(),
	},
	{ additionalProperties: false },
);

const TaskBudgetSchema = Type.Object(
	{
		max_usd: Type.Number({ minimum: 0 }),
		max_tokens: Type.Integer({ minimum: 0 }),
		warn_at_pct: Type.Number({ minimum: 0, maximum: 100 }),
	},
	{ additionalProperties: false },
);

export const PawRuntimeConfigSchema = Type.Object(
	{
		version: Type.Literal(1),
		providers: Type.Object(
			{
				primary: ProviderSchema,
				secondary: ProviderSchema,
				local: ProviderSchema,
			},
			{ additionalProperties: false },
		),
		model_tiers: Type.Object(
			{
				cheap: ModelTierSchema,
				mid: ModelTierSchema,
				strong: ModelTierSchema,
				failover_order: Type.Array(Type.String({ minLength: 1 })),
			},
			{ additionalProperties: false },
		),
		role_routing: Type.Object(
			{
				classify: TierNameSchema,
				extract: TierNameSchema,
				format: TierNameSchema,
				schema_validate: TierNameSchema,
				summarize: TierNameSchema,
				scout_rank: TierNameSchema,
				worker_simple: TierNameSchema,
				planner: TierNameSchema,
				reviewer: TierNameSchema,
				worker_highrisk: TierNameSchema,
			},
			{ additionalProperties: false },
		),
		thinking: Type.Object(
			{
				enabled_for_classes: Type.Array(TaskClassSchema),
				enabled_for_roles: Type.Array(Type.String({ minLength: 1 })),
			},
			{ additionalProperties: false },
		),
		context: Type.Object(
			{
				class_cap_tokens: ClassNumberMapSchema,
				subagent_handoff_max_tokens: RoleNumberMapSchema,
				tool_output_max_tokens: Type.Integer({ minimum: 0 }),
				file_read_max_bytes: Type.Integer({ minimum: 0 }),
				drilldown: Type.String({ minLength: 1 }),
				eviction_order: Type.Array(Type.String({ minLength: 1 })),
				assembly_order: Type.Array(Type.String({ minLength: 1 })),
				required_span_recall_min: Type.Number({ minimum: 0, maximum: 1 }),
			},
			{ additionalProperties: false },
		),
		prompt_cache: Type.Object(
			{
				enabled: Type.Boolean(),
				assemble_most_stable_first: Type.Boolean(),
				advisory_target_hit_rate: Type.Number({ minimum: 0, maximum: 1 }),
				applies_to: Type.Array(Type.String({ minLength: 1 })),
			},
			{ additionalProperties: false },
		),
		budget: Type.Object(
			{
				per_task: Type.Object(
					{
						trivial: TaskBudgetSchema,
						standard: TaskBudgetSchema,
						high_risk: TaskBudgetSchema,
					},
					{ additionalProperties: false },
				),
				per_slice: Type.Object(
					{
						soft_fraction_of_task: Type.Number({ minimum: 0, maximum: 1 }),
					},
					{ additionalProperties: false },
				),
				on_exceed: Type.Object(
					{
						interactive: Type.String({ minLength: 1 }),
						non_interactive: Type.String({ minLength: 1 }),
					},
					{ additionalProperties: false },
				),
			},
			{ additionalProperties: false },
		),
		resilience: Type.Object(
			{
				llm_call: Type.Object(
					{
						timeout_sec: Type.Integer({ minimum: 0 }),
						retries: Type.Integer({ minimum: 0 }),
						backoff: Type.String({ minLength: 1 }),
						on_5xx_or_429: Type.String({ minLength: 1 }),
					},
					{ additionalProperties: false },
				),
				tool_call: Type.Object(
					{
						timeout_sec: Type.Integer({ minimum: 0 }),
						kill_on_timeout: Type.Boolean(),
					},
					{ additionalProperties: false },
				),
				subagent: Type.Object(
					{
						wall_clock_sec: Type.Integer({ minimum: 0 }),
						on_timeout: Type.String({ minLength: 1 }),
					},
					{ additionalProperties: false },
				),
				loop_caps: Type.Object(
					{
						max_subagent_iterations: Type.Integer({ minimum: 0 }),
					},
					{ additionalProperties: false },
				),
				active_time_clock: Type.Object(
					{
						enabled: Type.Boolean(),
						pause_states: Type.Array(Type.String({ minLength: 1 })),
					},
					{ additionalProperties: false },
				),
			},
			{ additionalProperties: false },
		),
		routing: Type.Object(
			{
				classifier_conservative_bias: Type.Boolean(),
				trivial_requires_all: Type.Object(
					{
						max_files: Type.Integer({ minimum: 0 }),
						cross_layer: Type.Boolean(),
						max_risk_level: RiskLevelSchema,
						security_path: Type.Boolean(),
					},
					{ additionalProperties: false },
				),
				clarify_questions: Type.Object(
					{
						trivial: Type.Object({ min: Type.Integer({ minimum: 0 }), max: Type.Integer({ minimum: 0 }) }),
						standard: Type.Object({ min: Type.Integer({ minimum: 0 }), max: Type.Integer({ minimum: 0 }) }),
						high_risk: Type.Object({ min: Type.Integer({ minimum: 0 }), max: Type.Integer({ minimum: 0 }) }),
					},
					{ additionalProperties: false },
				),
			},
			{ additionalProperties: false },
		),
		approval: Type.Object(
			{
				default_mode: Type.String({ minLength: 1 }),
				risk_levels: Type.Object(
					{
						R0: Type.String({ minLength: 1 }),
						R1: Type.String({ minLength: 1 }),
						R2: Type.String({ minLength: 1 }),
						R3: Type.String({ minLength: 1 }),
						R4: Type.String({ minLength: 1 }),
						R5: Type.String({ minLength: 1 }),
						R6: Type.String({ minLength: 1 }),
						R7: Type.String({ minLength: 1 }),
					},
					{ additionalProperties: false },
				),
				matrix: Type.Object(
					{
						auto: Type.Array(RiskLevelSchema),
						require_approval: Type.Array(RiskLevelSchema),
						always_human_never_auto: Type.Array(RiskLevelSchema),
					},
					{ additionalProperties: false },
				),
				non_interactive: Type.Object(
					{
						product_approval: Type.String({ minLength: 1 }),
						engineering_R3_R6: Type.String({ minLength: 1 }),
						R7: Type.String({ minLength: 1 }),
						on_loop_cap: Type.String({ minLength: 1 }),
					},
					{ additionalProperties: false },
				),
			},
			{ additionalProperties: false },
		),
		sandbox: Type.Object(
			{
				preferred: Type.Array(Type.String({ minLength: 1 })),
				on_unavailable: Type.String({ minLength: 1 }),
				fs_allowlist: Type.Array(Type.String({ minLength: 1 })),
				network: Type.String({ minLength: 1 }),
				egress_allowlist: Type.Array(Type.String({ minLength: 1 })),
			},
			{ additionalProperties: false },
		),
		secrets: Type.Object(
			{
				read_plane_exclude: Type.Array(Type.String({ minLength: 1 })),
				redact_at_io_write: Type.Boolean(),
				redact_patterns: Type.Array(Type.String({ minLength: 1 })),
				flag_high_entropy: Type.Boolean(),
			},
			{ additionalProperties: false },
		),
		injection: Type.Object(
			{
				untrusted_sources: Type.Array(Type.String({ minLength: 1 })),
				handling: Type.String({ minLength: 1 }),
				redteam_block_target: Type.Number({ minimum: 0, maximum: 1 }),
			},
			{ additionalProperties: false },
		),
		edit: Type.Object(
			{
				strategy: Type.String({ minLength: 1 }),
				fuzzy_apply_retries: Type.Integer({ minimum: 0 }),
				full_file_rewrite_max_lines: Type.Integer({ minimum: 0 }),
				idempotency: Type.String({ minLength: 1 }),
			},
			{ additionalProperties: false },
		),
		persistence: Type.Object(
			{
				atomic_writes: Type.String({ minLength: 1 }),
				locks: Type.Object({ heartbeat_ttl_sec: Type.Integer({ minimum: 0 }) }, { additionalProperties: false }),
				retention: Type.Object(
					{
						keep_last_sessions: Type.Integer({ minimum: 0 }),
						artifact_days: Type.Integer({ minimum: 0 }),
					},
					{ additionalProperties: false },
				),
				gitignore: Type.Object(
					{
						commit: Type.Array(Type.String({ minLength: 1 })),
						ignore: Type.Array(Type.String({ minLength: 1 })),
					},
					{ additionalProperties: false },
				),
			},
			{ additionalProperties: false },
		),
		verify: Type.Object(
			{
				v1_gates: Type.Array(Type.String({ minLength: 1 })),
				parallel_native: Type.Boolean(),
				summary_max_tokens: Type.Integer({ minimum: 0 }),
				v2_optin_gates: Type.Array(Type.String({ minLength: 1 })),
			},
			{ additionalProperties: false },
		),
		sla: Type.Object(
			{
				trivial: Type.Object({
					max_latency_sec: Type.Integer({ minimum: 0 }),
					max_usd: Type.Number({ minimum: 0 }),
				}),
				standard: Type.Object({
					max_latency_sec: Type.Integer({ minimum: 0 }),
					max_usd: Type.Number({ minimum: 0 }),
				}),
				high_risk: Type.Object({
					max_latency_sec: Type.Integer({ minimum: 0 }),
					max_usd: Type.Number({ minimum: 0 }),
				}),
			},
			{ additionalProperties: false },
		),
		kpi: Type.Object(
			{
				pr_hard_gates: Type.Array(Type.String({ minLength: 1 })),
				advisory_only: Type.Array(Type.String({ minLength: 1 })),
				live_eval_schedule: Type.String({ minLength: 1 }),
				live_eval_pinned_snapshots: Type.Boolean(),
			},
			{ additionalProperties: false },
		),
	},
	{ additionalProperties: false },
);

const ChangedFileSchema = Type.Object(
	{
		path: Type.String({ minLength: 1 }),
		change_type: Type.Union([
			Type.Literal("create"),
			Type.Literal("modify"),
			Type.Literal("delete"),
			Type.Literal("rename"),
		]),
		content_hash: Type.String(),
		apply_method: Type.Optional(
			Type.Union([Type.Literal("diff"), Type.Literal("fuzzy_diff"), Type.Literal("full_file")]),
		),
		base_content_hash: Type.Optional(Type.Union([Type.String(), Type.Null()])),
		new_content: Type.Optional(Type.Union([Type.String(), Type.Null()])),
		unified_diff: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

const InspectedFileSchema = Type.Object(
	{
		path: Type.String({ minLength: 1 }),
		line_span: Type.Optional(Type.String({ pattern: "^[0-9]+-[0-9]+$" })),
		rationale: Type.Optional(Type.String({ maxLength: 200 })),
		rank: Type.Optional(Type.Number()),
		required: Type.Optional(Type.Boolean()),
	},
	{ additionalProperties: false },
);

const PlanSliceSchema = Type.Object(
	{
		slice_id: Type.String(),
		title: Type.String(),
		order: Type.Integer({ minimum: 0 }),
		target_files: Type.Optional(Type.Array(Type.String())),
		max_risk_level: Type.Optional(Type.String({ pattern: "^R[0-7]$" })),
		acceptance: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

const RiskSchema = Type.Object(
	{
		description: Type.String(),
		severity: Type.Union([
			Type.Literal("low"),
			Type.Literal("medium"),
			Type.Literal("high"),
			Type.Literal("critical"),
		]),
	},
	{ additionalProperties: false },
);

const BlockedReasonSchema = Type.Object(
	{
		code: Type.Optional(
			Type.Union([
				Type.Literal("NEEDS_USER_DECISION"),
				Type.Literal("BUDGET_EXCEEDED"),
				Type.Literal("TEST_FAILURE"),
				Type.Literal("BUILD_FAILURE"),
				Type.Literal("TOOL_PERMISSION"),
				Type.Literal("CONTEXT_MISSING"),
				Type.Literal("PROVIDER_UNAVAILABLE"),
				Type.Literal("SANDBOX_UNAVAILABLE"),
				Type.Literal("PATCH_APPLY_FAILED"),
			]),
		),
		message: Type.Optional(Type.String()),
		suggested_action: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

export const PawSubAgentOutputSchema = Type.Object(
	{
		status: Type.Union([
			Type.Literal("pass"),
			Type.Literal("fail"),
			Type.Literal("blocked"),
			Type.Literal("needs_user_decision"),
		]),
		confidence: Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
		agent: AgentRoleSchema,
		session_id: Type.String({ minLength: 1 }),
		slice_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
		artifact_ref: Type.String({ pattern: "^\\.paw/artifacts/.+/(scout|planner|worker|reviewer)/report\\.md$" }),
		changed_files: Type.Array(ChangedFileSchema),
		inspected_files: Type.Array(InspectedFileSchema),
		plan_slices: Type.Optional(Type.Array(PlanSliceSchema)),
		risks: Type.Array(RiskSchema),
		next_actions: Type.Array(Type.String()),
		blocked_reason: Type.Optional(Type.Union([BlockedReasonSchema, Type.Null()])),
		tokens_used: Type.Integer({ minimum: 0 }),
		usd_cost: Type.Number({ minimum: 0 }),
		degraded: Type.Boolean(),
		model_used: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	},
	{ additionalProperties: false },
);

export type PawRiskLevel = Static<typeof RiskLevelSchema>;
export type PawTaskClass = Static<typeof TaskClassSchema>;
export type PawSubAgentRole = Static<typeof AgentRoleSchema>;
export type PawRuntimeConfig = Static<typeof PawRuntimeConfigSchema>;
export type PawSubAgentOutput = Static<typeof PawSubAgentOutputSchema>;
