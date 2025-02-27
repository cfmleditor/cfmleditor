import { CancellationToken, Location, Position, SymbolInformation, SymbolKind, TextDocument, TextEditor, Uri, window, workspace, WorkspaceSymbolProvider } from "vscode";
import { LANGUAGE_CFS_ID, LANGUAGE_ID } from "../cfmlMain";
import { Component, COMPONENT_EXT } from "../entities/component";
import { UserFunction } from "../entities/userFunction";
import { equalsIgnoreCase } from "../utils/textUtil";
import { searchAllFunctionNames, searchAllComponentNames } from "./cachedEntities";
import { uriBaseName } from "../utils/fileUtil";

export default class CFMLWorkspaceSymbolProvider implements WorkspaceSymbolProvider {
	/**
	 * Workspace-wide search for a symbol matching the given query string.
	 * @param query A non-empty query string.
	 * @param _token A cancellation token.
	 * @returns
	 */

	public provideWorkspaceSymbols(query: string, _token: CancellationToken): SymbolInformation[] {
		// console.log("provideWorkspaceSymbols:CFMLWorkspaceSymbolProvider:" + _token?.isCancellationRequested);

		const workspaceSymbols: SymbolInformation[] = [];
		if (query === "") {
			return workspaceSymbols;
		}

		let uri: Uri | undefined;
		const editor: TextEditor | undefined = window.activeTextEditor;
		if (editor) {
			const document: TextDocument = editor.document;
			if (document && (document.languageId === LANGUAGE_ID || document.languageId === LANGUAGE_CFS_ID)) {
				uri = document.uri;
			}
		}
		if (!uri) {
			const documents: ReadonlyArray<TextDocument> = workspace.textDocuments;
			for (const document of documents) {
				if (document.languageId === LANGUAGE_ID || document.languageId === LANGUAGE_CFS_ID) {
					uri = document.uri;
					break;
				}
			}
		}

		if (!uri) {
			return workspaceSymbols;
		}

		const userFunctions: UserFunction[] = searchAllFunctionNames(query);

		// workspaceSymbols = workspaceSymbols.concat(
		userFunctions.forEach((userFunction: UserFunction) => {
			if (userFunction.name && userFunction.location) {
				const symbol: SymbolInformation = new SymbolInformation(
					userFunction.name + "()",
					equalsIgnoreCase(userFunction.name, "init") ? SymbolKind.Constructor : SymbolKind.Function,
					uriBaseName(userFunction.location.uri, COMPONENT_EXT),
					userFunction.location
				);
				workspaceSymbols.push(symbol);
			}
		});
		//        );

		const components: Component[] = searchAllComponentNames(query, _token);
		// workspaceSymbols = workspaceSymbols.concat(
		components.forEach((component: Component) => {
			const symbol: SymbolInformation = new SymbolInformation(
				uriBaseName(component.uri, COMPONENT_EXT),
				component.isInterface ? SymbolKind.Interface : SymbolKind.Class,
				"",
				new Location(component.uri, new Position(0, 0))
			);
			workspaceSymbols.push(symbol);
		});
		// );

		return workspaceSymbols;
	}
}
