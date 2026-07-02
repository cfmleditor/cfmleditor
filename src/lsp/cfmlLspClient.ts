import * as fs from "fs";
import * as https from "https";
import * as os from "os";
import * as path from "path";
import * as zlib from "zlib";
import { ExtensionContext, ProgressLocation, window, workspace } from "vscode";
import { LanguageClient, LanguageClientOptions, ServerOptions } from "vscode-languageclient/node";

const GITHUB_REPO = "cfmleditor/cfmleditor-lsp";
const BINARY_NAME = "cfmleditor-lsp";

let client: LanguageClient | undefined;

function getConfig() {
	return workspace.getConfiguration("cfml.lsp");
}

function getPlatformAsset(): { assetName: string; binaryName: string } {
	const platform = os.platform();
	const arch = os.arch();

	const osStr = platform === "win32" ? "windows" : platform === "darwin" ? "darwin" : "linux";
	const archStr = arch === "arm64" ? "arm64" : "amd64";
	const ext = platform === "win32" ? "zip" : "tar.gz";
	const binaryName = platform === "win32" ? `${BINARY_NAME}.exe` : BINARY_NAME;

	return { assetName: `${BINARY_NAME}-${osStr}-${archStr}.${ext}`, binaryName };
}

async function fetchJson(url: string): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const get = (u: string) => {
			https.get(u, { headers: { "User-Agent": "cfmleditor-vscode" } }, (res) => {
				if (res.statusCode === 301 || res.statusCode === 302) {
					get(res.headers.location!);
					return;
				}
				if (res.statusCode !== 200) {
					reject(new Error(`HTTP ${res.statusCode} fetching ${u}`));
					return;
				}
				let data = "";
				res.on("data", chunk => data += chunk);
				res.on("end", () => resolve(JSON.parse(data)));
				res.on("error", reject);
			}).on("error", reject);
		};
		get(url);
	});
}

async function downloadFile(url: string, dest: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const get = (u: string) => {
			https.get(u, { headers: { "User-Agent": "cfmleditor-vscode" } }, (res) => {
				if (res.statusCode === 301 || res.statusCode === 302) {
					get(res.headers.location!);
					return;
				}
				if (res.statusCode !== 200) {
					reject(new Error(`HTTP ${res.statusCode} downloading ${u}`));
					return;
				}
				const file = fs.createWriteStream(dest);
				res.pipe(file);
				file.on("finish", () => {
					file.close();
					resolve();
				});
				file.on("error", reject);
			}).on("error", reject);
		};
		get(url);
	});
}

async function extractTarGz(archivePath: string, destDir: string, binaryName: string): Promise<void> {
	// Simple tar.gz extraction for a single binary file
	const { extract } = await import("tar-stream");
	const extractStream = extract();
	const input = fs.createReadStream(archivePath).pipe(zlib.createGunzip());

	return new Promise((resolve, reject) => {
		extractStream.on("entry", (header, stream, next) => {
			const name = path.basename(header.name);
			if (name === binaryName) {
				const outPath = path.join(destDir, binaryName);
				const out = fs.createWriteStream(outPath, { mode: 0o755 });
				stream.pipe(out);
				out.on("finish", next);
				out.on("error", reject);
			}
			else {
				stream.resume();
				next();
			}
		});
		extractStream.on("finish", resolve);
		extractStream.on("error", reject);
		input.pipe(extractStream);
		input.on("error", reject);
	});
}

interface GithubRelease {
	tag_name: string;
	assets: { name: string; browser_download_url: string }[];
}

async function resolveRelease(version: string): Promise<GithubRelease> {
	const url = version === "latest"
		? `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
		: `https://api.github.com/repos/${GITHUB_REPO}/releases/tags/v${version}`;
	return await fetchJson(url) as GithubRelease;
}

async function ensureBinary(context: ExtensionContext): Promise<string | undefined> {
	// If user set an explicit path, use it directly
	const manualPath = getConfig().get<string>("path");
	if (manualPath) {
		return manualPath;
	}

	const version = getConfig().get<string>("version", "latest");
	const storageDir = context.globalStorageUri.fsPath;
	const { assetName, binaryName } = getPlatformAsset();

	// Resolve the actual version tag
	let release: GithubRelease;
	try {
		release = await resolveRelease(version);
	}
	catch (e) {
		// If we can't reach GitHub, try to use whatever we have cached
		const existing = findCachedBinary(storageDir, binaryName);
		if (existing) {
			return existing;
		}
		throw e;
	}

	const tag = release.tag_name;
	const versionDir = path.join(storageDir, `cfmleditor-lsp-${tag}`);
	const binaryPath = path.join(versionDir, binaryName);

	// Already downloaded?
	if (fs.existsSync(binaryPath)) {
		return binaryPath;
	}

	// Find the asset
	const asset = release.assets.find(a => a.name === assetName);
	if (!asset) {
		throw new Error(`No release asset found for this platform: ${assetName}`);
	}

	// Download with progress
	await window.withProgress(
		{ location: ProgressLocation.Notification, title: "CFML LSP", cancellable: false },
		async (progress) => {
			progress.report({ message: `Downloading ${tag}...` });
			fs.mkdirSync(versionDir, { recursive: true });
			const archivePath = path.join(versionDir, assetName);

			await downloadFile(asset.browser_download_url, archivePath);

			progress.report({ message: "Extracting..." });
			if (assetName.endsWith(".tar.gz")) {
				await extractTarGz(archivePath, versionDir, binaryName);
			}
			else {
				// zip - use yauzl or shell unzip
				const { execSync } = await import("child_process");
				execSync(`unzip -o "${archivePath}" -d "${versionDir}"`);
			}

			// Cleanup archive
			fs.unlinkSync(archivePath);

			// Ensure executable
			if (os.platform() !== "win32") {
				fs.chmodSync(binaryPath, 0o755);
			}
		}
	);

	return binaryPath;
}

function findCachedBinary(storageDir: string, binaryName: string): string | undefined {
	if (!fs.existsSync(storageDir)) {
		return undefined;
	}
	const dirs = fs.readdirSync(storageDir)
		.filter(d => d.startsWith("cfmleditor-lsp-v"))
		.sort()
		.reverse();
	for (const dir of dirs) {
		const p = path.join(storageDir, dir, binaryName);
		if (fs.existsSync(p)) {
			return p;
		}
	}
	return undefined;
}

/**
 *
 * @param context
 */
export async function startLspClient(context: ExtensionContext): Promise<void> {
	const enabled = getConfig().get<boolean>("enabled", false);
	if (!enabled) {
		return;
	}

	let binaryPath: string | undefined;
	try {
		binaryPath = await ensureBinary(context);
	}
	catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		window.showErrorMessage(`CFML LSP: failed to get binary: ${msg}`);
		return;
	}

	if (!binaryPath) {
		window.showWarningMessage("CFML LSP: could not resolve binary path.");
		return;
	}

	const serverOptions: ServerOptions = { command: binaryPath, args: [] };
	const clientOptions: LanguageClientOptions = {
		documentSelector: [
			{ scheme: "file", language: "cfml" },
			{ scheme: "file", language: "cfs" },
		],
	};

	client = new LanguageClient("cfmlLsp", "CFML LSP", serverOptions, clientOptions);
	await client.start();
	context.subscriptions.push({
		dispose: () => {
			void stopLspClient();
		},
	});
}

/**
 *
 */
export async function stopLspClient(): Promise<void> {
	if (client) {
		await client.stop();
		client = undefined;
	}
}
