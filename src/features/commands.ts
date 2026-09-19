import { commands, TextDocument, Uri, window, workspace, WorkspaceConfiguration, TextEditor, TextEditorEdit, Position, CancellationTokenSource, env } from "vscode";
import { executeLspCommand, isLspRunning } from "../lsp/cfmlLspClient";
import { Component, getApplicationUri, getWebroot } from "../entities/component";
import { UserFunction } from "../entities/userFunction";
import CFDocsService from "../utils/cfdocs/cfDocsService";
import { isCfcFile } from "../utils/contextUtil";
import { clearAllGlobalFunctions, clearAllGlobalTags, clearAllGlobalEntityDefinitions, clearAllCustomSnippets, cacheAllComponents, getComponent } from "./cachedEntities";
import SnippetService from "../utils/snippetService";
import { DocumentPositionStateContext, getDocumentPositionStateContext } from "../utils/documentUtil";
import { convertPathToPackageName } from "../utils/cfcPackages";

/**
 * Refreshes (clears and retrieves) all CFML global definitions
 */
export async function refreshGlobalDefinitionCache(): Promise<void> {
	clearAllGlobalFunctions();
	clearAllGlobalTags();
	clearAllGlobalEntityDefinitions();
	clearAllCustomSnippets();

	const cfmlGlobalDefinitionsSettings: WorkspaceConfiguration = workspace.getConfiguration("cfml.globalDefinitions");
	if (cfmlGlobalDefinitionsSettings.get<string>("source") === "cfdocs") {
		await CFDocsService.cacheAll();
	}

	await SnippetService.cacheAllCustomSnippets();
}

/**
 * Refreshes (clears and retrieves) all CFML workspace definitions
 */
export async function refreshWorkspaceDefinitionCache(): Promise<void> {
	// Cancel any previous refresh operation (running or finished)
	refreshWorkspaceTokenSource.cancel();
	refreshWorkspaceTokenSource = new CancellationTokenSource();

	const cfmlIndexComponentsSettings: WorkspaceConfiguration = workspace.getConfiguration("cfml.indexComponents");
	if (cfmlIndexComponentsSettings.get<boolean>("enable")) {
		await cacheAllComponents(refreshWorkspaceTokenSource.token);
	}
}
let refreshWorkspaceTokenSource = new CancellationTokenSource();

/**
 * Opens the relevant Application file based on the given editor
 * @param editor The text editor which represents the document for which to open the file
 */
export async function showApplicationDocument(editor: TextEditor): Promise<void> {
	const activeDocumentUri: Uri = editor.document.uri;

	if (activeDocumentUri.scheme === "untitled") {
		return;
	}

	const applicationUri: Uri | undefined = await getApplicationUri(activeDocumentUri);
	if (applicationUri) {
		const applicationDocument: TextDocument = await workspace.openTextDocument(applicationUri);
		if (!applicationDocument) {
			window.showErrorMessage("No Application found for the currently active document.");
			return;
		}

		window.showTextDocument(applicationDocument);
	}
}

/**
 * Folds all functions in the active editor. Currently only works for components.
 * @param editor  The text editor which represents the document for which to fold all function
 */
export function foldAllFunctions(editor: TextEditor): void {
	const document: TextDocument = editor.document;

	if (isCfcFile(document)) {
		const thisComponent: Component | undefined = getComponent(document.uri);
		if (thisComponent) {
			const functionStartLines: number[] = [];
			thisComponent.functions.filter((func: UserFunction) => {
				return !func.isImplicit && func.bodyRange !== undefined;
			}).forEach((func: UserFunction) => {
				if (func.bodyRange) {
					functionStartLines.push(func.bodyRange.start.line);
				}
			});

			if (functionStartLines.length > 0) {
				commands.executeCommand("editor.fold", { selectionLines: functionStartLines });
			}
		}
	}
}

/**
 * @param editor  The text editor which represents the document for which to fold all function
 * @param edit
 * @param args
 */

interface SnippetArgs {
	script: string;
	tag: string;
}

/**
 *
 * @param editor
 * @param edit
 * @param args
 */
