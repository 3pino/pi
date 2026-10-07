import { FORK_REPO } from "../src/utils/version-check.ts";

export const FORK_LATEST_RELEASE_URL = `https://api.github.com/repos/${FORK_REPO}/releases/latest`;

export function forkTarballUrl(version: string): string {
	return `https://github.com/${FORK_REPO}/releases/download/fork-v${version}/earendil-works-pi-coding-agent-${version}.tgz`;
}

/** GitHub latest-release API response for a fork release. */
export function forkReleaseResponse(version: string): Response {
	return Response.json({
		tag_name: `fork-v${version}`,
		assets: [
			{ name: "notes.txt", browser_download_url: "https://example.test/notes.txt" },
			{ name: `earendil-works-pi-coding-agent-${version}.tgz`, browser_download_url: forkTarballUrl(version) },
		],
	});
}
