import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ExtensionContext, ProgressLocation, window, workspace } from "vscode";
import { CloseAction, CloseHandlerResult, ErrorAction, ErrorHandlerResult, LanguageClient, LanguageClientOptions, Message, ServerOptions } from "vscode-languageclient/node";
import { extractArchive } from "./extractServer";
import { HttpStatusError, requestFollowingRedirects, requestOnce } from "./httpRequest";
import { BINARY_NAME, GITHUB_REPO, ServerChoice, assetCandidates, chooseServer, pinnedTag, tagFromReleaseRedirect } from "./serverAsset";

// Re-exported so the naming and choice rules have one home, shared with the
// packaging script, without every caller needing to know where that is.
export { assetCandidates, chooseServer, pinnedTag, tagFromReleaseRedirect } from "./serverAsset";

let client: LanguageClient | undefined;

function getConfig() {
	return workspace.getConfiguration("cfml.lsp");
}

async function downloadFile(url: string, dest: string): Promise<void> {
	const response = await requestFollowingRedirects(url);

	if (response.statusCode !== 200) {
		response.resume();
		throw new HttpStatusError(response.statusCode ?? 0, `HTTP ${response.statusCode} downloading ${url}`);
	}

	return new Promise((resolve, reject) => {
		const file = fs.createWriteStream(dest);

		// The idle timeout arrives as an error on the response, so a transfer
		// that stalls part way through ends here rather than hanging forever.
		response.on("error", reject);
		file.on("error", reject);
		// `close` rather than `finish`, so the file is on disk and readable by
		// the time the archive is opened.
		file.on("close", resolve);
		response.pipe(file);
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

	// The redirect is the answer here, so it is read rather than followed.
	const response = await requestOnce(url);
	response.resume();

	const status = response.statusCode ?? 0;
	if (status < 300 || status >= 400) {
		throw new Error(`HTTP ${status} resolving the latest release`);
	}

	return tagFromReleaseRedirect(response.headers.location ?? "");
}

/**
 * The directory a downloaded server for a tag lives in.
 * @param storageDir the extension's global storage directory
 * @param tag the release tag
 * @returns the directory that tag's binary belongs in
 */
function versionDirFor(storageDir: string, tag: string): string {
	return path.join(storageDir, `${BINARY_NAME}-${tag}`);
}

/**
 * The server shipped inside the extension, when this build carries one.
 *
 * Platform-specific packages put the matching binary in `server/`, so a first
 * run needs no network at all and a GitHub nobody here can reach costs an
 * upgrade rather than every language feature. The universal package ships
 * without one and downloads as it always did.
 * @param context the extension context, for the install directory
 * @param binaryName the executable's name on this platform
 * @returns the binary and the release it came from, or undefined for a universal build
 */
function bundledServer(context: ExtensionContext, binaryName: string): { path: string; tag: string } | undefined {
	const binaryPath = path.join(context.extensionPath, "server", binaryName);
	const versionFile = path.join(context.extensionPath, "server", "version.txt");

	if (!fs.existsSync(binaryPath) || !fs.existsSync(versionFile)) {
		return undefined;
	}

	const tag = fs.readFileSync(versionFile, "utf8").trim();

	return tag ? { path: binaryPath, tag } : undefined;
}

/**
 * The tags of every server already downloaded.
 * @param storageDir the extension's global storage directory
 * @param binaryName the executable's name on this platform
 * @returns the tags whose directory actually holds a binary
 */
function cachedTags(storageDir: string, binaryName: string): string[] {
	if (!fs.existsSync(storageDir)) {
		return [];
	}

	return fs.readdirSync(storageDir)
		.filter(dir => dir.startsWith(`${BINARY_NAME}-v`))
		.filter(dir => fs.existsSync(path.join(storageDir, dir, binaryName)))
		.map(dir => dir.slice(`${BINARY_NAME}-`.length));
}

/**
 * Makes sure a binary is executable, which a zip and some installers do not keep.
 * @param binaryPath the server to mark executable
 */
function ensureExecutable(binaryPath: string): void {
	if (os.platform() === "win32") {
		return;
	}

	try {
		fs.chmodSync(binaryPath, 0o755);
	}
	catch {
		// A read-only install directory is fine as long as the bit survived
		// packaging, and failing the start over it would help nobody.
	}
}

function pathForChoice(choice: ServerChoice, bundled: { path: string; tag: string } | undefined, storageDir: string, binaryName: string): string {
	if (choice.source === "bundled" && bundled) {
		ensureExecutable(bundled.path);
		return bundled.path;
	}

	return path.join(versionDirFor(storageDir, choice.tag), binaryName);
}

/**
 * The environment the server runs in, with the bundled tools on PATH.
 *
 * The server runs CFLint itself, and looks for `cflint` on PATH before its own
 * cache or a download. Putting the directory the extension ships there is the
 * whole handshake: no setting, no protocol, and a platform package that
 * carries CFLint never has to fetch 90 MB at first lint.
 *
 * Appended rather than prepended, so a `cflint` the user installed themselves
 * still wins — that is the order the server already prefers, and this is meant
 * to be the floor under it rather than an override.
 * @param context the extension context, for the install directory
 * @returns the environment overrides, or undefined when this build bundles nothing
 */
function serverEnvironment(context: ExtensionContext): Record<string, string> | undefined {
	const bundledDir = path.join(context.extensionPath, "server");
	if (!fs.existsSync(bundledDir)) {
		return undefined;
	}

	return pathWithBundledTools(process.env, bundledDir);
}

/**
 * Adds a directory to the end of PATH, under the name the environment already
 * uses for it.
 *
 * Windows spells it `Path`, and the client copies the environment key by key
 * into a plain object before applying these — so a `PATH` of our own would
 * leave the process carrying two path variables and no say in which one wins.
 * @param env the environment to extend
 * @param directory the directory to add
 * @returns the single variable to override
 */
export function pathWithBundledTools(env: NodeJS.ProcessEnv, directory: string): Record<string, string> {
	const pathKey = Object.keys(env).find(key => key.toLowerCase() === "path") ?? "PATH";
	const current = env[pathKey];

	return { [pathKey]: current ? `${current}${path.delimiter}${directory}` : directory };
}

async function ensureBinary(context: ExtensionContext): Promise<string | undefined> {
	// If user set an explicit path, use it directly
	const manualPath = getConfig().get<string>("path");
	if (manualPath) {
		return manualPath;
	}

	const version = getConfig().get<string>("version", "latest");
	const storageDir = context.globalStorageUri.fsPath;
	const { assetNames, binaryName } = assetCandidates(os.platform(), os.arch());
	const bundled = bundledServer(context, binaryName);
	const cached = cachedTags(storageDir, binaryName);

	// A pinned version needs no network at all. `latest` still asks on every
	// start, but the answer is now an upgrade check rather than the only way to
	// get a server, so failing to reach GitHub is quiet.
	const pinned = pinnedTag(version);
	let requested = pinned;
	let requestError: Error | undefined;
	if (!pinned) {
		try {
			requested = await resolveLatestTag();
		}
		catch (e: unknown) {
			requestError = e instanceof Error ? e : new Error(String(e));
		}
	}

	const choice = chooseServer(requested, bundled?.tag, cached);
	if (!choice) {
		throw requestError ?? new Error(`No ${BINARY_NAME} for ${os.platform()}-${os.arch()} in this build`);
	}

	if (choice.source !== "download") {
		warnIfNotWhatWasAsked(choice.tag, pinned);
		return pathForChoice(choice, bundled, storageDir, binaryName);
	}

	try {
		await fetchBinary(choice.tag, assetNames, versionDirFor(storageDir, choice.tag), binaryName);

		return pathForChoice(choice, bundled, storageDir, binaryName);
	}
	catch (e: unknown) {
		// Whatever went wrong — an unreachable GitHub, a proxy in the way, a
		// timeout, an asset that is not there — a server already on this machine
		// is a better answer than none.
		const fallback = chooseServer(undefined, bundled?.tag, cached);
		if (fallback) {
			const msg = e instanceof Error ? e.message : String(e);
			void window.showWarningMessage(`CFML LSP: could not fetch ${choice.tag} (${msg}). Using ${fallback.tag}, which is already installed.`);

			return pathForChoice(fallback, bundled, storageDir, binaryName);
		}

		throw e;
	}
}

/**
 * Says so when the server about to start is not the version that was pinned.
 *
 * Only for a pinned version: `latest` failing to resolve is a normal offline
 * start, and a notification every time the network is down would train everyone
 * to ignore the one that matters.
 * @param running the tag that will be started
 * @param pinned the tag `cfml.lsp.version` asked for, if it pinned one
 */
function warnIfNotWhatWasAsked(running: string, pinned: string | undefined): void {
	if (pinned && pinned !== running) {
		void window.showWarningMessage(`CFML LSP: ${pinned} is not installed and could not be fetched. Running ${running} instead.`);
	}
}

/**
 * Downloads and unpacks the server for a tag, trying each asset the platform
 * could use until one is there.
 * @param tag the release tag
 * @param assetNames the candidate asset names, best first
 * @param versionDir the directory the binary belongs in
 * @param binaryName the binary's name inside the archive
 */
async function fetchBinary(tag: string, assetNames: string[], versionDir: string, binaryName: string): Promise<void> {
	await window.withProgress(
		{ location: ProgressLocation.Notification, title: "CFML LSP", cancellable: false },
		async (progress) => {
			fs.mkdirSync(versionDir, { recursive: true });
			const binaryPath = path.join(versionDir, binaryName);

			let notFound: Error | undefined;
			for (const assetName of assetNames) {
				const archivePath = path.join(versionDir, assetName);

				try {
					progress.report({ message: `Downloading ${tag}...` });
					await downloadFile(`https://github.com/${GITHUB_REPO}/releases/download/${tag}/${assetName}`, archivePath);

					progress.report({ message: "Extracting..." });
					await extractArchive(archivePath, versionDir, binaryName);
				}
				catch (e) {
					fs.rmSync(archivePath, { force: true });

					// Only a missing asset is worth trying the next candidate
					// for. A timeout or a refused connection would fail the same
					// way twice, and asking again just doubles the wait.
					if (e instanceof HttpStatusError && e.statusCode === 404) {
						notFound = e;
						continue;
					}

					throw e;
				}

				fs.rmSync(archivePath, { force: true });

				// An archive that unpacked without producing the binary is not a
				// success. Left unchecked it reached `chmod` as an ENOENT that
				// said nothing about which asset was wrong.
				if (!fs.existsSync(binaryPath)) {
					throw new Error(`${assetName} did not contain ${binaryName}`);
				}

				if (os.platform() !== "win32") {
					fs.chmodSync(binaryPath, 0o755);
				}

				return;
			}

			throw notFound ?? new Error(`No server asset for this platform in ${tag}`);
		}
	);
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

	const serverOptions: ServerOptions = { command: binaryPath, args: [], options: { env: serverEnvironment(context) } };
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

	try {
		await client.start();
	}
	catch (e: unknown) {
		// The one failure nothing used to report. `activate()` wrapped this call
		// in a catch meant for the web build, where the module does not load at
		// all, so a binary that would not execute — wrong architecture, a
		// truncated download, a server that dies during initialize — left the
		// user with no server and nothing on screen to say why.
		const msg = e instanceof Error ? e.message : String(e);

		// Dropped rather than stopped: a client that failed to start refuses to
		// stop, and holding on to it would make `cfml.restartLspServer` fail
		// with "Previous start failed" for as long as the window stays open.
		client = undefined;
		window.showErrorMessage(`CFML LSP: the server failed to start: ${msg}. Run “CFML: Restart Language Server” to try again.`);

		return;
	}

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
		try {
			await client.stop();
		}
		catch {
			// A client whose server has already gone refuses to stop, and that
			// is exactly the state a restart is being asked for from. Throwing
			// here left `cfml.restartLspServer` — the only way back from a
			// server the client gave up on — failing before it started anything.
		}
		client = undefined;
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
