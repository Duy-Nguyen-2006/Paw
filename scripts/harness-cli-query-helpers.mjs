/**
 * Harness CLI query dispatch (extracted from harness-cli.mjs for S3776).
 */

export function runQuerySubcommand(sub, restArgs, deps) {
	const {
		hasFlag,
		die,
		queryMatrix,
		queryTable,
		queryFriction,
		queryStats,
		querySql,
	} = deps;

	if (sub === "matrix") return queryMatrix(restArgs);
	if (sub === "backlog") return queryTable("backlog", restArgs);
	if (sub === "decisions") return queryTable("decision", restArgs);
	if (sub === "intakes") return queryTable("intake", restArgs);
	if (sub === "traces") return queryTable("trace", restArgs);
	if (sub === "friction") return queryFriction();
	if (sub === "tools") return queryTable("tool", restArgs);
	if (sub === "interventions") return queryTable("intervention", restArgs);
	if (sub === "stats") return queryStats();
	if (sub === "sql") return querySql(restArgs.join(" "));
	die(`Unknown query command: ${sub ?? "(missing)"}`);
}
