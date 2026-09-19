import {
	commands, ConfigurationChangeEvent, Disposable, DocumentSelector, Extension, ExtensionContext, extensions,
	FileSystemWatcher, IndentAction, LanguageConfiguration, languages, TextDocument, Uri, window, workspace,
} from "vscode";
import { isLspRunning, onLspStateChange } from "./lsp/cfmlLspClient";
import { COMPONENT_FILE_GLOB } from "./entities/component";
import { decreasingIndentingTags, goToMatchingTag, nonIndentingTags } from "./entities/tag";
import { cacheComponentFromDocument, clearCachedComponent, removeApplicationVariables, cacheComponentFromUri, cacheApplicationFromDocument } from "./features/cachedEntities";
import CFMLDocumentColorProvider from "./features/colorProvider";
import { foldAllFunctions, showApplicationDocument, refreshGlobalDefinitionCache, refreshWorkspaceDefinitionCache, insertSnippet, copyPackage, generateCodeMap, showCodeMapStats } from "./features/commands";
import { cfmlCommentRules, toggleBlockComment, toggleLineComment } from "./features/comment";
import CFMLCompletionItemProvider from "./features/completionItemProvider";
import CFMLDefinitionProvider from "./features/definitionProvider";
import DocBlockCompletions from "./features/docBlocker/docCompletionProvider";
import CFMLDocumentLinkProvider from "./features/documentLinkProvider";
import CFMLDocumentSymbolProvider from "./features/documentSymbolProvider";
import CFMLHoverProvider from "./features/hoverProvider";
import CFMLSignatureHelpProvider from "./features/signatureHelpProvider";
import CFMLTypeDefinitionProvider from "./features/typeDefinitionProvider";
import CFMLWorkspaceSymbolProvider from "./features/workspaceSymbolProvider";
import CFDocsService from "./utils/cfdocs/cfDocsService";
import { APPLICATION_CFM_GLOB, clearDocumentContextRangesCache, isApplicationFile, isCfcUri, shouldExcludeDocument } from "./utils/contextUtil";
import { handleContentChanges } from "./features/autoclose";
// import { CFMLFlatPackageProvider } from "./views/components";

export const LANGUAGE_ID: string = "cfml";
export const LANGUAGE_CFS_ID: string = "cfs";

export const UNWANTED_EXTENSIONS: string[] = [
	"formulahendry.auto-close-tag",
	"KamasamaK.vscode-cflint",
	"KamasamaK.vscode-cfml",
	"ilich8086.ColdFusion",
	"Codegyan.auto-closing-tags",
	"trst.cfml-comment-tags",
];

const DOCUMENT_SELECTOR: DocumentSelector = [
	{
		language: LANGUAGE_ID,
		scheme: "file",
	},
	{
		language: LANGUAGE_CFS_ID,
		scheme: "file",
	},
	{
		language: LANGUAGE_ID,
		scheme: "untitled",
	},
];

export let extensionContext: ExtensionContext;
let bulkCaching: boolean = false;
let currentConfigIsTag: boolean = false;

export type api = {
	isBulkCaching(): boolean;
};

/**
 * This method is called when the extension is activated.
 * @param context The context object for this extension.
 * @returns
 */
/**
 * The extension's own language providers, held here rather than in the
 * extension's subscriptions so they can be dropped while the server is running.
 *
 * VS Code merges the results of every registered provider, so with both live a
 * completion list comes back doubled, go-to-definition offers two entries for
 * one symbol, and two hover cards stack. Worse than the noise, the two disagree:
 * these resolve component paths from `cfml.mappings` in VS Code settings, the
 * server from the project's own `.cfmleditor.json`, and nothing in a merged
 * result says which produced which half.
 *
 * All of them stand down, not only the seven the server currently answers. The
 * rule is that enabling the server hands it the language, which is a rule a
 * reader can hold; "all except type definition, docblock completion and
 * document colours" is a list that has to be rechecked against the server's
 * capabilities every time either side changes. The cost is those three
 * capabilities going quiet until the server grows them.
 */
let ownProviders: Disposable[] = [];

/**
 * Registers the extension's own language providers.
 * @returns their disposables, in registration order
 */
