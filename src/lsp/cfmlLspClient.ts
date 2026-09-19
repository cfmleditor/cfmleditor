import * as fs from "fs";
import * as https from "https";
import * as os from "os";
import * as path from "path";
import * as zlib from "zlib";
import { ExtensionContext, ProgressLocation, window, workspace } from "vscode";
import { CloseAction, CloseHandlerResult, ErrorAction, ErrorHandlerResult, LanguageClient, LanguageClientOptions, Message, ServerOptions } from "vscode-languageclient/node";

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

/**
 * Reads the tag `latest` currently points at, from GitHub's own redirect.
 *
 * Deliberately not the releases API. That endpoint is rate limited to 60
 * requests an hour *per IP* for unauthenticated callers, which is shared by
 * everyone behind one NAT — a single office hits it in an afternoon, and the
 * extension asked on every server start. The failure is an HTTP 403 that reads
 * like a permissions problem and tells a first-time user nothing.
 *
 * `/releases/latest` redirects to `/releases/tag/<tag>` with no API involved and
 * no rate limit, which is the same route the IntelliJ plugin takes.
 * @returns the tag name, e.g. `v0.3.1`
 */
async function resolveLatestTag(): Promise<string> {
	const url = `https://github.com/${GITHUB_REPO}/releases/latest`;

	const location = await new Promise<string>((resolve, reject) => {
		https.get(url, { headers: { "User-Agent": "cfmleditor-vscode" } }, (res) => {
			// The redirect is the answer here, so it is read rather than followed.
			if (res.statusCode === 301 || res.statusCode === 302) {
				res.resume();
				resolve(res.headers.location ?? "");
				return;
			}
			res.resume();
			reject(new Error(`HTTP ${res.statusCode} resolving the latest release`));
		}).on("error", reject);
	});

	return tagFromReleaseRedirect(location);
}

/**
 * Pulls the tag out of the URL `/releases/latest` redirects to.
 *
 * Separate from the request so it can be tested without one — the shapes that
 * matter (an empty Location, a redirect somewhere unexpected) are exactly the
 * ones a live call will not produce on demand.
 * @param location the redirect target
 * @returns the tag name
 */
