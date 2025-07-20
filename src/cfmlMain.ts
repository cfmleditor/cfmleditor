import {
	commands, ConfigurationChangeEvent, DocumentSelector, Extension, ExtensionContext, extensions,
	FileSystemWatcher, IndentAction, LanguageConfiguration, languages, TextDocument, Uri, window, workspace,
} from "vscode";
import { COMPONENT_FILE_GLOB } from "./entities/component";
import { decreasingIndentingTags, goToMatchingTag, nonIndentingTags } from "./entities/tag";
import { cacheComponentFromDocument, clearCachedComponent, removeApplicationVariables, cacheComponentFromUri, cacheApplicationFromDocument } from "./features/cachedEntities";
import CFMLDocumentColorProvider from "./features/colorProvider";
import { foldAllFunctions, showApplicationDocument, refreshGlobalDefinitionCache, refreshWorkspaceDefinitionCache, insertSnippet, copyPackage, goToRouteController, goToRouteView } from "./features/commands";
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
import { APPLICATION_CFM_GLOB, isApplicationFile, isCfcUri, shouldExcludeDocument } from "./utils/contextUtil";
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
	context.subscriptions.push(commands.registerTextEditorCommand("cfml.insertSnippet", insertSnippet));
	context.subscriptions.push(commands.registerTextEditorCommand("cfml.toggleBlockComment", toggleBlockComment));
	// eslint-disable-next-line @typescript-eslint/no-misused-promises
	context.subscriptions.push(commands.registerTextEditorCommand("cfml.openActiveApplicationFile", showApplicationDocument));
	context.subscriptions.push(commands.registerTextEditorCommand("cfml.goToMatchingTag", goToMatchingTag));
	context.subscriptions.push(commands.registerTextEditorCommand("cfml.openCfDocs", CFDocsService.openCfDocsForCurrentWord.bind(CFDocsService)));
	context.subscriptions.push(commands.registerTextEditorCommand("cfml.openEngineDocs", CFDocsService.openEngineDocsForCurrentWord.bind(CFDocsService)));
	context.subscriptions.push(commands.registerTextEditorCommand("cfml.foldAllFunctions", foldAllFunctions));
	context.subscriptions.push(commands.registerTextEditorCommand("cfml.goToRouteView", () => {
		void goToRouteView();
	}));
	context.subscriptions.push(commands.registerTextEditorCommand("cfml.goToRouteController", () => {
		void goToRouteController();
	}));

	context.subscriptions.push(languages.registerHoverProvider(DOCUMENT_SELECTOR, new CFMLHoverProvider()));
	context.subscriptions.push(languages.registerDocumentSymbolProvider(DOCUMENT_SELECTOR, new CFMLDocumentSymbolProvider()));
	context.subscriptions.push(languages.registerSignatureHelpProvider(DOCUMENT_SELECTOR, new CFMLSignatureHelpProvider(), "(", ","));
	context.subscriptions.push(languages.registerDocumentLinkProvider(DOCUMENT_SELECTOR, new CFMLDocumentLinkProvider()));
	context.subscriptions.push(languages.registerWorkspaceSymbolProvider(new CFMLWorkspaceSymbolProvider()));
	context.subscriptions.push(languages.registerCompletionItemProvider(DOCUMENT_SELECTOR, new CFMLCompletionItemProvider(), "."));
	context.subscriptions.push(languages.registerCompletionItemProvider(DOCUMENT_SELECTOR, new DocBlockCompletions(), "*", "@", "."));
	context.subscriptions.push(languages.registerDefinitionProvider(DOCUMENT_SELECTOR, new CFMLDefinitionProvider()));
	context.subscriptions.push(languages.registerTypeDefinitionProvider(DOCUMENT_SELECTOR, new CFMLTypeDefinitionProvider()));
	context.subscriptions.push(languages.registerColorProvider(DOCUMENT_SELECTOR, new CFMLDocumentColorProvider()));

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
	}));

	workspace.onDidChangeTextDocument(async (event) => {
		await handleContentChanges(event);
	});

	await commands.executeCommand("cfml.refreshGlobalDefinitionCache");
	await commands.executeCommand("cfml.refreshWorkspaceDefinitionCache");

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
export function deactivate(): void {
}
