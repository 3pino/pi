#!/usr/bin/env node
// 3pino fork: build the coding-agent npm tarball and publish it as a GitHub Release of the fork.
// `pi update` installs the tarball of the latest release (see packages/coding-agent/src/utils/version-check.ts).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { execNpmSync } from "./npm-command.mjs";

const FORK_REPO = "3pino/pi";
const TAG_PREFIX = "fork-v";
const PRERELEASE_ID = "3pino";

const { values } = parseArgs({
	options: {
		"dry-run": { type: "boolean", default: false },
		"skip-build": { type: "boolean", default: false },
		help: { type: "boolean", default: false },
	},
});
if (values.help) {
	console.log(`Usage: node scripts/fork-release.mjs [options]

Builds packages/coding-agent, packs it as version <upstream>-${PRERELEASE_ID}.<n>,
smoke tests the tarball, and creates the GitHub Release ${TAG_PREFIX}<version> on ${FORK_REPO}.

Options:
  --dry-run      Build, pack, and smoke test only; keep the tarball and skip the release
  --skip-build   Reuse the existing build output
  --help         Show this help
`);
	process.exit(0);
}

function git(args) {
	return execFileSync("git", args, { encoding: "utf8" }).trim();
}

const repoRoot = process.cwd();
if (JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).name !== "pi-monorepo") {
	throw new Error("Run this script from the repository root");
}
const codingAgentDir = join(repoRoot, "packages", "coding-agent");

if (!values["dry-run"]) {
	if (git(["rev-parse", "--abbrev-ref", "HEAD"]) !== "main") throw new Error("Release from main");
	if (git(["status", "--porcelain"]) !== "") throw new Error("Working tree must be clean");
	git(["fetch", "origin", "main"]);
	if (git(["rev-parse", "HEAD"]) !== git(["rev-parse", "origin/main"])) {
		throw new Error("HEAD must match origin/main; push first");
	}
}
const headSha = git(["rev-parse", "HEAD"]);

const baseVersion = JSON.parse(readFileSync(join(codingAgentDir, "package.json"), "utf8")).version;
const tagPattern = `${TAG_PREFIX}${baseVersion}-${PRERELEASE_ID}.`;
const releaseNumbers = git(["ls-remote", "--tags", "origin", `refs/tags/${tagPattern}*`])
	.split("\n")
	.map((line) => line.split("refs/tags/")[1]?.slice(tagPattern.length))
	.map((suffix) => Number.parseInt(suffix ?? "", 10))
	.filter((n) => Number.isInteger(n));
const version = `${baseVersion}-${PRERELEASE_ID}.${Math.max(0, ...releaseNumbers) + 1}`;
const tag = `${TAG_PREFIX}${version}`;
console.log(`Preparing ${tag} from ${headSha}`);

if (!values["skip-build"]) execNpmSync(["run", "build"], { cwd: repoRoot, stdio: "inherit" });

const workDir = mkdtempSync(join(tmpdir(), "pi-fork-release-"));
let keepWorkDir = values["dry-run"];
try {
	execNpmSync(["pack", "--ignore-scripts", "--pack-destination", workDir], { cwd: codingAgentDir, stdio: "inherit" });
	const packed = readdirSync(workDir).find((name) => name.endsWith(".tgz"));
	if (!packed) throw new Error("npm pack produced no tarball");
	execFileSync("tar", ["-xzf", join(workDir, packed), "-C", workDir]);
	const packageDir = join(workDir, "package");
	const packageJsonPath = join(packageDir, "package.json");
	const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
	packageJson.version = version;
	writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, "\t")}\n`);

	const outDir = join(workDir, "out");
	mkdirSync(outDir);
	execNpmSync(["pack", "--ignore-scripts", "--pack-destination", outDir], { cwd: packageDir, stdio: "inherit" });
	const tarball = join(outDir, `earendil-works-pi-coding-agent-${version}.tgz`);
	if (!existsSync(tarball)) throw new Error(`Missing tarball: ${tarball}`);

	// Install outside the repository so workspace packages cannot satisfy the dependencies.
	const installDir = join(workDir, "install");
	mkdirSync(installDir);
	execNpmSync(["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], {
		cwd: installDir,
		stdio: "inherit",
	});
	const reported = execFileSync(join(installDir, "node_modules", ".bin", "pi"), ["--version"], {
		cwd: installDir,
		encoding: "utf8",
	}).trim();
	if (!reported.includes(version)) throw new Error(`Smoke test reported "${reported}", expected ${version}`);
	console.log(`Smoke test passed: pi --version -> ${reported}`);

	if (values["dry-run"]) {
		console.log(`\nDry run; release skipped. Tarball: ${tarball}`);
	} else {
		const notes = `Fork release based on upstream ${baseVersion} (commit ${headSha}).

Install or switch to this fork:

\`\`\`sh
npm install -g https://github.com/${FORK_REPO}/releases/download/${tag}/earendil-works-pi-coding-agent-${version}.tgz
\`\`\`

Afterwards, \`pi update\` installs newer fork releases.`;
		execFileSync(
			"gh",
			["release", "create", tag, tarball, "-R", FORK_REPO, "--target", headSha, "--title", tag, "--notes", notes],
			{ stdio: "inherit" },
		);
	}
} catch (error) {
	keepWorkDir = true;
	console.error(`Work directory kept for inspection: ${workDir}`);
	throw error;
} finally {
	if (!keepWorkDir) rmSync(workDir, { force: true, recursive: true });
}
