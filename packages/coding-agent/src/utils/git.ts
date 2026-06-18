import hostedGitInfo from "hosted-git-info";

/**
 * Parsed git URL information.
 */
export type GitSource = {
	/** Always "git" for git sources */
	type: "git";
	/** Clone URL (always valid for git clone, without ref suffix) */
	repo: string;
	/** Git host domain (e.g., "github.com") */
	host: string;
	/** Repository path (e.g., "user/repo") */
	path: string;
	/** Git ref (branch, tag, commit) if specified */
	ref?: string;
	/** True if ref was specified (package won't be auto-updated) */
	pinned: boolean;
};

function splitRef(url: string): { repo: string; ref?: string } {
	const scpLikeMatch = /^git@([^:]+):(.+)$/.exec(url);
	if (scpLikeMatch) {
		const pathWithMaybeRef = scpLikeMatch[2] ?? "";
		const refSeparator = pathWithMaybeRef.indexOf("@");
		if (refSeparator < 0) return { repo: url };
		const repoPath = pathWithMaybeRef.slice(0, refSeparator);
		const ref = pathWithMaybeRef.slice(refSeparator + 1);
		if (!repoPath || !ref) return { repo: url };
		return {
			repo: `git@${scpLikeMatch[1] ?? ""}:${repoPath}`,
			ref,
		};
	}

	if (url.includes("://")) {
		try {
			const parsed = new URL(url);
			const pathWithMaybeRef = parsed.pathname.replace(/^\/+/, "");
			const refSeparator = pathWithMaybeRef.indexOf("@");
			if (refSeparator < 0) return { repo: url };
			const repoPath = pathWithMaybeRef.slice(0, refSeparator);
			const ref = pathWithMaybeRef.slice(refSeparator + 1);
			if (!repoPath || !ref) return { repo: url };
			parsed.pathname = `/${repoPath}`;
			return {
				repo: parsed.toString().replace(/\/$/, ""),
				ref,
			};
		} catch {
			return { repo: url };
		}
	}

	const slashIndex = url.indexOf("/");
	if (slashIndex < 0) {
		return { repo: url };
	}
	const host = url.slice(0, slashIndex);
	const pathWithMaybeRef = url.slice(slashIndex + 1);
	const refSeparator = pathWithMaybeRef.indexOf("@");
	if (refSeparator < 0) {
		return { repo: url };
	}
	const repoPath = pathWithMaybeRef.slice(0, refSeparator);
	const ref = pathWithMaybeRef.slice(refSeparator + 1);
	if (!repoPath || !ref) {
		return { repo: url };
	}
	return {
		repo: `${host}/${repoPath}`,
		ref,
	};
}

function decodeForValidation(value: string): string | null {
	try {
		return decodeURIComponent(value);
	} catch {
		return null;
	}
}

function hasUnsafeGitInstallPart(value: string, allowSlash: boolean): boolean {
	const decoded = decodeForValidation(value);
	if (decoded === null) {
		return true;
	}
	const candidates = [value, decoded];
	for (const candidate of candidates) {
		if (candidate.includes("\0") || candidate.includes("\\") || candidate.startsWith("/")) {
			return true;
		}
		if (!allowSlash && candidate.includes("/")) {
			return true;
		}
		if (candidate.split("/").includes("..")) {
			return true;
		}
	}
	return false;
}

function buildGitSource(args: { repo: string; host: string; path: string; ref?: string }): GitSource | null {
	if (args.path.startsWith("/")) {
		return null;
	}
	const normalizedPath = args.path.replace(/\.git$/, "").replace(/^\/+/, "");
	if (!args.host || !normalizedPath || normalizedPath.split("/").length < 2) {
		return null;
	}
	if (hasUnsafeGitInstallPart(args.host, false) || hasUnsafeGitInstallPart(normalizedPath, true)) {
		return null;
	}

	return {
		type: "git",
		repo: args.repo,
		host: args.host,
		path: normalizedPath,
		ref: args.ref,
		pinned: Boolean(args.ref),
	};
}