function registerOwnProviders(): Disposable[] {
	return [
		languages.registerHoverProvider(DOCUMENT_SELECTOR, new CFMLHoverProvider()),
		languages.registerDocumentSymbolProvider(DOCUMENT_SELECTOR, new CFMLDocumentSymbolProvider()),
		languages.registerSignatureHelpProvider(DOCUMENT_SELECTOR, new CFMLSignatureHelpProvider(), "(", ","),
		languages.registerDocumentLinkProvider(DOCUMENT_SELECTOR, new CFMLDocumentLinkProvider()),
		languages.registerWorkspaceSymbolProvider(new CFMLWorkspaceSymbolProvider()),
		languages.registerCompletionItemProvider(DOCUMENT_SELECTOR, new CFMLCompletionItemProvider(), "."),
		languages.registerCompletionItemProvider(DOCUMENT_SELECTOR, new DocBlockCompletions(), "*", "@", "."),
		languages.registerDefinitionProvider(DOCUMENT_SELECTOR, new CFMLDefinitionProvider()),
		languages.registerTypeDefinitionProvider(DOCUMENT_SELECTOR, new CFMLTypeDefinitionProvider()),
		languages.registerColorProvider(DOCUMENT_SELECTOR, new CFMLDocumentColorProvider()),
	];
}

/** Drops every provider this extension registered, if any are live. */
function disposeOwnProviders(): void {
	for (const provider of ownProviders) {
		provider.dispose();
	}

	ownProviders = [];
}

/**
 * Registers or drops them to match whether the server is answering.
 *
 * Safe to call repeatedly and in either direction, which matters because the
 * server can start and stop while the window stays open: enabling the setting
 * restarts it, and a crash takes it away without one. Dropping them permanently
 * would leave a window with no language features at all after a server failure.
 */
function syncOwnProviders(): void {
	if (isLspRunning()) {
		disposeOwnProviders();

		return;
	}

	if (ownProviders.length === 0) {
		ownProviders = registerOwnProviders();
	}
}

/**
 * This method is called when the extension is activated.
 * @param context The context object for this extension.
 * @returns
 */
