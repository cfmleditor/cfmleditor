import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

import { bundleServer, removeBundledServer, repositoryRoot } from "./download-server";

/**
 * The platforms the language server is published for, and so the packages that
 * carry one. Everything else — armhf, alpine, web, anything new — installs the
 * universal package and downloads a server on demand.
 */
const SERVER_TARGETS = [
	"win32-x64",
	"win32-arm64",
	"linux-x64",
	"linux-arm64",
	"darwin-x64",
	"darwin-arm64",
];

/**
 * A path as it is worth reading in output: relative when that is shorter and
 * still inside the repository, absolute when it is not.
 * @param target the path to show
 * @returns the path to print
 */
export function displayPath(target: string): string {
	const relative = path.relative(repositoryRoot(), target);

	return relative.startsWith("..") ? target : relative;
}

/** What to build. */
export interface PackageOptions {
	/** The platform targets to build, defaulting to every platform with a server. */
	targets?: string[];
	/** Where the packages go, relative to the repository root. */
	out?: string;
	/** A server version to bundle instead of `cfmlLspVersion`. */
	version?: string;
	/** Whether to build the universal fallback package as well. */
	universal?: boolean;
}

/**
 * Builds every VSIX a release needs: one per platform with the server inside,
 * plus a universal one with no server at all.
 *
 * The release workflow does the same thing, one target per job. This is the
 * same sequence in one command for building a release by hand, and it is the
 * safe way to do it: packaging a target without bundling its server first
 * ships whichever platform's binary happened to be left in `server/`.
 * @param options what to build and where to put it
 * @returns the packages that were built, in the order they were built
 */
export async function buildPackages(options: PackageOptions = {}): Promise<string[]> {
	const rootDir = repositoryRoot();
	const outDir = path.resolve(rootDir, options.out ?? "packages");
	const targets = options.targets ?? SERVER_TARGETS;
	const version = readExtensionVersion(rootDir);

	fs.mkdirSync(outDir, { recursive: true });

	const built: string[] = [];

	for (const target of targets) {
		await bundleServer(target, options.version);
		built.push(packageExtension(rootDir, outDir, `cfmleditor-${version}-${target}.vsix`, target));
	}

	// The bundled server goes before the universal package is built, whether or
	// not one is wanted: a universal package that picked one up would hand
	// every platform the same binary, and a `server/` left behind is a trap for
	// the next `vsce package` anyone runs by hand.
	removeBundledServer();

	if (options.universal !== false) {
		built.push(packageExtension(rootDir, outDir, `cfmleditor-${version}.vsix`, undefined));
	}

	console.log("");
	for (const vsix of built) {
		console.log("Packaged".padEnd(26), "=>", `${displayPath(vsix)} (${(fs.statSync(vsix).size / 1024 / 1024).toFixed(2)} MB)`);
	}

	return built;
}

/**
 * Usage: `npm run package-targets [-- --targets darwin-arm64,linux-x64] [--out packages] [--no-universal] [--version 0.3.2]`
 */
async function main(): Promise<void> {
	const built = await buildPackages(parseArgs(process.argv.slice(2)));

	const outDir = displayPath(path.dirname(built[0]));

	console.log("");
	console.log(`${built.length} package${built.length === 1 ? "" : "s"} built. \`npm run publish\` builds and publishes the lot;`);
	console.log("to publish what is here, without rebuilding:");
	console.log(`  npm run publish -- --skip-build${outDir === "packages" ? "" : ` --out ${outDir}`}`);
}

/**
 * Runs `vsce package` for one target.
 * @param rootDir the repository root
 * @param outDir where the package goes
 * @param fileName the package's file name
 * @param target the platform target, or undefined for the universal package
 * @returns the path to the package that was built
 */
function packageExtension(rootDir: string, outDir: string, fileName: string, target: string | undefined): string {
	const outPath = path.join(outDir, fileName);
	const args = ["vsce", "package", "--out", outPath, ...(target ? ["--target", target] : [])];

	console.log("");
	console.log("Packaging".padEnd(26), "=>", target ?? "universal");

	const result = spawnSync("npx", args, { cwd: rootDir, stdio: "inherit" });
	if (result.status !== 0) {
		throw new Error(`vsce package ${target ?? "universal"} exited with ${result.status ?? "a signal"}`);
	}

	return outPath;
}

function parseArgs(argv: string[]): { targets?: string[]; out?: string; version?: string; universal: boolean } {
	const args: { targets?: string[]; out?: string; version?: string; universal: boolean } = { universal: true };

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

// Only when run as a script: `publish-targets` imports `buildPackages` instead.
if (require.main === module) {
	main().catch((e: unknown) => {
		console.error("Failed to package targets:", e instanceof Error ? e.message : e);
		process.exit(1);
	});
}
