import fs from "fs";
import path from "path";
import { rimrafSync } from "rimraf";

import { extractArchive } from "../lsp/extractServer";
import { BINARY_NAME, CFLINT_REPO, GITHUB_REPO, assetCandidates, cflintAssetCandidates, pinnedTag, platformForTarget, tagFromReleaseRedirect } from "../lsp/serverAsset";

/**
 * The repository root, from this script's location.
 * @returns the absolute path to the repository root
 */
export function repositoryRoot(): string {
	return path.join(__dirname, "..", "..");
}

/**
 * Removes a bundled server, so the next package built is a universal one.
 *
 * Worth doing after building a platform package: a `server/` left behind is
 * one platform's binary that a later `vsce package` with no target would ship
 * to everybody.
 */
export function removeBundledServer(): void {
	const serverDir = path.join(repositoryRoot(), "server");

	if (fs.existsSync(serverDir) && !rimrafSync(serverDir)) {
		throw new Error(`Failed to clean "${serverDir}"`);
	}
}

/**
 * Puts a language server binary in `server/`, ready to be packaged into a
 * platform-specific VSIX.
 *
 * Every published extension then carries the server for the platform it is
 * published for, so a first run needs no network: the download path stays, but
 * only as a way to move to a newer server than the one that shipped.
 * @param target the VS Code packaging target, e.g. `darwin-arm64`
 * @param version the server version to bundle, defaulting to `cfmlLspVersion`
 * @returns the tag that was bundled
 */
export async function bundleServer(target: string, version?: string): Promise<string> {
	const rootDir = repositoryRoot();
	const serverDir = path.join(rootDir, "server");

	const configuredVersion = version ?? readBundledVersion(rootDir);
	const tag = pinnedTag(configuredVersion) ?? await resolveLatestTag();
	const { platform, arch } = platformForTarget(target);
	const { assetNames, binaryName } = assetCandidates(platform, arch);

	console.log("Bundling server".padEnd(26), "=>", `${tag} for ${target} (${platform}-${arch})`);

	removeBundledServer();
	fs.mkdirSync(serverDir, { recursive: true });

	// The same candidate list the extension uses at runtime, so a target that
	// has no asset fails here — in a build — rather than on a user's machine.
	let lastError: Error | undefined;
	for (const assetName of assetNames) {
		const url = `https://github.com/${GITHUB_REPO}/releases/download/${tag}/${assetName}`;
		const archivePath = path.join(serverDir, assetName);

		console.log("Downloading".padEnd(26), "=>", url);
		try {
			await downloadFile(url, archivePath);
		}
		catch (e: unknown) {
			lastError = e instanceof Error ? e : new Error(String(e));
			console.log("Not available".padEnd(26), "=>", lastError.message);
			continue;
		}

		await extractArchive(archivePath, serverDir, binaryName);
		fs.rmSync(archivePath, { force: true });

		const binaryPath = path.join(serverDir, binaryName);
		if (!fs.existsSync(binaryPath)) {
			throw new Error(`${assetName} did not contain ${binaryName}`);
		}

		fs.chmodSync(binaryPath, 0o755);
		fs.writeFileSync(path.join(serverDir, "version.txt"), `${tag}\n`);

		console.log("Bundled".padEnd(26), "=>", `${path.relative(rootDir, binaryPath)} (${(fs.statSync(binaryPath).size / 1024 / 1024).toFixed(1)} MB)`);

		await bundleCflint(target, serverDir, rootDir);

		return tag;
	}

	throw new Error(`No server asset for ${target} in ${tag}: ${lastError?.message ?? "none of the candidates existed"}`);
}

function parseArgs(argv: string[]): { target?: string; version?: string } {
	const args: { target?: string; version?: string } = {};

	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--target") {
			args.target = argv[++i];
		}
		else if (argv[i] === "--version") {
			args.version = argv[++i];
		}
	}

	return args;
}

/**
 * The server version this extension ships, from package.json.
 *
 * Declared there rather than passed on the command line so a release builds the
 * same server for every target, and so the version that shipped is in the
 * history next to the extension version that shipped it.
 * @param rootDir the repository root
 * @returns the configured version, or `latest` when none is pinned
 */