export async function activate(context: ExtensionContext): Promise<api> {
	extensionContext = context;

	UNWANTED_EXTENSIONS.forEach((extId: string) => {
		const extension: Extension<unknown> | undefined = extensions.getExtension(extId);
		if (extension) {
			window.showErrorMessage("Found unwanted extension: " + extId + ". Please uninstall it as it may conflict with CFMLEditor.");
		}
	});

	const languageConfiguration: LanguageConfiguration = {
		indentationRules: {
			increaseIndentPattern: new RegExp(`<(?!\\?|(?:${nonIndentingTags.join("|")})\\b|[^>]*\\/>)([-_.A-Za-z0-9]+)(?=\\s|>)\\b[^>]*>(?!.*<\\/\\1>)|<!--(?!.*-->)|\\{[^}"']*$`, "i"),
			decreaseIndentPattern: new RegExp(`^\\s*(<\\/[-_.A-Za-z0-9]+\\b[^>]*>|-?-->|\\}|<(${decreasingIndentingTags.join("|")})\\b[^>]*>)`, "i"),
		},
		comments: {
			lineComment: cfmlCommentRules.scriptLineComment,
			blockComment: cfmlCommentRules.scriptBlockComment,
		},
		onEnterRules: [
			{
				// e.g. /** | */
				beforeText: /^\s*\/\*\*(?!\/)([^*]|\*(?!\/))*$/,
				afterText: /^\s*\*\/$/,
				action: { indentAction: IndentAction.IndentOutdent, appendText: " * " },
			},
			{
				// e.g. /** ...|
				beforeText: /^\s*\/\*\*(?!\/)([^*]|\*(?!\/))*$/,
				action: { indentAction: IndentAction.None, appendText: " * " },
			},
			{
				// e.g.  * ...|
				beforeText: /^(\t|( {2}))* \*( ([^*]|\*(?!\/))*)?$/,
				action: { indentAction: IndentAction.None, appendText: "* " },
			},
			{
				// e.g.  */|
				beforeText: /^(\t|( {2}))* \*\/\s*$/,
				action: { indentAction: IndentAction.None, removeText: 1 },
			},
			{
				// e.g. <cfloop> | </cfloop>
				beforeText: new RegExp(`<(?!(?:${nonIndentingTags.join("|")})\\b)([_:\\w][_:\\w-.\\d]*)([^/>]*(?!/)>)[^<]*$`, "i"),
				afterText: new RegExp(`^(<\\/([_:\\w][_:\\w-.\\d]*)\\s*>|<(?:${decreasingIndentingTags.join("|")})\\b)`, "i"),
				action: { indentAction: IndentAction.IndentOutdent },
			},
		],
	};

	languages.setLanguageConfiguration(LANGUAGE_ID, languageConfiguration);
	languages.setLanguageConfiguration(LANGUAGE_CFS_ID, languageConfiguration);

	context.subscriptions.push(commands.registerCommand("cfml.refreshGlobalDefinitionCache", refreshGlobalDefinitionCache));
	context.subscriptions.push(commands.registerCommand("cfml.refreshWorkspaceDefinitionCache", refreshWorkspaceDefinitionCache));
	context.subscriptions.push(commands.registerCommand("cfml.copyPackage", copyPackage));
	context.subscriptions.push(commands.registerTextEditorCommand("cfml.toggleLineComment", toggleLineComment));
	context.subscriptions.push(commands.registerTextEditorCommand("cfml.insertSnippet", (editor, edit, ...args: unknown[]) => {
		void insertSnippet(editor, edit, args[0] as Parameters<typeof insertSnippet>[2]);
	}));
	context.subscriptions.push(commands.registerTextEditorCommand("cfml.toggleBlockComment", toggleBlockComment));
	context.subscriptions.push(commands.registerTextEditorCommand("cfml.openActiveApplicationFile", (editor) => {
		void showApplicationDocument(editor);
	}));
	context.subscriptions.push(commands.registerTextEditorCommand("cfml.goToMatchingTag", (editor, edit) => {
		void goToMatchingTag(editor, edit, undefined);
	}));
	context.subscriptions.push(commands.registerTextEditorCommand("cfml.openCfDocs", (editor, edit) => {
		void CFDocsService.openCfDocsForCurrentWord(editor, edit, undefined);
	}));
	context.subscriptions.push(commands.registerTextEditorCommand("cfml.openEngineDocs", (editor, edit) => {
		void CFDocsService.openEngineDocsForCurrentWord(editor, edit, undefined);
	}));
	context.subscriptions.push(commands.registerTextEditorCommand("cfml.foldAllFunctions", foldAllFunctions));
	context.subscriptions.push(commands.registerCommand("cfml.generateCodeMap", () => {
		void generateCodeMap();
	}));
	context.subscriptions.push(commands.registerCommand("cfml.showCodeMapStats", () => {
		void showCodeMapStats();
	}));

	// The one way back from a server the client has given up on. Without it,
	// reloading the window was the only cure — and the extension's own providers
	// stand down while the server is meant to be answering, so the editor has no
	// language features at all until someone works that out.
	context.subscriptions.push(commands.registerCommand("cfml.restartLspServer", async () => {
		const { restartLspClient } = await import("./lsp/cfmlLspClient");
		await restartLspClient(context);
	}));

	syncOwnProviders();
	onLspStateChange(syncOwnProviders);
	context.subscriptions.push({ dispose: disposeOwnProviders });

	context.subscriptions.push(workspace.onDidSaveTextDocument(async (document: TextDocument) => {
		if (!document || shouldExcludeDocument(document.uri)) {
			return;
		}

		if (isCfcUri(document.uri)) {
			await cacheComponentFromDocument(document, undefined);
		}
		else if (isApplicationFile(document.uri)) {
			await cacheComponentFromDocument(document, undefined);
		}
	}));

	const componentWatcher: FileSystemWatcher = workspace.createFileSystemWatcher(COMPONENT_FILE_GLOB, false, true, false);
	componentWatcher.onDidCreate((componentUri: Uri) => {
		if (shouldExcludeDocument(componentUri)) {
			return;
		}
		void cacheComponentFromUri(componentUri, undefined);
	});
	componentWatcher.onDidDelete((componentUri: Uri) => {
		if (shouldExcludeDocument(componentUri)) {
			return;
		}

		clearCachedComponent(componentUri);

		if (isApplicationFile(componentUri)) {
			removeApplicationVariables(componentUri);
		}
	});
	context.subscriptions.push(componentWatcher);

	const applicationCfmWatcher: FileSystemWatcher = workspace.createFileSystemWatcher(APPLICATION_CFM_GLOB, false, true, false);
	context.subscriptions.push(applicationCfmWatcher);
	applicationCfmWatcher.onDidCreate((applicationUri: Uri) => {
		if (shouldExcludeDocument(applicationUri)) {
			return;
		}

		workspace.openTextDocument(applicationUri).then(async (document: TextDocument) => {
			await cacheApplicationFromDocument(document, undefined);
		});
	});
	applicationCfmWatcher.onDidDelete((applicationUri: Uri) => {
		if (shouldExcludeDocument(applicationUri)) {
			return;
		}

		removeApplicationVariables(applicationUri);
	});

	context.subscriptions.push(workspace.onDidChangeConfiguration((evt: ConfigurationChangeEvent) => {
		if (evt.affectsConfiguration("cfml.globalDefinitions") || evt.affectsConfiguration("cfml.cfDocs") || evt.affectsConfiguration("cfml.engine")) {
			commands.executeCommand("cfml.refreshGlobalDefinitionCache");
		}
		if (evt.affectsConfiguration("cfml.mappings") || evt.affectsConfiguration("cfml.webroot")) {
			// Refresh cached components so the config changes take effect
			commands.executeCommand("cfml.refreshWorkspaceDefinitionCache");
		}
		if (evt.affectsConfiguration("cfml.format") || evt.affectsConfiguration("cfml.lsp")) {
			// The server reads initializationOptions once, at initialize, so a
			// changed formatting setting only reaches it through a restart.
			void (async () => {
				try {
					const { restartLspClient } = await import("./lsp/cfmlLspClient");
					await restartLspClient(context);
				}
				catch {
					// LSP module not available (e.g. web build)
				}
			})();
		}
	}));

	workspace.onDidChangeTextDocument(async (event) => {
		clearDocumentContextRangesCache(event.document.uri);
		await handleContentChanges(event);
	});

	context.subscriptions.push(workspace.onDidCloseTextDocument((document: TextDocument) => {
		clearDocumentContextRangesCache(document.uri);
	}));

	await commands.executeCommand("cfml.refreshGlobalDefinitionCache");
	await commands.executeCommand("cfml.refreshWorkspaceDefinitionCache");

	try {
		const { startLspClient } = await import("./lsp/cfmlLspClient");
		await startLspClient(context);
	}
	catch {
		// LSP module not available (e.g. web build)
	}

	const api: api = {
		isBulkCaching(): boolean {
			return bulkCaching;
		},
	};

	// const rootPath = workspace.workspaceFolders?.[0]?.uri.fsPath;
	// let provider: CFMLFlatPackageProvider | undefined;
	// if (rootPath) {
	// 	try {
	// 		provider = new CFMLFlatPackageProvider(rootPath);
	// 		window.registerTreeDataProvider("cfml.components", provider);
	// 	}
	// 	catch (error) {
	// 		console.error("Failed to create ComponentTreeDataProvider:", error);
	// 	}
	// }

	return api;
}

/**
 *
 * @param value
 */
export function setBulkCaching(value: boolean): void {
	bulkCaching = value;
}

/**
 *
 * @returns
 */
export function getBulkCaching(): boolean {
	return bulkCaching;
}

/**
 *
 * @param value
 */
export function setCurrentConfigIsTag(value: boolean): void {
	currentConfigIsTag = value;
}

/**
 *
 * @returns
 */
export function getCurrentConfigIsTag(): boolean {
	return currentConfigIsTag;
}

/**
 * This method is called when the extension is deactivated.
 */
export async function deactivate(): Promise<void> {
	try {
		const { stopLspClient } = await import("./lsp/cfmlLspClient");
		await stopLspClient();
	}
	catch {
		// LSP module not available
	}
}
