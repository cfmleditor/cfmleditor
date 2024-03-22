import { commands, TextDocument, Uri, window, workspace, WorkspaceConfiguration, TextEditor, CancellationToken, TextEditorEdit } from "vscode";
import { Component, getApplicationUri } from "../entities/component";
import { UserFunction } from "../entities/userFunction";
import CFDocsService from "../utils/cfdocs/cfDocsService";
import { isCfcFile } from "../utils/contextUtil";
import { clearAllGlobalFunctions, clearAllGlobalTags, clearAllGlobalEntityDefinitions, clearAllCustomSnippets, cacheAllComponents, getComponent } from "./cachedEntities";
import SnippetService from "../utils/snippetService";

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
    CFDocsService.cacheAll();
  }

  SnippetService.cacheAllCustomSnippets();
}

/**
 * Refreshes (clears and retrieves) all CFML workspace definitions
 * @param _token
 */
export async function refreshWorkspaceDefinitionCache(_token: CancellationToken): Promise<void> {
  const cfmlIndexComponentsSettings: WorkspaceConfiguration = workspace.getConfiguration("cfml.indexComponents");
  if (cfmlIndexComponentsSettings.get<boolean>("enable")) {
    await cacheAllComponents(_token);
  }
}

/**
 * Opens the relevant Application file based on the given editor
 * @param editor The text editor which represents the document for which to open the file
 */
export async function showApplicationDocument(editor: TextEditor): Promise<void> {
  const activeDocumentUri: Uri = editor.document.uri;

  if (activeDocumentUri.scheme === "untitled") {
    return;
  }

  const applicationUri: Uri = getApplicationUri(activeDocumentUri);
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
export async function foldAllFunctions(editor: TextEditor, edit: TextEditorEdit, _token: CancellationToken): Promise<void> {
  const document: TextDocument = editor.document;

  if (isCfcFile(document, _token)) {
    const thisComponent: Component = getComponent(document.uri, _token);
    if (thisComponent) {
      const functionStartLines: number[] = [];
      thisComponent.functions.filter((func: UserFunction) => {
        return !func.isImplicit && func.bodyRange !== undefined;
      }).forEach((func: UserFunction) => {
        functionStartLines.push(func.bodyRange.start.line);
      });

      if (functionStartLines.length > 0) {
        commands.executeCommand("editor.fold", { selectionLines: functionStartLines });
      }
    }
  }
}
