export function createPawNativeVerificationEnvironment(
	baseEnv: NodeJS.ProcessEnv,
	repoRoot = process.cwd(),
): NodeJS.ProcessEnv {
	const env = { ...baseEnv };
	env.PATH = joinProjectNpmBinToPath(repoRoot, env.PATH);
	env.TSX_TSCONFIG_PATH = `${repoRoot}/tsconfig.json`;
	env.npm_execpath = "/usr/bin/npm";
	env.npm_node_execpath = process.execPath;
	return env;
}

function joinProjectNpmBinToPath(repoRoot: string, pathValue: string | undefined): string {
	const npmBin = `${repoRoot}/node_modules/.bin`;
	return pathValue === undefined || pathValue.length === 0 ? npmBin : `${npmBin}:${pathValue}`;
}