function parseGenericGitUrl(url: string): GitSource | null {
	const { repo: repoWithoutRef, ref } = splitRef(url);
	let repo = repoWithoutRef;
	let host = "";
	let path = "";

	const scpLikeMatch = /^git@([^:]+):(.+)$/.exec(repoWithoutRef);
	if (scpLikeMatch) {
		host = scpLikeMatch[1] ?? "";
		path = scpLikeMatch[2] ?? "";
	} else if (
		repoWithoutRef.startsWith("https://") ||
		repoWithoutRef.startsWith("http://") ||
		repoWithoutRef.startsWith("ssh://") ||
		repoWithoutRef.startsWith("git://")
	) {
		try {
			const parsed = new URL(repoWithoutRef);
			host = parsed.hostname;
			path = parsed.pathname.replace(/^\/+/, "");
		} catch {
			return null;
		}
	} else {
		const slashIndex = repoWithoutRef.indexOf("/");
		if (slashIndex < 0) {
			return null;
		}
		host = repoWithoutRef.slice(0, slashIndex);
		path = repoWithoutRef.slice(slashIndex + 1);
		if (!host.includes(".") && host !== "localhost") {
			return null;
		}
		repo = `https://${repoWithoutRef}`;
	}

	return buildGitSource({ repo, host, path, ref });
}

/**
 * Parse git source into a GitSource.
 *
 * Rules:
 * - With git: prefix, accept all historical shorthand forms.
 * - Without git: prefix, only accept explicit protocol URLs.
 */
export function parseGitUrl(source: string): GitSource | null {
	const trimmed = source.trim();
	const hasGitPrefix = trimmed.startsWith("git:");
	const url = hasGitPrefix ? trimmed.slice(4).trim() : trimmed;

	if (!hasGitPrefix && !/^(https?|ssh|git):\/\//i.test(url)) {
		return null;
	}

	const split = splitRef(url);

	const hosted = resolveHostedGitSource(split.repo, split.ref, url, false);
	if (hosted) return hosted;

	const httpsHosted = resolveHostedGitSource(split.repo, split.ref, url, true);
	if (httpsHosted) return httpsHosted;

	return parseGenericGitUrl(url);
}

/**
 * Try to resolve the source via hosted-git-info, optionally prepending an
 * https:// prefix. Returns null when the source isn't a known hosted provider.
 */
function resolveHostedGitSource(
	repo: string,
	ref: string | undefined,
	url: string,
	forceHttps: boolean,
): GitSource | null {
	const candidates = buildHostedCandidates(repo, ref, url, forceHttps);
	for (const candidate of candidates) {
		const source = tryBuildFromHostedInfo(candidate, repo, ref, forceHttps);
		if (source) return source;
	}
	return null;
}

/** Build the list of hosted-git-info URL candidates for the given inputs. */
function buildHostedCandidates(repo: string, ref: string | undefined, url: string, forceHttps: boolean): string[] {
	if (forceHttps) {
		return [ref ? `https://${repo}#${ref}` : undefined, `https://${url}`].filter((value): value is string =>
			Boolean(value),
		);
	}
	return [ref ? `${repo}#${ref}` : undefined, url].filter((value): value is string => Boolean(value));
}

/**
 * Try to build a GitSource from hosted-git-info for a single candidate URL.
 * Skips candidates whose project already includes a ref ("@").
 */
function tryBuildFromHostedInfo(
	candidate: string,
	repo: string,
	ref: string | undefined,
	forceHttps: boolean,
): GitSource | null {
	const info = hostedGitInfo.fromUrl(candidate);
	if (!info) return null;
	if (ref && info.project?.includes("@")) return null;

	const resolvedRepo = forceHttps || shouldAddHttpsPrefix(repo) ? `https://${repo}` : repo;
	return buildGitSource({
		repo: resolvedRepo,
		host: info.domain || "",
		path: `${info.user}/${info.project}`,
		ref: info.committish || ref || undefined,
	});
}

/**
 * Whether the repo string is missing a known protocol prefix and should be
 * rewritten with an https:// scheme.
 */
function shouldAddHttpsPrefix(repo: string): boolean {
	return (
		!repo.startsWith("http://") &&
		!repo.startsWith("https://") &&
		!repo.startsWith("ssh://") &&
		!repo.startsWith("git://") &&
		!repo.startsWith("git@")
	);
}
