
#!/usr/bin/env node
/** Repair broken escape-sequence literals from over-aggressive S7781 auto-fix. */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const DIRS = ["packages", "scripts"];
const EXCLUDE = /models\.generated\.ts|node_modules|dist|vendor|doom\.js/;

const REPAIRS = [
	[/\.replaceAll\("rn"/g, '.replaceAll("\\r\\n"'],
	[/\.replaceAll\("r"/g, '.replaceAll("\\r"'],
	[/\.replaceAll\("n"/g, '.replaceAll("\\n"'],
	[/\.replaceAll\("t"/g, '.replaceAll("\\t"'],
	[/\.replaceAll\("x1b\[0m"/g, '.replaceAll("\\x1b[0m"'],
	[/\.replaceAll\("s\+"/g, ".replaceAll("\\s+", "],
];

function walk(dir, files = []) {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (EXCLUDE.test(full)) continue;
		const st = statSync(full);
		if (st.isDirectory()) walk(full, files);
		else if (/\.(ts|js|mjs)$/.test(entry)) files.push(full);
	}
	return files;
}

let changed = 0;
for (const dir of DIRS) {
	for (const file of walk(join(ROOT, dir))) {
		let content = readFileSync(file, "utf8");
		const original = content;
		for (const [from, to] of REPAIRS) content = content.replace(from, to);
		if (content !== original) {
			writeFileSync(file, content, "utf8");
			changed++;
			console.log("repaired:", relative(ROOT, file));
		}
	}
}
console.log(`\nRepaired ${changed} files`);