export async function insertSnippet(editor: TextEditor, edit: TextEditorEdit, args: SnippetArgs): Promise<void> {
	const position: Position = editor.selection.start;
	const documentPositionStateContext: DocumentPositionStateContext = await getDocumentPositionStateContext(editor.document, position, true, true, undefined, false);

	if (documentPositionStateContext.positionIsScript) {
		commands.executeCommand("editor.action.insertSnippet", {
			langId: "cfml",
			snippet: args.script,
		});
	}
	else {
		commands.executeCommand("editor.action.insertSnippet", {
			langId: "cfml",
			snippet: args.tag,
		});
	}
}

/**
 * Copies the package path of a CFC file to the clipboard.
 *
 * Example: `/com/example/MyComponent.cfc` would be copied as `com.example.MyComponent`
 * @param selectedFileUri The URI of the file for which to copy the package path
 */
export function copyPackage(selectedFileUri?: Uri) {
	// When run from the command palette, no file is passed, so use whatever is currently active.
	if (!selectedFileUri) {
		if (!window.activeTextEditor) {
			window.showErrorMessage("No active text editor found.");
			return;
		}
		selectedFileUri = window.activeTextEditor.document.uri;
	}

	// Avoid confusion when used with .cfm files by mistake
	if (!selectedFileUri.path.toLowerCase().endsWith(".cfc")) {
		window.showErrorMessage("Copy CFC Package Path only works for CFC files.");
		return;
	}

	// Require a workspace so we have a web root to make the package path relative to (otherwise the absolute path would be used)
	const webrootUri = getWebroot(selectedFileUri);
	if (!webrootUri) {
		window.showErrorMessage("No workspace folder found for the selected file.");
		return;
	}

	const mappings = workspace.getConfiguration("cfml", selectedFileUri).get("mappings", []);

	const packagePath = convertPathToPackageName(
		selectedFileUri,
		webrootUri,
		mappings
	);

	env.clipboard.writeText(packagePath);
}

/**
 * Builds a code map of the workspace through the language server.
 *
 * The server builds it rather than the extension because the server already has
 * the workspace indexed, and that index is the expensive half of the work — it is
 * kept current by didChange and the watched-file handler, so a map built here
 * would be rebuilding what is already in memory next door.
 *
 * It returns as soon as the build starts and reports through window/showMessage,
 * because a map of a large workspace takes ten seconds or more.
 */
export async function generateCodeMap(): Promise<void> {
	if (!isLspRunning()) {
		void window.showWarningMessage("CFML: the code map needs the language server. Enable cfml.lsp.enabled.");
		return;
	}

	const level = await window.showQuickPick(
		[
			{ label: "function", description: "functions and files, with every relationship" },
			{ label: "call", description: "only functions and the calls between them" },
			{ label: "file", description: "one node per file" },
			{ label: "package", description: "one node per directory" },
		],
		{ placeHolder: "Level of detail" },
	);

	if (!level) {
		return;
	}

	const scope = await window.showQuickPick(
		[
			{ label: "everything", description: "the whole workspace" },
			{ label: "reachable", description: "only what an entry point reaches" },
			{ label: "detached", description: "only what no entry point reaches" },
		],
		{ placeHolder: "Scope" },
	);

	if (!scope) {
		return;
	}

	// The server refuses to write outside the workspace, so the default output
	// path is left to it rather than asked for here.
	await executeLspCommand("cfmleditor.generateCodeMap", [{
		level: level.label,
		format: "html",
		live: scope.label === "reachable",
		detached: scope.label === "detached",
		open: true,
	}]);
}

/**
 * Reports what the code map resolves in this workspace, writing nothing.
 *
 * The cheap half of the same question, and the one worth asking first: a map is
 * worth what its resolution rate says it is, and an empty caller list means much
 * less in a workspace resolving half its call sites than in one resolving all of
 * them.
 */
export async function showCodeMapStats(): Promise<void> {
	if (!isLspRunning()) {
		void window.showWarningMessage("CFML: the code map needs the language server. Enable cfml.lsp.enabled.");
		return;
	}

	await executeLspCommand("cfmleditor.showCodeMapStats", [{}]);
}