export function tagFromReleaseRedirect(location: string): string {
	const tag = /\/releases\/tag\/([^/?#]+)/.exec(location)?.[1];
	if (!tag) {
		throw new Error(`Could not read a release tag from ${location || "an empty redirect"}`);
	}

	return decodeURIComponent(tag);
}

/**
 * The tag a configured version means, without asking anything.
 * @param version the `cfml.lsp.version` setting
 * @returns the tag, or undefined for `latest`, which has to be resolved
 */
export function pinnedTag(version: string): string | undefined {
	if (!version || version === "latest") {
		return undefined;
	}

	return version.startsWith("v") ? version : `v${version}`;
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

	// A pinned version already on disk needs no network at all. Asking first and
	// checking the cache only on failure meant a request per server start for a
	// binary that was never going to change.
	const pinned = pinnedTag(version);
	if (pinned) {
		const cached = path.join(storageDir, `cfmleditor-lsp-${pinned}`, binaryName);
		if (fs.existsSync(cached)) {
			return cached;
		}
	}

	let tag: string;
	try {
		tag = pinned ?? await resolveLatestTag();
	}
	catch (e) {
		// If we can't reach GitHub, try to use whatever we have cached
		const existing = findCachedBinary(storageDir, binaryName);
		if (existing) {
			return existing;
		}
		throw e;
	}

	const versionDir = path.join(storageDir, `cfmleditor-lsp-${tag}`);
	const binaryPath = path.join(versionDir, binaryName);

	// Already downloaded?
	if (fs.existsSync(binaryPath)) {
		return binaryPath;
	}

	const assetUrl = `https://github.com/${GITHUB_REPO}/releases/download/${tag}/${assetName}`;

	// Download with progress
	await window.withProgress(
		{ location: ProgressLocation.Notification, title: "CFML LSP", cancellable: false },
		async (progress) => {
			progress.report({ message: `Downloading ${tag}...` });
			fs.mkdirSync(versionDir, { recursive: true });
			const archivePath = path.join(versionDir, assetName);

			await downloadFile(assetUrl, archivePath);

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

// The formatting keys the server accepts, mirrored as `cfml.format.*` settings.
// Kept in the server's spelling so the payload needs no translation, and
// checked against package.json by a test.
export const FORMAT_KEYS = [
	"enabled",
	"selfCloseTags",
	"whitespaceOnly",
	"queryFormat",
	"lowercaseTags",
	"lowercaseAttributes",
	"doubleQuoteAttributes",
	"queryUppercaseKeywords",
	"blankLinesInBlocks",
	"switchCaseIndent",
	"parenSpacing",
	"braceStyle",
	"scopeCase",
	"commaPosition",
	"queryCommaPosition",
	"lineWidth",
	"paramBreakThreshold",
	"attrBreakThreshold",
	"indentWidth",
	"debug",
] as const;

/**
 * Builds the `initializationOptions` payload, which the server reads as though
 * it were a `.cfmleditor.json`. A project's own `.cfmleditor.json` still wins
 * key by key, so this is the base an editor supplies rather than an override.
 *
 * Only settings the user has actually set are sent. The server distinguishes
 * "set to false" from "not mentioned", and a VS Code setting always reads back
 * a value whether or not anyone chose it — so sending every key would have an
 * untouched install silently assert twenty defaults over any it did not name.
 * An untouched install sends nothing at all, which is what it did before these
 * settings existed.
 * @returns the payload, or undefined when nothing is set
 */
export function buildInitializationOptions(): { formatting?: Record<string, unknown> } | undefined {
	const config = workspace.getConfiguration("cfml.format");
	const formatting: Record<string, unknown> = {};

	for (const key of FORMAT_KEYS) {
		const inspected = config.inspect(key);
		if (!inspected) {
			continue;
		}

		// First one wins, narrowest scope first, matching how VS Code itself
		// resolves a setting.
		const value = inspected.workspaceFolderValue
			?? inspected.workspaceValue
			?? inspected.globalValue;

		if (value !== undefined) {
			formatting[key] = value;
		}
	}

	return Object.keys(formatting).length > 0 ? { formatting } : undefined;
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
	// How many times a server that keeps dying is restarted before the extension
	// stops and asks. High enough to ride out a crash on a single bad file, low
	// enough that a server failing on every start does not spin.
	const maxRestarts = 4;
	let restarts = 0;

	const clientOptions: LanguageClientOptions = {
		documentSelector: [
			{ scheme: "file", language: "cfml" },
			{ scheme: "file", language: "cfs" },
		],
		initializationOptions: buildInitializationOptions(),

		// The default handler gives up permanently, and the extension offered no
		// way back: "Server will not be restarted" left reloading the window as
		// the only cure, with nothing on screen saying so. Language features are
		// gone until then, because the extension's own providers stand down while
		// the server is meant to be running.
		errorHandler: {
			error: (error: Error, message: Message | undefined, count: number | undefined): ErrorHandlerResult => {
				// A message that failed to parse or dispatch is not a dead server;
				// shutting one down over it loses everything else it was doing.
				if ((count ?? 0) <= 3) {
					return { action: ErrorAction.Continue };
				}

				return { action: ErrorAction.Shutdown, message: `CFML LSP: ${error.message}` };
			},
			closed: (): CloseHandlerResult => {
				restarts++;

				if (restarts > maxRestarts) {
					return {
						action: CloseAction.DoNotRestart,
						message: "CFML LSP stopped restarting after repeated failures. Run \u201cCFML: Restart Language Server\u201d to try again.",
					};
				}

				return { action: CloseAction.Restart };
			},
		},
	};

	client = new LanguageClient("cfmlLsp", "CFML LSP", serverOptions, clientOptions);
	await client.start();
	notifyLspStateChange();
	context.subscriptions.push({
		dispose: () => {
			void stopLspClient();
		},
	});
}

/**
 * Whether a language server is running and can answer a request.
 * @returns true when a request will reach a server
 */
export function isLspRunning(): boolean {
	return client !== undefined && client.needsStart() === false;
}

/** Called whenever the server starts or stops. */
type LspStateListener = () => void;

const stateListeners: LspStateListener[] = [];

/**
 * Registers a listener for the server coming up or going away.
 *
 * It exists so the extension's own language providers can stand down while the
 * server is answering. VS Code merges the results of every registered provider,
 * so with both live a completion list comes back doubled and go-to-definition
 * offers two entries for one symbol — and the two disagree, because the
 * extension resolves from `cfml.mappings` while the server resolves from
 * `.cfmleditor.json`.
 *
 * A listener rather than a check at activation time, because the server can
 * start and stop while the window stays open: enabling the setting restarts it,
 * and a crash takes it away without one.
 * @param listener called after the state has changed
 */
export function onLspStateChange(listener: LspStateListener): void {
	stateListeners.push(listener);
}

function notifyLspStateChange(): void {
	for (const listener of stateListeners) {
		listener();
	}
}

/**
 * Runs one of the server's `workspace/executeCommand` commands.
 *
 * Commands that resolve a route or build a code map live on the server because
 * that is where the workspace configuration, the index and the convention are.
 * Re-implementing any of it here would mean two answers to the same question,
 * and the wrong one still opens a file — just not the right one.
 * @param command the server command name, e.g. `cfmleditor.resolveRoute`
 * @param args the command arguments
 * @returns the server's result, or undefined when no server is running
 */
export async function executeLspCommand<T>(command: string, args: unknown[] = []): Promise<T | undefined> {
	if (!client || !isLspRunning()) {
		return undefined;
	}

	return client.sendRequest<T>("workspace/executeCommand", { command, arguments: args });
}

/**
 *
 */
export async function stopLspClient(): Promise<void> {
	if (client) {
		await client.stop();
		client = undefined;
		notifyLspStateChange();
	}
}

/**
 * Restarts the client so a changed setting takes effect.
 *
 * `initializationOptions` are read once, at initialize, so a running server
 * keeps the payload it was started with however the settings change under it.
 * @param context the extension context, needed to resolve the binary again
 */
export async function restartLspClient(context: ExtensionContext): Promise<void> {
	await stopLspClient();
	await startLspClient(context);
}