function readBundledVersion(rootDir: string): string {
	const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8")) as { cfmlLspVersion?: string };

	return manifest.cfmlLspVersion ?? "latest";
}

async function resolveLatestTag(): Promise<string> {
	// The redirect is the answer, and reading it avoids the releases API's rate
	// limit — the same route the extension itself takes.
	const response = await fetch(`https://github.com/${GITHUB_REPO}/releases/latest`, { redirect: "manual" });

	return tagFromReleaseRedirect(response.headers.get("location") ?? "");
}

async function downloadFile(url: string, dest: string): Promise<void> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`HTTP ${response.status} downloading ${url}`);
	}

	fs.writeFileSync(dest, Buffer.from(await response.arrayBuffer()));
}

/**
 * Puts CFLint beside the server, when a native build exists for the platform.
 *
 * The server runs CFLint itself and looks for `cflint` on PATH before anything
 * else, so the extension only has to put this directory on the server's PATH —
 * no setting, and no agreement between the two beyond the name.
 *
 * A platform with no published build is not an error: CFLint has no macOS
 * Intel binary yet, and the server downloads one at first use anyway. Those
 * packages simply ship without it, and pick it up the day the build appears.
 * @param target the VS Code packaging target
 * @param serverDir where the server was bundled
 * @param rootDir the repository root
 */
async function bundleCflint(target: string, serverDir: string, rootDir: string): Promise<void> {
	const version = readCflintVersion(rootDir);
	const { platform, arch } = platformForTarget(target);
	const { assetNames, binaryName } = cflintAssetCandidates(platform, arch);
	const binaryPath = path.join(serverDir, binaryName);

	for (const assetName of assetNames) {
		const url = `https://github.com/${CFLINT_REPO}/releases/download/${version}/${assetName}`;
		const downloadPath = path.join(serverDir, assetName);

		console.log("Downloading CFLint".padEnd(26), "=>", url);
		try {
			await downloadFile(url, downloadPath);
		}
		catch (e: unknown) {
			console.log("Not available".padEnd(26), "=>", e instanceof Error ? e.message : String(e));
			continue;
		}

		// The compressed assets hold the binary under its plain name; the raw
		// ones are the binary, already downloaded to the wrong name.
		if (assetName.endsWith(".tar.gz") || assetName.endsWith(".zip")) {
			await extractArchive(downloadPath, serverDir, binaryName);
			fs.rmSync(downloadPath, { force: true });
		}
		else if (downloadPath !== binaryPath) {
			fs.renameSync(downloadPath, binaryPath);
		}

		if (!fs.existsSync(binaryPath)) {
			throw new Error(`${assetName} did not contain ${binaryName}`);
		}

		fs.chmodSync(binaryPath, 0o755);
		console.log("Bundled CFLint".padEnd(26), "=>", `${path.relative(rootDir, binaryPath)} (${(fs.statSync(binaryPath).size / 1024 / 1024).toFixed(1)} MB)`);

		return;
	}

	console.log("No CFLint build".padEnd(26), "=>", `${target} ships without one; the server downloads it at first use`);
}

/**
 * The CFLint version this extension ships, from package.json.
 * @param rootDir the repository root
 * @returns the configured version
 */
function readCflintVersion(rootDir: string): string {
	const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8")) as { cflintVersion?: string };

	return manifest.cflintVersion ?? "1.5.16";
}

/**
 * Usage: `npm run bundle-server -- --target darwin-arm64 [--version 0.3.2]`
 */
async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	if (!args.target) {
		throw new Error("--target is required, e.g. --target darwin-arm64");
	}

	await bundleServer(args.target, args.version);
}

// Only when run as a script: `package-targets` imports `bundleServer` instead.
if (require.main === module) {
	main().catch((e: unknown) => {
		console.error(`Failed to bundle ${BINARY_NAME}:`, e instanceof Error ? e.message : e);
		process.exit(1);
	});
}
