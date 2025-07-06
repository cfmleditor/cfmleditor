import { commands, TextDocument, Uri, window, workspace, WorkspaceConfiguration, TextEditor, TextEditorEdit, Position, CancellationTokenSource, env, Location } from "vscode";
import { Component, getApplicationUri, getWebroot } from "../entities/component";
import { UserFunction } from "../entities/userFunction";
import CFDocsService from "../utils/cfdocs/cfDocsService";
import { isCfcFile } from "../utils/contextUtil";
import { clearAllGlobalFunctions, clearAllGlobalTags, clearAllGlobalEntityDefinitions, clearAllCustomSnippets, cacheAllComponents, getComponent } from "./cachedEntities";
import SnippetService from "../utils/snippetService";
import { DocumentPositionStateContext, getDocumentPositionStateContext } from "../utils/documentUtil";
import { convertPathToPackageName } from "../utils/cfcPackages";
import { resolveRouteControllerPath, resolveRouteTemplatePath } from "../utils/fileUtil";

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
export function insertSnippet(editor: TextEditor, edit: TextEditorEdit, args: SnippetArgs): void {
	const position: Position = editor.selection.start;
	const documentPositionStateContext: DocumentPositionStateContext = getDocumentPositionStateContext(editor.document, position, true, true, undefined, false);

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
 * Determine the path and function for the `view` using `resolveRouteTemplatePath` then open editor
 */
export async function goToRouteView() {
	// Prompt the user for input
	const userInput = await window.showInputBox({
		prompt: "Enter the route",
		placeHolder: "Type something here...",
	});

	// Check if the user canceled the input
	if (!userInput) {
		window.showInformationMessage("No input provided. Command canceled.");
		return;
	}

	const route: string = userInput;

	// Determine the base URI
	const activeEditor = window.activeTextEditor;
	const baseUri = activeEditor ? activeEditor.document.uri : undefined;

	// Resolve the template paths
	const customMappingPaths: string[] = await resolveRouteTemplatePath(baseUri, route);

	if (customMappingPaths.length === 0) {
		window.showErrorMessage("No matching files found for the given route.");
		return;
	}

	// Show a list of resolved paths for the user to select
	const selectedPath = customMappingPaths.length === 1
		? customMappingPaths[0]
		: await window.showQuickPick(customMappingPaths, {
				placeHolder: "Select a file to open",
			});

	// Check if the user canceled the selection
	if (!selectedPath) {
		window.showInformationMessage("No file selected. Command canceled.");
		return;
	}

	// Open the selected file
	const document = await workspace.openTextDocument(Uri.file(selectedPath));
	await window.showTextDocument(document);
}

/**
 * Determine the path and function for the controller using `resolveRouteControllerPath` then open editor / reveal range
 */
export async function goToRouteController() {
	// Prompt the user for input
	const userInput = await window.showInputBox({
		prompt: "Enter the route",
		placeHolder: "Type something here...",
	});

	// Check if the user canceled the input
	if (!userInput) {
		window.showInformationMessage("No input provided. Command canceled.");
		return;
	}

	const route: string = userInput;

	// Determine the base URI
	const activeEditor = window.activeTextEditor;
	const baseUri = activeEditor ? activeEditor.document.uri : undefined;

	const [uri, fn]: [Uri | undefined, UserFunction | undefined] = await resolveRouteControllerPath(baseUri, route);

	if (!uri) {
		window.showErrorMessage("No matching files found for the given route.");
		return;
	}

	const document = await workspace.openTextDocument(uri);
	const editor = await window.showTextDocument(document);

	if (!fn) {
		window.showErrorMessage("No matching function found for the given route.");
		return;
	}

	const location: Location = fn.location;

	if (!location) {
		return;
	}

	// Reveal the range in the editor
	editor.revealRange(location.range);
}
