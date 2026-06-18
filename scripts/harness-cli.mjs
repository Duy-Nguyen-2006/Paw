
#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const dbPath = join(root, "harness.db");
const schemaDir = join(root, "scripts", "schema");
const version = "harness-cli-portable-0.1.0";

function die(message, code = 1) {
  console.error(`Error: ${message}`);
  process.exit(code);
}

function db() {
  mkdirSync(dirname(dbPath), { recursive: true });
  const database = new DatabaseSync(dbPath);
  database.exec("PRAGMA foreign_keys = ON");
  return database;
}

function appliedVersions(database) {
  try {
    return new Set(database.prepare("SELECT version FROM schema_version").all().map((row) => row.version));
  } catch {
    return new Set();
  }
}

function migrate() {
  const database = db();
  const files = ["001-init.sql", "002-story-verify.sql", "003-tool-registry.sql", "004-intervention.sql", "005-tool-extensions.sql"];
  const applied = appliedVersions(database);
  let count = 0;
  for (const file of files) {
    const migrationVersion = Number(file.slice(0, 3));
    if (applied.has(migrationVersion)) continue;
    database.exec(readFileSync(join(schemaDir, file), "utf8"));
    count += 1;
  }
  console.log(count === 0 ? "No migrations pending" : `Applied ${count} migration(s)`);
}

function init() {
  migrate();
  console.log(`Initialized ${dbPath}`);
}

function getValue(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) die(`${name} requires a value`);
  return value;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function bindValue(value) {
  return value === undefined ? null : value;
}

function splitCsv(value) {
  if (!value) return undefined;
  return JSON.stringify(value.split(",").map((item) => item.trim()).filter(Boolean));
}

function parseJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isExecutableOnPath(command) {
  if (!command) return false;
  if (command.includes("/") || command.includes("\\")) return existsSync(resolve(root, command)) || existsSync(command);
  return spawnSync(process.platform === "win32" ? "where" : "command", process.platform === "win32" ? [command] : ["-v", command], { shell: true, stdio: "ignore" }).status === 0;
}

function normalizeLane(value) {
  const lane = (value ?? "normal").replace("-", "_");
  if (!["tiny", "normal", "high_risk"].includes(lane)) die(`Invalid lane: ${value}`);
  return lane;
}

function normalizeInputType(value) {
  const mapped = (value ?? "change_request").replaceAll("-", "_");
  const aliases = { maintenance_request: "maintenance", harness: "harness_improvement" };
  const inputType = aliases[mapped] ?? mapped;
  if (!["new_spec", "spec_slice", "change_request", "new_initiative", "maintenance", "harness_improvement"].includes(inputType)) {
    die(`Invalid input type: ${value}`);
  }
  return inputType;
}

function intake(args) {
  migrateSilently();
  const database = db();
  const summary = getValue(args, "--summary");
  if (!summary) die("intake requires --summary");
  database.prepare(`INSERT INTO intake (input_type, summary, risk_lane, risk_flags, affected_docs, story_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(
      normalizeInputType(getValue(args, "--type", "change_request")),
      summary,
      normalizeLane(getValue(args, "--lane", "normal")),
      bindValue(splitCsv(getValue(args, "--flags"))),
      bindValue(splitCsv(getValue(args, "--docs"))),
      bindValue(getValue(args, "--story")),
      bindValue(getValue(args, "--notes")),
    );
  const id = database.prepare("SELECT last_insert_rowid() AS id").get().id;
  console.log(`intake ${id} recorded`);
}

function story(args) {
  const sub = args[0];
  if (sub === "add") return storyAdd(args.slice(1));
  if (sub === "update") return storyUpdate(args.slice(1));
  if (sub === "verify") return storyVerify(args.slice(1));
  if (sub === "verify-all") return storyVerifyAll();
  die(`Unknown story command: ${sub ?? "(missing)"}`);
}

function storyAdd(args) {
  migrateSilently();
  const database = db();
  const id = getValue(args, "--id");
  const title = getValue(args, "--title");
  if (!id || !title) die("story add requires --id and --title");
  database.prepare(`INSERT OR IGNORE INTO story (id, title, risk_lane, contract_doc, verify_command, notes) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, title, normalizeLane(getValue(args, "--lane", "normal")), bindValue(getValue(args, "--doc")), bindValue(getValue(args, "--verify")), bindValue(getValue(args, "--notes")));
  console.log(`story ${id} recorded`);
}

