import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

import { buildPackages, displayPath } from "./package-targets";
import { repositoryRoot } from "./download-server";

/** A place packages get published to, and the token that lets us. */
interface Registry {
	name: string;
	command: string;
	tokenVar: string;
}

const REGISTRIES: Registry[] = [
	{ name: "VS Marketplace", command: "vsce", tokenVar: "VSCE_PAT" },
	{ name: "Open VSX", command: "ovsx", tokenVar: "OVSX_PAT" },
];

/**
 * Builds and publishes a release: every platform package, plus the universal
 * fallback, to every registry.
 *
 * One command for the whole thing because the pieces have to agree — the same
 * version for every target, each carrying its own platform's server, and the
 * universal one built with none. A release assembled by hand is one forgotten
 * step away from publishing a Windows package with a macOS server inside it,
 * or leaving a platform on the previous version.
 *
 * Usage: `npm run publish [-- --dry-run] [--skip-build] [--only vsce] [--targets linux-x64,darwin-arm64]`
 */
async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const rootDir = repositoryRoot();
	const outDir = path.resolve(rootDir, args.out ?? "packages");
	const registries = REGISTRIES.filter(registry => !args.only || args.only === registry.command);

	if (registries.length === 0) {
		throw new Error(`--only takes one of ${REGISTRIES.map(r => r.command).join(", ")}`);
	}

	// Before the build, not after: the build takes a minute and a half, and
	// finding out then that half the release cannot go anywhere is a waste of
	// it — and leaves a half-published release if the other half succeeds.
	const missing = registries.filter(registry => !process.env[registry.tokenVar]);
	if (missing.length > 0 && !args.dryRun) {
		throw new Error(`No token for ${missing.map(r => `${r.name} (set ${r.tokenVar})`).join(" or ")}`);
	}

	console.log("Publishing".padEnd(26), "=>", `${readExtensionVersion(rootDir)} to ${registries.map(r => r.name).join(" and ")}`);

	const packages = args.skipBuild
		? existingPackages(outDir)
		: await buildPackages({ targets: args.targets, out: args.out, version: args.version, universal: args.universal });

	if (packages.length === 0) {
		throw new Error(`No packages in ${displayPath(outDir)} to publish`);
	}

	for (const registry of registries) {
		publish(registry, packages, rootDir, args.dryRun);
	}

	console.log("");
	console.log(args.dryRun ? "Dry run: nothing was published." : `Published ${packages.length} package${packages.length === 1 ? "" : "s"}.`);
}

/**
 * Sends every package to one registry in a single call.
 *
 * `--skip-duplicate` rather than failing on a version already up: a release
 * that fell over half way through is then finished by running this again,
 * instead of having to work out which packages made it.
 * @param registry where to publish
 * @param packages the packages to publish
 * @param rootDir the repository root
 * @param dryRun print the command instead of running it
 */
function publish(registry: Registry, packages: string[], rootDir: string, dryRun: boolean): void {
	const args = [registry.command, "publish", "--packagePath", ...packages, "--skip-duplicate"];

	console.log("");
	console.log((dryRun ? "Would publish" : "Publishing").padEnd(26), "=>", registry.name);

	if (dryRun) {
		console.log(`  npx ${registry.command} publish --packagePath ${displayPath(path.dirname(packages[0]))}/*.vsix --skip-duplicate`);
		return;
	}

	// The token comes from the environment the registry's own CLI reads, so it
	// stays out of the argument list and out of any process listing.
	const result = spawnSync("npx", args, { cwd: rootDir, stdio: "inherit" });
	if (result.status !== 0) {
		throw new Error(`${registry.name} publish exited with ${result.status ?? "a signal"}`);
	}
}

function existingPackages(outDir: string): string[] {
	if (!fs.existsSync(outDir)) {
		return [];
	}

	return fs.readdirSync(outDir)
		.filter(file => file.endsWith(".vsix"))
		.map(file => path.join(outDir, file));
}

function parseArgs(argv: string[]): { targets?: string[]; out?: string; version?: string; universal?: boolean; only?: string; dryRun: boolean; skipBuild: boolean } {
	const args: { targets?: string[]; out?: string; version?: string; universal?: boolean; only?: string; dryRun: boolean; skipBuild: boolean } = {
		dryRun: false,
		skipBuild: false,
	};

	for (let i = 0; i < argv.length; i++) {
		switch (argv[i]) {
			case "--targets":
				args.targets = argv[++i].split(",").map(target => target.trim()).filter(Boolean);
				break;
			case "--out":
				args.out = argv[++i];
				break;
			case "--version":
				args.version = argv[++i];
				break;
			case "--no-universal":
				args.universal = false;
				break;
			case "--only":
				args.only = argv[++i];
				break;
			case "--dry-run":
				args.dryRun = true;
				break;
			case "--skip-build":
				args.skipBuild = true;
				break;
			default:
				throw new Error(`Unknown argument ${argv[i]}`);
		}
	}

	return args;
}

function readExtensionVersion(rootDir: string): string {
	const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8")) as { version: string };

	return manifest.version;
}

main().catch((e: unknown) => {
	console.error("Failed to publish:", e instanceof Error ? e.message : e);
	process.exit(1);
});
