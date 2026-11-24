import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ExtensionContext, ProgressLocation, window, workspace } from "vscode";
import { CloseAction, CloseHandlerResult, ErrorAction, ErrorHandlerResult, LanguageClient, LanguageClientOptions, Message, ServerOptions } from "vscode-languageclient/node";
import { BINARY_NAME, LEGACY_BINARY_NAME, ServerAsset, ServerChoice, assetCandidates, chooseServer, legacyBinaryName, pinnedTag } from "./serverAsset";
import { installServer, resolveLatestTag } from "./serverDownload";

// Re-exported so the naming and choice rules have one home, shared with the
// packaging script, without every caller needing to know where that is.
export { assetCandidates, chooseServer, pinnedTag, tagFromReleaseRedirect } from "./serverAsset";

export const supportsNativeLsp = true;

let client: LanguageClient | undefined;

function getConfig() {
	return workspace.getConfiguration("cfml.lsp");
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
 * A downloaded server for a tag: under clif, or where a release from before the
 * rename put it, as `cfmleditor-lsp-<tag>/cfmleditor-lsp`.
 * @param storageDir the extension's global storage directory
 * @param tag the release tag
 * @param binaryName the executable's name on this platform
 * @returns the binary's path, whether or not it exists
 */
function cachedBinaryFor(storageDir: string, tag: string, binaryName: string): string {
	const current = path.join(versionDirFor(storageDir, tag), binaryName);
	const legacy = path.join(storageDir, `${LEGACY_BINARY_NAME}-${tag}`, legacyBinaryName(os.platform()));

	return !fs.existsSync(current) && fs.existsSync(legacy) ? legacy : current;
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

	const tags = new Set<string>();

	for (const dir of fs.readdirSync(storageDir)) {
		for (const name of [BINARY_NAME, LEGACY_BINARY_NAME]) {
			if (!dir.startsWith(`${name}-v`)) {
				continue;
			}

			const tag = dir.slice(`${name}-`.length);
			if (fs.existsSync(cachedBinaryFor(storageDir, tag, binaryName))) {
				tags.add(tag);
			}
		}
	}

	return [...tags];
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

	const binaryPath = cachedBinaryFor(storageDir, choice.tag, binaryName);
	ensureExecutable(binaryPath);

	return binaryPath;
}

async function ensureBinary(context: ExtensionContext): Promise<string | undefined> {
	// If user set an explicit path, use it directly
	const manualPath = getConfig().get<string>("path");
	if (manualPath) {
		return manualPath;
	}

	const version = getConfig().get<string>("version", "latest");
	const storageDir = context.globalStorageUri.fsPath;
	const { assets, binaryName } = assetCandidates(os.platform(), os.arch());
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
		await fetchBinary(choice.tag, assets, versionDirFor(storageDir, choice.tag), binaryName);

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
 * Downloads and installs the server for a tag, showing progress while it does.
 * @param tag the release tag
 * @param assets the release assets that could carry the server, best first
 * @param versionDir where the binary should land
 * @param binaryName the name to install it as
 */
async function fetchBinary(tag: string, assets: ServerAsset[], versionDir: string, binaryName: string): Promise<void> {
	await window.withProgress(
		{ location: ProgressLocation.Notification, title: "CFML LSP", cancellable: false },
		async (progress) => {
			await installServer({
				tag,
				assets,
				versionDir,
				binaryName,
				onProgress: message => progress.report({ message }),
			});
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
 * it were a `.cfmleditor.json`. A project's own `.clif.json` (or `.cfmleditor.json`) still wins
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
export function buildInitializationOptions(): { formatting?: Record<string, unknown>; features?: Record<string, unknown> } | undefined {
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

	const features: Record<string, unknown> = {};
	const explicitBool = (section: string, key: string): boolean | undefined => {
		const inspected = workspace.getConfiguration(section).inspect<boolean>(key);
		if (!inspected) {
			return undefined;
		}
		return inspected.workspaceFolderValue
			?? inspected.workspaceValue
			?? inspected.globalValue;
	};

	const paramHints = explicitBool("cfml.inlayHints", "parameterNames");
	if (paramHints !== undefined) {
		features.inlayHintsParameterNames = paramHints;
		if (paramHints) {
			features.inlayHints = true;
		}
	}

	const compPathHints = explicitBool("cfml.inlayHints", "componentPath");
	if (compPathHints !== undefined) {
		features.inlayHintsComponentPath = compPathHints;
		if (compPathHints) {
			features.inlayHints = true;
		}
	}

	const semanticTokens = explicitBool("cfml.lsp", "semanticTokens");
	if (semanticTokens !== undefined) {
		features.semanticTokens = semanticTokens;
	}

	const renameCrossFile = explicitBool("cfml.lsp", "renameCrossFile");
	if (renameCrossFile !== undefined) {
		features.renameCrossFile = renameCrossFile;
		if (renameCrossFile) {
			features.rename = true;
		}
	}

	const out: { formatting?: Record<string, unknown>; features?: Record<string, unknown> } = {};
	if (Object.keys(formatting).length > 0) {
		out.formatting = formatting;
	}
	if (Object.keys(features).length > 0) {
		out.features = features;
	}

	return Object.keys(out).length > 0 ? out : undefined;
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
 * @param command the server command name, e.g. `cfmleditor.resolveRoute`; the server runs both the cfmleditor. and clif. names, so the old one reaches every server version
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
