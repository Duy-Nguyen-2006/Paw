/** Strip `//` line comments and trailing commas from JSON, leaving string literals untouched. */
export function stripJsonComments(input: string): string {
	return input
		.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*/g, (m) => (m.startsWith('"') ? m : ""))
		.replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/g, (m, tail) => tail ?? (m.startsWith('"') ? m : ""));
}