function optionalInt(args, flag) {
  const value = getValue(args, flag);
  if (value === undefined) return undefined;
  if (value !== "0" && value !== "1") die(`${flag} expects 0 or 1`);
  return Number(value);
}

function storyUpdate(args) {
  migrateSilently();
  const database = db();
  const id = getValue(args, "--id");
  if (!id) die("story update requires --id");
  const fields = [];
  const values = [];
  const mapping = [
    ["--status", "status"], ["--title", "title"], ["--doc", "contract_doc"], ["--evidence", "evidence"], ["--notes", "notes"], ["--verify", "verify_command"],
  ];
  for (const [flag, column] of mapping) {
    const value = getValue(args, flag);
    if (value !== undefined) { fields.push(`${column} = ?`); values.push(value); }
  }
  const proofMapping = [["--unit", "unit_proof"], ["--integration", "integration_proof"], ["--e2e", "e2e_proof"], ["--platform", "platform_proof"]];
  for (const [flag, column] of proofMapping) {
    const value = optionalInt(args, flag);
    if (value !== undefined) { fields.push(`${column} = ?`); values.push(value); }
  }
  if (fields.length === 0) die("story update has no fields to update");
  values.push(id);
  database.prepare(`UPDATE story SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  console.log(`story ${id} updated`);
}

function storyVerify(args) {
  migrateSilently();
  const id = args[0];
  if (!id) die("story verify requires story id");
  const database = db();
  const row = database.prepare("SELECT verify_command FROM story WHERE id = ?").get(id);
  if (!row) die(`story not found: ${id}`);
  if (!row.verify_command) { console.log(`story ${id} has no verify_command`); return; }
  const result = spawnSync(row.verify_command, { cwd: root, shell: true, stdio: "inherit" });
  const status = result.status === 0 ? "pass" : "fail";
  database.prepare("UPDATE story SET last_verified_at = datetime('now'), last_verified_result = ? WHERE id = ?").run(status, id);
  if (status === "fail") process.exitCode = 1;
}

function storyVerifyAll() {
  migrateSilently();
  const database = db();
  const rows = database.prepare("SELECT id FROM story WHERE verify_command IS NOT NULL AND verify_command != '' ORDER BY id").all();
  let failed = false;
  for (const row of rows) {
    storyVerify([row.id]);
    if (process.exitCode) failed = true;
  }
  if (rows.length === 0) console.log("No story verify commands configured");
  if (failed) process.exitCode = 1;
}

function decision(args) {
  const sub = args[0];
  if (sub === "add") return decisionAdd(args.slice(1));
  if (sub === "verify") return decisionVerify(args.slice(1));
  die(`Unknown decision command: ${sub ?? "(missing)"}`);
}

function decisionAdd(args) {
  migrateSilently();
  const id = getValue(args, "--id");
  const title = getValue(args, "--title");
  if (!id || !title) die("decision add requires --id and --title");
  db().prepare(`INSERT OR REPLACE INTO decision (id, title, status, doc_path, verify_command, notes) VALUES (?, ?, 'accepted', ?, ?, ?)`)
    .run(id, title, bindValue(getValue(args, "--doc")), bindValue(getValue(args, "--verify")), bindValue(getValue(args, "--notes")));
  console.log(`decision ${id} recorded`);
}

function decisionVerify(args) {
  migrateSilently();
  const id = args[0];
  if (!id) die("decision verify requires decision id");
  const database = db();
  const row = database.prepare("SELECT verify_command FROM decision WHERE id = ?").get(id);
  if (!row) die(`decision not found: ${id}`);
  if (!row.verify_command) { console.log(`decision ${id} has no verify_command`); return; }
  const result = spawnSync(row.verify_command, { cwd: root, shell: true, stdio: "inherit" });
  const status = result.status === 0 ? "pass" : "fail";
  database.prepare("UPDATE decision SET last_verified_at = datetime('now'), last_verified_result = ? WHERE id = ?").run(status, id);
  if (status === "fail") process.exitCode = 1;
}

function backlog(args) {
  const sub = args[0];
  if (sub === "add") return backlogAdd(args.slice(1));
  if (sub === "close") return backlogClose(args.slice(1));
  die(`Unknown backlog command: ${sub ?? "(missing)"}`);
}

function backlogAdd(args) {
  migrateSilently();
  const title = getValue(args, "--title");
  if (!title) die("backlog add requires --title");
  db().prepare(`INSERT INTO backlog (title, discovered_while, current_pain, suggested_improvement, risk, predicted_impact, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(title, bindValue(getValue(args, "--while")), bindValue(getValue(args, "--pain")), bindValue(getValue(args, "--suggestion")), normalizeLane(getValue(args, "--risk", "normal")), bindValue(getValue(args, "--predicted")), bindValue(getValue(args, "--notes")));
  console.log("backlog item recorded");
}

function backlogClose(args) {
  migrateSilently();
  const id = getValue(args, "--id") ?? args[0];
  if (!id) die("backlog close requires --id");
  db().prepare("UPDATE backlog SET status = ?, actual_outcome = ?, implemented_at = datetime('now') WHERE id = ?")
    .run(getValue(args, "--status", "implemented"), bindValue(getValue(args, "--outcome")), id);
  console.log(`backlog ${id} closed`);
}

function trace(args) {
  migrateSilently();
  const summary = getValue(args, "--summary");
  if (!summary) die("trace requires --summary");
  db().prepare(`INSERT INTO trace (task_summary, intake_id, story_id, agent, actions_taken, files_read, files_changed, decisions_made, errors, outcome, duration_seconds, token_estimate, harness_friction, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      summary,
      bindValue(getValue(args, "--intake")),
      bindValue(getValue(args, "--story")),
      bindValue(getValue(args, "--agent")),
      bindValue(splitCsv(getValue(args, "--actions"))),
      bindValue(splitCsv(getValue(args, "--read"))),
      bindValue(splitCsv(getValue(args, "--changed"))),
      bindValue(splitCsv(getValue(args, "--decisions"))),
      bindValue(splitCsv(getValue(args, "--errors")) ?? getValue(args, "--errors")),
      getValue(args, "--outcome", "completed"),
      bindValue(getValue(args, "--duration")),
      bindValue(getValue(args, "--tokens")),
      bindValue(getValue(args, "--friction")),
      bindValue(getValue(args, "--notes")),
    );
  const id = db().prepare("SELECT max(id) AS id FROM trace").get().id;
  console.log(`trace ${id} recorded`);
  scoreTrace(["--id", String(id)]);
}

function tool(args) {
  const sub = args[0];
  if (sub === "register") return toolRegister(args.slice(1));
  if (sub === "check") return toolCheck(args.slice(1));
  if (sub === "remove") return toolRemove(args.slice(1));
  die(`Unknown tool command: ${sub ?? "(missing)"}`);
}

function normalizeToolKind(value) {
  const kind = value ?? "cli";
  if (!["cli", "binary", "mcp", "skill", "http"].includes(kind)) die(`Invalid tool kind: ${kind}`);
  return kind;
}

function normalizeCapability(value) {
  if (!value) return null;
  const capability = value.toLowerCase().replaceAll("_", " ").trim().replace(/\s+/g, "-");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(capability)) die(`Invalid capability: ${value}`);
  return capability;
}

function toolRegister(args) {
  migrateSilently();
  const name = getValue(args, "--name");
  const command = getValue(args, "--command");
  const description = getValue(args, "--description");
  const responsibility = getValue(args, "--responsibility");
  if (!name || !command || !description || !responsibility) die("tool register requires --name, --command, --description, and --responsibility");
  if (description.length < 10 || description.length > 200) die("tool description must be 10-200 characters");
  const kind = normalizeToolKind(getValue(args, "--kind", "cli"));
  if ((kind === "cli" || kind === "binary") && !hasFlag(args, "--force") && !isExecutableOnPath(command)) die(`tool command not found: ${command}`);
  db().prepare(`INSERT OR REPLACE INTO tool (name, provider, command, description, args, responsibility, kind, capability, scan_target, status, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
    .run(name, getValue(args, "--provider", "custom"), command, description, bindValue(getValue(args, "--args")), responsibility, kind, normalizeCapability(getValue(args, "--capability")), bindValue(getValue(args, "--scan")), "registered");
  console.log(`tool ${name} registered`);
}

function toolCheck(args) {
  migrateSilently();
  const database = db();
  const name = getValue(args, "--name");
  const rows = name ? database.prepare("SELECT * FROM tool WHERE name = ?").all(name) : database.prepare("SELECT * FROM tool ORDER BY name").all();
  const checked = rows.map((row) => {
    const status = ["mcp", "skill", "http"].includes(row.kind) ? "unknown" : (isExecutableOnPath(row.command) ? "present" : "missing");
    database.prepare("UPDATE tool SET status = ?, checked_at = datetime('now') WHERE name = ?").run(status, row.name);
    return { name: row.name, kind: row.kind, command: row.command, status };
  });
  if (hasFlag(args, "--json")) console.log(JSON.stringify(checked, null, 2));
  else console.log(checked.length ? checked.map((row) => `${row.name}\t${row.kind}\t${row.status}\t${row.command}`).join("\n") : "No tools registered");
}

function toolRemove(args) {
  migrateSilently();
  const name = getValue(args, "--name") ?? args[0];
  if (!name) die("tool remove requires --name");
  db().prepare("DELETE FROM tool WHERE name = ?").run(name);
  console.log(`tool ${name} removed`);
}

function intervention(args) {
  const sub = args[0];
  if (sub === "add") return interventionAdd(args.slice(1));
  die(`Unknown intervention command: ${sub ?? "(missing)"}`);
}

function interventionAdd(args) {
  migrateSilently();
  const type = getValue(args, "--type");
  const description = getValue(args, "--description");
  const source = getValue(args, "--source");
  if (!type || !description || !source) die("intervention add requires --type, --description, and --source");
  if (!["correction", "override", "escalation", "approval"].includes(type)) die(`Invalid intervention type: ${type}`);
  if (!["human", "reviewer", "ci", "agent"].includes(source)) die(`Invalid intervention source: ${source}`);
  db().prepare("INSERT INTO intervention (trace_id, story_id, type, description, source, impact) VALUES (?, ?, ?, ?, ?, ?)")
    .run(bindValue(getValue(args, "--trace")), bindValue(getValue(args, "--story")), type, description, source, bindValue(getValue(args, "--impact")));
  const id = db().prepare("SELECT max(id) AS id FROM intervention").get().id;
  console.log(`intervention ${id} recorded`);
}

function scoreTrace(args) {
  migrateSilently();
  const id = getValue(args, "--id") ?? args[0];
  const database = db();
  const rows = id ? [database.prepare("SELECT * FROM trace WHERE id = ?").get(id)].filter(Boolean) : database.prepare("SELECT * FROM trace ORDER BY id DESC LIMIT 20").all();
  if (rows.length === 0) { console.log("No traces found"); return; }
  for (const row of rows) {
    const actions = parseJsonArray(row.actions_taken).length;
    const read = parseJsonArray(row.files_read).length;
    const changed = parseJsonArray(row.files_changed).length;
    const errors = row.errors ? 1 : 0;
    const friction = row.harness_friction ? 1 : 0;
    const score = Math.min(100, actions * 20 + read * 15 + changed * 15 + errors * 10 + friction * 10 + (row.outcome ? 10 : 0) + (row.notes ? 5 : 0));
    const tier = score >= 80 ? "detailed" : score >= 45 ? "basic" : "thin";
    console.log(`trace ${row.id}\tscore=${score}\ttier=${tier}\tactions=${actions}\tread=${read}\tchanged=${changed}`);
  }
}

function scoreContext(args) {
  migrateSilently();
  const id = args[0] ?? getValue(args, "--id");
  if (!id) die("score-context requires trace id");
  const row = db().prepare("SELECT * FROM trace WHERE id = ?").get(id);
  if (!row) die(`trace not found: ${id}`);
  const files = parseJsonArray(row.files_read);
  const docs = files.filter((file) => String(file).startsWith("docs/") || String(file).endsWith("SPEC.md") || String(file).endsWith("README.md"));
  const score = Math.min(100, files.length * 10 + docs.length * 15);
  console.log(`trace ${row.id}\tcontext_score=${score}\tfiles_read=${files.length}\tdoc_reads=${docs.length}`);
}

function auditRows() {
  const database = db();
  const orphaned = database.prepare("SELECT count(*) AS count FROM story WHERE status IN ('planned','in_progress') AND id NOT IN (SELECT story_id FROM trace WHERE story_id IS NOT NULL)").get().count;
  const unverifiedStories = database.prepare("SELECT count(*) AS count FROM story WHERE verify_command IS NOT NULL AND verify_command != '' AND (last_verified_result IS NULL OR last_verified_result != 'pass')").get().count;
  const unverifiedDecisions = database.prepare("SELECT count(*) AS count FROM decision WHERE verify_command IS NOT NULL AND verify_command != '' AND (last_verified_result IS NULL OR last_verified_result != 'pass')").get().count;
  const backlogWithoutOutcomes = database.prepare("SELECT count(*) AS count FROM backlog WHERE status = 'implemented' AND predicted_impact IS NOT NULL AND predicted_impact != '' AND (actual_outcome IS NULL OR actual_outcome = '')").get().count;
  const staleStories = database.prepare("SELECT count(*) AS count FROM story WHERE status NOT IN ('implemented','retired') AND created_at < datetime('now','-30 days')").get().count;
  const brokenTools = database.prepare("SELECT count(*) AS count FROM tool WHERE status = 'missing'").get().count;
  return { orphaned, unverifiedStories, unverifiedDecisions, backlogWithoutOutcomes, staleStories, brokenTools };
}

function audit() {
  migrateSilently();
  toolCheck(["--json"]);
  const rows = auditRows();
  const score = Math.min(100, rows.orphaned * 10 + rows.unverifiedStories * 5 + rows.unverifiedDecisions * 5 + rows.backlogWithoutOutcomes * 2 + rows.staleStories * 3 + rows.brokenTools * 8);
  console.log(`audit entropy_score=${score}`);
  for (const [key, value] of Object.entries(rows)) console.log(`${key}: ${value}`);
  if (score > 0) process.exitCode = 1;
}

function propose(args) {
  migrateSilently();
  const database = db();
  const audit = auditRows();
  const frictionRows = database.prepare("SELECT harness_friction, count(*) AS count FROM trace WHERE harness_friction IS NOT NULL AND harness_friction != '' AND harness_friction != 'none' GROUP BY harness_friction ORDER BY count DESC LIMIT 5").all();
  const interventionRows = database.prepare("SELECT type, source, count(*) AS count FROM intervention GROUP BY type, source ORDER BY count DESC LIMIT 5").all();
  const proposals = [];
  if (audit.brokenTools > 0) proposals.push({ title: "Repair missing registered tools", component: "tool access", risk: "normal", evidence: `${audit.brokenTools} missing tool(s)`, predicted: "Lower audit drift and prevent false tool availability assumptions" });
  if (audit.unverifiedStories > 0) proposals.push({ title: "Verify stories with configured proof commands", component: "verification", risk: "normal", evidence: `${audit.unverifiedStories} unverified story command(s)`, predicted: "Increase trust in durable story matrix" });
  for (const row of frictionRows) proposals.push({ title: `Reduce repeated harness friction: ${row.harness_friction}`, component: "observability", risk: "tiny", evidence: `${row.count} trace(s)`, predicted: "Reduce repeated manual recovery work" });
  for (const row of interventionRows) proposals.push({ title: `Review repeated ${row.source} ${row.type} interventions`, component: "intervention recording", risk: "normal", evidence: `${row.count} intervention(s)`, predicted: "Convert repeated overrides into durable policy or tooling" });
  if (proposals.length === 0) { console.log("No proposals generated"); return; }
  console.log(JSON.stringify(proposals, null, 2));
  if (hasFlag(args, "--commit")) {
    for (const proposal of proposals) {
      database.prepare("INSERT INTO backlog (title, discovered_while, current_pain, suggested_improvement, risk, predicted_impact, notes) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(proposal.title, "harness-cli propose", proposal.evidence, proposal.component, proposal.risk, proposal.predicted, "Generated by portable harness CLI");
    }
    console.log(`committed ${proposals.length} proposal(s)`);
  }
}

function query(args) {
  migrateSilently();
  const sub = args[0];
  if (sub === "matrix") return queryMatrix(args.slice(1));
  if (sub === "backlog") return queryTable("backlog", args);
  if (sub === "decisions") return queryTable("decision", args);
  if (sub === "intakes") return queryTable("intake", args);
  if (sub === "traces") return queryTable("trace", args);
  if (sub === "friction") return queryFriction();
  if (sub === "tools") return queryTable("tool", args);
  if (sub === "interventions") return queryTable("intervention", args);
  if (sub === "stats") return queryStats();
  if (sub === "sql") return querySql(args.slice(1).join(" "));
  die(`Unknown query command: ${sub ?? "(missing)"}`);
}

function queryMatrix(args) {
  const numeric = hasFlag(args, "--numeric");
  const rows = db().prepare("SELECT id,title,status,unit_proof,integration_proof,e2e_proof,platform_proof,last_verified_result FROM story ORDER BY id").all();
  if (rows.length === 0) { console.log("No stories recorded"); return; }
  for (const row of rows) {
    const format = (v) => numeric ? String(v) : (v ? "yes" : "no");
    console.log(`${row.id}\t${row.status}\tunit=${format(row.unit_proof)}\tintegration=${format(row.integration_proof)}\te2e=${format(row.e2e_proof)}\tplatform=${format(row.platform_proof)}\tverify=${row.last_verified_result ?? "n/a"}\t${row.title}`);
  }
}

function queryTable(table, args) {
  const rows = db().prepare(`SELECT * FROM ${table} ORDER BY 1 DESC LIMIT 50`).all();
  if (hasFlag(args, "--json")) console.log(JSON.stringify(rows, null, 2));
  else console.log(rows.length ? rows.map((row) => JSON.stringify(row)).join("\n") : `No ${table} records`);
}

function queryFriction() {
  const rows = db().prepare("SELECT id,task_summary,harness_friction FROM trace WHERE harness_friction IS NOT NULL AND harness_friction != '' ORDER BY id DESC LIMIT 50").all();
  console.log(rows.length ? rows.map((row) => JSON.stringify(row)).join("\n") : "No friction recorded");
}

function queryStats() {
  const database = db();
  for (const table of ["intake", "story", "decision", "backlog", "trace", "tool", "intervention"]) {
    const count = database.prepare(`SELECT count(*) AS count FROM ${table}`).get().count;
    console.log(`${table}: ${count}`);
  }
}

function querySql(sql) {
  if (!sql) die("query sql requires SQL text");
  const rows = db().prepare(sql).all();
  console.log(JSON.stringify(rows, null, 2));
}

function migrateSilently() {
  if (!existsSync(dbPath)) {
    const old = console.log;
    console.log = () => {};
    try { migrate(); } finally { console.log = old; }
  }
}

function help() {
  console.log(`Usage: scripts/bin/${basename(process.argv[1])} <command>

Commands: init, migrate, intake, story, decision, backlog, tool, intervention, trace, score-trace, score-context, audit, propose, query, --version`);
}

const [command, ...args] = process.argv.slice(2);
if (!command || command === "help" || command === "--help" || command === "-h") help();
else if (command === "--version" || command === "version") console.log(version);
else if (command === "init") init();
else if (command === "migrate") migrate();
else if (command === "intake") intake(args);
else if (command === "story") story(args);
else if (command === "decision") decision(args);
else if (command === "backlog") backlog(args);
else if (command === "tool") tool(args);
else if (command === "intervention") intervention(args);
else if (command === "trace") trace(args);
else if (command === "score-trace") scoreTrace(args);
else if (command === "score-context") scoreContext(args);
else if (command === "audit") audit(args);
else if (command === "propose") propose(args);
else if (command === "query") query(args);
else die(`Unknown command: ${command}`);
