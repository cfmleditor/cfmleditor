import { some } from "micromatch";
import {
	commands, ConfigurationChangeEvent, DocumentSelector, Extension, ExtensionContext, extensions,
	FileSystemWatcher, IndentAction, LanguageConfiguration, languages, TextDocument, Uri, window, workspace, WorkspaceConfiguration, env,
} from "vscode";
import { COMPONENT_FILE_GLOB } from "./entities/component";
import { Scope } from "./entities/scope";
import { decreasingIndentingTags, goToMatchingTag, nonIndentingTags } from "./entities/tag";
import { parseVariableAssignments, Variable } from "./entities/variable";
import { cacheComponentFromDocument, setApplicationVariables, clearCachedComponent, removeApplicationVariables } from "./features/cachedEntities";
import CFMLDocumentColorProvider from "./features/colorProvider";
import { foldAllFunctions, showApplicationDocument, refreshGlobalDefinitionCache, refreshWorkspaceDefinitionCache, insertSnippet } from "./features/commands";
import { CommentType, toggleComment } from "./features/comment";
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
import { APPLICATION_CFM_GLOB, isCfcFile } from "./utils/contextUtil";
import { DocumentStateContext, getDocumentStateContext } from "./utils/documentUtil";
import { handleContentChanges } from "./features/autoclose";
import { resolveBaseName, uriBaseName } from "./utils/fileUtil";
// import { CFMLFlatPackageProvider } from "./views/components";
import { convertPathToPackageName } from "./utils/cfcPackages";

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

/**
 * Checks whether the given document should be excluded from being used.
 * @param documentUri The URI of the document to check against
 * @returns boolean
 */
function shouldExcludeDocument(documentUri: Uri): boolean {
	const fileSettings: WorkspaceConfiguration = workspace.getConfiguration("files", documentUri);

	const fileExcludes: object = fileSettings.get<object>("exclude", []);
	const fileExcludeGlobs: string[] = [];
	for (let fileExcludeGlob in fileExcludes) {
		if (fileExcludes[fileExcludeGlob]) {
			if (fileExcludeGlob.endsWith("/")) {
				fileExcludeGlob += "**";
			}
			fileExcludeGlobs.push(fileExcludeGlob);
		}
	}

	const relativePath = workspace.asRelativePath(documentUri);

	return some(relativePath, fileExcludeGlobs);
}

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
	context.subscriptions.push(commands.registerTextEditorCommand("cfml.toggleLineComment", toggleComment(CommentType.Line, undefined)));
	context.subscriptions.push(commands.registerTextEditorCommand("cfml.insertSnippet", insertSnippet));
	context.subscriptions.push(commands.registerTextEditorCommand("cfml.toggleBlockComment", toggleComment(CommentType.Block, undefined)));
	// eslint-disable-next-line @typescript-eslint/no-misused-promises
	context.subscriptions.push(commands.registerTextEditorCommand("cfml.openActiveApplicationFile", showApplicationDocument));
	context.subscriptions.push(commands.registerTextEditorCommand("cfml.goToMatchingTag", goToMatchingTag));
	context.subscriptions.push(commands.registerTextEditorCommand("cfml.openCfDocs", CFDocsService.openCfDocsForCurrentWord.bind(CFDocsService)));
	context.subscriptions.push(commands.registerTextEditorCommand("cfml.openEngineDocs", CFDocsService.openEngineDocsForCurrentWord.bind(CFDocsService)));
	context.subscriptions.push(commands.registerTextEditorCommand("cfml.foldAllFunctions", foldAllFunctions));

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
		if (!document) {
			return;
		}

		const documentUri = document.uri;

		if (shouldExcludeDocument(documentUri)) {
			return;
		}

		if (isCfcFile(document, undefined)) {
			const cfmlCompletionSettings: WorkspaceConfiguration = workspace.getConfiguration("cfml.suggest", document.uri);
			const replaceComments = cfmlCompletionSettings.get<boolean>("replaceComments", true);
			await cacheComponentFromDocument(document, true, replaceComments, undefined);
		}
		else if (resolveBaseName(document.fileName) === "Application.cfm") {
			const documentStateContext: DocumentStateContext = getDocumentStateContext(document, true, true, undefined);
			const thisApplicationVariables: Variable[] = await parseVariableAssignments(documentStateContext, documentStateContext.docIsScript, undefined, undefined);
			const thisApplicationFilteredVariables: Variable[] = thisApplicationVariables.filter((variable: Variable) => {
				return [Scope.Application, Scope.Session, Scope.Request].includes(variable.scope);
			});
			setApplicationVariables(document.uri, thisApplicationFilteredVariables);
		}
	}));

	const componentWatcher: FileSystemWatcher = workspace.createFileSystemWatcher(COMPONENT_FILE_GLOB, false, true, false);
	componentWatcher.onDidCreate((componentUri: Uri) => {
		if (shouldExcludeDocument(componentUri)) {
			return;
		}

		workspace.openTextDocument(componentUri).then(async (document: TextDocument) => {
			const cfmlCompletionSettings: WorkspaceConfiguration = workspace.getConfiguration("cfml.suggest", document.uri);
			const replaceComments = cfmlCompletionSettings.get<boolean>("replaceComments", true);
			await cacheComponentFromDocument(document, true, replaceComments, undefined);
		});
	});
	componentWatcher.onDidDelete((componentUri: Uri) => {
		if (shouldExcludeDocument(componentUri)) {
			return;
		}

		clearCachedComponent(componentUri);

		const fileName: string = uriBaseName(componentUri);
		if (fileName === "Application.cfc") {
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
			const documentStateContext: DocumentStateContext = getDocumentStateContext(document, true, true, undefined);
			const thisApplicationVariables: Variable[] = await parseVariableAssignments(documentStateContext, documentStateContext.docIsScript, undefined, undefined);
			const thisApplicationFilteredVariables: Variable[] = thisApplicationVariables.filter((variable: Variable) => {
				return [Scope.Application, Scope.Session, Scope.Request].includes(variable.scope);
			});
			setApplicationVariables(applicationUri, thisApplicationFilteredVariables);
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
		if (evt.affectsConfiguration("cfml.mappings") || evt.affectsConfiguration("cfml.webRoot")) {
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

	context.subscriptions.push(
		commands.registerCommand(
			"cfml.copyPackage",
			(selectedFileUri: Uri) => {
				let fileUri: Uri | undefined = selectedFileUri;
				// If not selected file, try the activeTextEditor
				if (!fileUri) {
					fileUri = window.activeTextEditor?.document.uri;
				}

				if (fileUri) {
					const workspaceFolder = workspace.getWorkspaceFolder(fileUri);
					const workspacePath = workspaceFolder?.uri;
					// We are not in a workspace or the file is not in a workspace
					if (!workspacePath) {
						return;
					}

					const mappings = workspace.getConfiguration("cfml").get("mappings", []);

					const packagePath: string = convertPathToPackageName(
						fileUri,
						mappings
					);

					if (packagePath) {
						env.clipboard.writeText(packagePath);
					}
					else {
						window.showErrorMessage("Could not find the CFC Package Path for " + fileUri.path);
					}
				}
				else {
					window.showErrorMessage("No selected file or active editor for this command to execute against.");
				}
			}
		)
	);

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
 * This method is called when the extension is deactivated.
 */
export function deactivate(): void {
}
