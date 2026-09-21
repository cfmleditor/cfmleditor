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
 * Builds every VSIX a release needs: one per platform with the server inside,
 * plus a universal one with no server at all.
 *
 * The release workflow does the same thing, one target per job. This is the
 * same sequence in one command for building a release by hand, and it is the
 * safe way to do it: packaging a target without bundling its server first
 * ships whichever platform's binary happened to be left in `server/`.
 *
 * Usage: `npm run package-targets [-- --targets darwin-arm64,linux-x64] [--out packages] [--no-universal] [--version 0.3.2]`
 */
async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const rootDir = repositoryRoot();
	const outDir = path.resolve(rootDir, args.out ?? "packages");
	const targets = args.targets ?? SERVER_TARGETS;
	const version = readExtensionVersion(rootDir);

	fs.mkdirSync(outDir, { recursive: true });

	const built: string[] = [];

	for (const target of targets) {
		await bundleServer(target, args.version);
		built.push(packageExtension(rootDir, outDir, `cfmleditor-${version}-${target}.vsix`, target));
	}

	if (args.universal) {
		// Last, and only after the bundled server is gone: a universal package
		// that picked one up would hand every platform the same binary.
		removeBundledServer();
		built.push(packageExtension(rootDir, outDir, `cfmleditor-${version}.vsix`, undefined));
	}
	else {
		removeBundledServer();
	}

	console.log("");
	for (const vsix of built) {
		console.log("Packaged".padEnd(26), "=>", `${path.relative(rootDir, vsix)} (${(fs.statSync(vsix).size / 1024 / 1024).toFixed(2)} MB)`);
	}

	console.log("");
	console.log("To publish these, with the same version for every target:");
	console.log(`  for vsix in ${path.relative(rootDir, outDir)}/*.vsix; do npx vsce publish --packagePath "$vsix" -p $VSCE_PAT; done`);
	console.log(`  for vsix in ${path.relative(rootDir, outDir)}/*.vsix; do npx ovsx publish "$vsix" -p $OVSX_PAT; done`);
}

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

main().catch((e: unknown) => {
	console.error("Failed to package targets:", e instanceof Error ? e.message : e);
	process.exit(1);
});
