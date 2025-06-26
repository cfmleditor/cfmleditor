import { commands, TextDocument, Uri, window, workspace, WorkspaceConfiguration, TextEditor, CancellationToken, TextEditorEdit, Position, CancellationTokenSource, env } from "vscode";
import { Component, getApplicationUri } from "../entities/component";
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
 * @param edit
 * @param _token
 */
export function foldAllFunctions(editor: TextEditor, edit: TextEditorEdit, _token: CancellationToken | undefined): void {
	const document: TextDocument = editor.document;

	if (isCfcFile(document, _token)) {
		const thisComponent: Component | undefined = getComponent(document.uri, _token);
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
export function copyPackage(selectedFileUri: Uri) {
	const workspaceFolder = workspace.getWorkspaceFolder(selectedFileUri);
	const workspacePath = workspaceFolder?.uri;
	// We are not in a workspace or the file is not in a workspace
	if (!workspacePath) {
		return;
	}
	const mappings = workspace.getConfiguration("cfml").get("mappings", []);

	const packagePath = convertPathToPackageName(
		selectedFileUri,
		mappings
	);

	env.clipboard.writeText(packagePath);
}
