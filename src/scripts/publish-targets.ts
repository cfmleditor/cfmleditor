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

/** A registry and how this machine is authenticated to it, if it is. */
interface Credential {
	registry: Registry;
	/** Where the credential comes from, or undefined when there is none. */
	source: string | undefined;
}

const REGISTRIES: Registry[] = [
	{ name: "VS Marketplace", command: "vsce", tokenVar: "VSCE_PAT" },
	{ name: "Open VSX", command: "ovsx", tokenVar: "OVSX_PAT" },
];

// Open VSX is paused: it is still wired up and one `--registries vsce,ovsx`
// away, but a plain release does not go there.
const DEFAULT_REGISTRIES = ["vsce"];

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
 * Usage: `npm run publish [-- --dry-run] [--skip-build] [--registries vsce,ovsx] [--targets linux-x64,darwin-arm64]`
 */
async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const rootDir = repositoryRoot();
	const outDir = path.resolve(rootDir, args.out ?? "packages");
	const wanted = args.registries ?? DEFAULT_REGISTRIES;
	const unknown = wanted.filter(name => !REGISTRIES.some(registry => registry.command === name));

	if (unknown.length > 0) {
		throw new Error(`--registries takes ${REGISTRIES.map(r => r.command).join(" and ")}, not ${unknown.join(", ")}`);
	}

	const registries = REGISTRIES.filter(registry => wanted.includes(registry.command));

	// Checked before the build, not after: the build takes a minute and a half,
	// and finding out then that half the release cannot go anywhere wastes it —
	// and leaves a half-published release if the other half succeeds.
	const credentials: Credential[] = registries.map(registry => ({ registry, source: credentialFor(registry, rootDir) }));

	for (const credential of credentials) {
		console.log("Credential".padEnd(26), "=>", `${credential.registry.name}: ${credential.source ?? "none"}`);
	}

	const missing = credentials.filter(credential => !credential.source);
	if (missing.length > 0 && !args.dryRun) {
		throw new Error(`No credential for ${missing.map(m => describeMissing(m.registry, rootDir)).join(" or ")}`);
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
 * How this machine is authenticated to a registry, if it is.
 *
 * An environment variable is not the only way: `vsce login <publisher>` puts a
 * token in the OS keychain and `vsce publish` uses it when none is passed, so
 * demanding `VSCE_PAT` turned a machine that was already logged in away at the
 * door. Open VSX has no equivalent — `ovsx` reads `OVSX_PAT` or takes `-p`.
 * @param registry the registry to check
 * @param rootDir the repository root
 * @returns where the credential comes from, or undefined when there is none
 */
export function credentialFor(registry: Registry, rootDir: string): string | undefined {
	if (process.env[registry.tokenVar]) {
		return registry.tokenVar;
	}

	if (registry.command !== "vsce") {
		return undefined;
	}

	const publisher = readPublisher(rootDir);

	return storedPublishers(rootDir).includes(publisher) ? `vsce login ${publisher}` : undefined;
}

/**
 * Names both ways of supplying a registry's credential, for the error a
 * machine with neither is going to see.
 * @param registry the registry with no credential
 * @param rootDir the repository root
 * @returns the registry and what to do about it
 */
function describeMissing(registry: Registry, rootDir: string): string {
	if (registry.command === "vsce") {
		return `${registry.name} (set ${registry.tokenVar}, or run \`npx vsce login ${readPublisher(rootDir)}\`)`;
	}

	return `${registry.name} (set ${registry.tokenVar})`;
}

/**
 * The publishers `vsce login` has stored on this machine.
 * @param rootDir the repository root
 * @returns the publisher names, or an empty list when none are stored
 */
function storedPublishers(rootDir: string): string[] {
	const result = spawnSync("npx", ["vsce", "ls-publishers"], { cwd: rootDir, encoding: "utf8" });
	if (result.status !== 0 || !result.stdout) {
		return [];
	}

	return result.stdout.split("\n").map(line => line.trim()).filter(Boolean);
}

function readPublisher(rootDir: string): string {
	const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8")) as { publisher: string };

	return manifest.publisher;
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

	// The credential is left to the registry's own CLI — an environment
	// variable it reads itself, or the keychain entry `vsce login` wrote — so
	// no token passes through this script's arguments or any process listing.
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

function parseArgs(argv: string[]): { targets?: string[]; out?: string; version?: string; universal?: boolean; registries?: string[]; dryRun: boolean; skipBuild: boolean } {
	const args: { targets?: string[]; out?: string; version?: string; universal?: boolean; registries?: string[]; dryRun: boolean; skipBuild: boolean } = {
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
			case "--registries":
				args.registries = argv[++i].split(",").map(name => name.trim()).filter(Boolean);
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

// Only when run as a script, so the credential rules can be tested without
// publishing anything.
if (require.main === module) {
	main().catch((e: unknown) => {
		console.error("Failed to publish:", e instanceof Error ? e.message : e);
		process.exit(1);
	});
}
