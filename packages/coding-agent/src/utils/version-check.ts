import { compare, valid } from "semver";
import { fetchWithRetry } from "./management-http.ts";
import { getPiUserAgent } from "./pi-user-agent.ts";

// 3pino fork: releases are GitHub Releases of the fork, tagged fork-v<version> with the
// packed coding-agent tarball attached, so self-update never installs the official package.
export const FORK_REPO = "3pino/pi";
export const FORK_RELEASES_URL = `https://github.com/${FORK_REPO}/releases`;
const LATEST_VERSION_URL = `https://api.github.com/repos/${FORK_REPO}/releases/latest`;
const FORK_TAG_PREFIX = "fork-v";
const DEFAULT_VERSION_CHECK_TIMEOUT_MS = 10000;

export interface LatestPiRelease {
	version: string;
	packageName?: string;
	/** npm install spec for this release; defaults to `<packageName>@<version>`. */
	installSpec?: string;
	note?: string;
}

/** Include useful errno details hidden behind Node's generic "fetch failed" error. */
export function formatVersionCheckError(error: unknown): string {
	const rootMessage = error instanceof Error && error.message ? error.message : String(error);
	const cause = error instanceof Error ? error.cause : undefined;
	const causes = cause instanceof AggregateError ? cause.errors : cause === undefined ? [] : [cause];
	const codes = causes
		.map((value) =>
			typeof value === "object" && value !== null && "code" in value && typeof value.code === "string"
				? value.code
				: undefined,
		)
		.filter((code): code is string => code !== undefined);

	if (codes.length > 0) return `${rootMessage} (${[...new Set(codes)].join(", ")})`;
	const causeMessage = causes.find(
		(value): value is Error => value instanceof Error && Boolean(value.message),
	)?.message;
	return causeMessage ? `${rootMessage} (cause: ${causeMessage})` : rootMessage;
}

export function comparePackageVersions(leftVersion: string, rightVersion: string): number | undefined {
	const left = valid(leftVersion.trim());
	const right = valid(rightVersion.trim());
	if (!left || !right) {
		return undefined;
	}
	return compare(left, right);
}

export function isNewerPackageVersion(candidateVersion: string, currentVersion: string): boolean {
	const comparison = comparePackageVersions(candidateVersion, currentVersion);
	if (comparison !== undefined) {
		return comparison > 0;
	}
	return candidateVersion.trim() !== currentVersion.trim();
}

export async function getLatestPiRelease(
	currentVersion: string,
	options: { timeoutMs?: number; retry?: boolean } = {},
): Promise<LatestPiRelease | undefined> {
	if (process.env.PI_OFFLINE) return undefined;

	const response = await fetchWithRetry(
		LATEST_VERSION_URL,
		{
			headers: {
				"User-Agent": getPiUserAgent(currentVersion),
				accept: "application/vnd.github+json",
			},
		},
		{
			maxRetries: options.retry ? 2 : 0,
			timeoutMs: options.timeoutMs ?? DEFAULT_VERSION_CHECK_TIMEOUT_MS,
		},
	);
	if (!response.ok) return undefined;

	const data = (await response.json()) as {
		tag_name?: unknown;
		assets?: unknown;
	};
	if (typeof data.tag_name !== "string" || !data.tag_name.startsWith(FORK_TAG_PREFIX)) {
		return undefined;
	}
	const version = data.tag_name.slice(FORK_TAG_PREFIX.length).trim();
	const assets = Array.isArray(data.assets)
		? (data.assets as { name?: unknown; browser_download_url?: unknown }[])
		: [];
	const tarball = assets.find((asset) => typeof asset.name === "string" && asset.name.endsWith(".tgz"));
	if (!version || typeof tarball?.browser_download_url !== "string") {
		return undefined;
	}
	return { version, installSpec: tarball.browser_download_url };
}

export async function getLatestPiVersion(
	currentVersion: string,
	options: { timeoutMs?: number; retry?: boolean } = {},
): Promise<string | undefined> {
	return (await getLatestPiRelease(currentVersion, options))?.version;
}

export async function checkForNewPiVersion(currentVersion: string): Promise<LatestPiRelease | undefined> {
	if (process.env.PI_SKIP_VERSION_CHECK) return undefined;

	try {
		const latestRelease = await getLatestPiRelease(currentVersion);
		if (latestRelease && isNewerPackageVersion(latestRelease.version, currentVersion)) {
			return latestRelease;
		}
		return undefined;
	} catch {
		return undefined;
	}
}
