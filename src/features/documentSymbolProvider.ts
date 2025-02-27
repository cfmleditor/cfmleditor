import { CancellationToken, DocumentSymbolProvider, Position, Range, DocumentSymbol, SymbolKind, TextDocument, WorkspaceConfiguration, workspace } from "vscode";
import { Component } from "../entities/component";
import { Property } from "../entities/property";
import { getLocalVariables } from "../entities/userFunction";
import { parseVariableAssignments, usesConstantConvention, Variable } from "../entities/variable";
import { DocumentStateContext, getDocumentStateContext } from "../utils/documentUtil";
import { getComponent } from "./cachedEntities";
import { Scope } from "../entities/scope";

export default class CFMLDocumentSymbolProvider implements DocumentSymbolProvider {
	/**
	 * Provide symbol information for the given document.
	 * @param document The document for which to provide symbols.
	 * @param _token A cancellation token.
	 * @returns
	 */

	public async provideDocumentSymbols(document: TextDocument, _token: CancellationToken): Promise<DocumentSymbol[]> {
		let documentSymbols: DocumentSymbol[] = [];

		if (!document.fileName) {
			return documentSymbols;
		}

		// console.log("provideDocumentSymbols:CFMLDocumentSymbolProvider:" + _token?.isCancellationRequested);

		const cfmlCompletionSettings: WorkspaceConfiguration = workspace.getConfiguration("cfml.suggest", document.uri);
		const replaceComments = cfmlCompletionSettings.get<boolean>("replaceComments", true);

		const documentStateContext: DocumentStateContext = getDocumentStateContext(document, false, replaceComments, _token, true);

		if (documentStateContext.isCfcFile) {
			const componentSymbols = await CFMLDocumentSymbolProvider.getComponentSymbols(documentStateContext, _token);
			documentSymbols = documentSymbols.concat(componentSymbols);
		}
		else if (documentStateContext.isCfmFile) {
			const templateSymbols = await CFMLDocumentSymbolProvider.getTemplateSymbols(documentStateContext, _token);
			documentSymbols = documentSymbols.concat(templateSymbols);
		}

		return documentSymbols;
	}

	/**
	 * Provide symbol information for component and its contents
	 * @param documentStateContext The document context for which to provide symbols.
	 * @param _token
	 * @returns
	 */
	private static async getComponentSymbols(documentStateContext: DocumentStateContext, _token: CancellationToken): Promise<DocumentSymbol[]> {
		const document: TextDocument = documentStateContext.document;
		const component: Component | undefined = getComponent(document.uri, _token);

		if (!component) {
			return [];
		}

		const componentSymbol: DocumentSymbol = new DocumentSymbol(
			component.name,
			"",
			component.isInterface ? SymbolKind.Interface : SymbolKind.Class,
			new Range(new Position(0, 0), document.positionAt(document.getText().length)),
			component.declarationRange
		);
		componentSymbol.children = [];

		// Component properties
		const propertySymbols: DocumentSymbol[] = [];
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		component.properties.forEach((property: Property, propertyKey: string) => {
			if (property.nameRange) {
				propertySymbols.push(new DocumentSymbol(
					property.name,
					"",
					SymbolKind.Property,
					property.propertyRange,
					property.nameRange
				));
			}
		});
		componentSymbol.children = componentSymbol.children.concat(propertySymbols);

		// Component variables
		const variableSymbols: DocumentSymbol[] = [];
		component.variables.forEach((variable: Variable) => {
			let detail = "";
			if (variable.scope !== Scope.Unknown) {
				detail = `${variable.scope}.${variable.identifier}`;
			}
			if (variable.declarationLocation) {
				variableSymbols.push(new DocumentSymbol(
					variable.identifier,
					detail,
					usesConstantConvention(variable.identifier) || variable.final ? SymbolKind.Constant : SymbolKind.Variable,
					variable.declarationLocation.range,
					variable.declarationLocation.range
				));
			}
		});
		componentSymbol.children = componentSymbol.children.concat(variableSymbols);

		// Component functions
		const functionSymbols: DocumentSymbol[] = [];

		for (const [functionKey, userFunction] of component.functions) {
			if (userFunction.name && userFunction.location && userFunction.nameRange) {
				const currFuncSymbol: DocumentSymbol = new DocumentSymbol(
					userFunction.name,
					"",
					functionKey === "init" ? SymbolKind.Constructor : SymbolKind.Method,
					userFunction.location.range,
					userFunction.nameRange
				);
				currFuncSymbol.children = [];

				if (!userFunction.isImplicit) {
					// Component function local variables
					const localVarSymbols: DocumentSymbol[] = [];
					// TODO: Improve performance
					const localVariables: Variable[] = await getLocalVariables(userFunction, documentStateContext, component.isScript, _token);
					localVariables.forEach((variable: Variable) => {
						let detail = "";
						if (variable.scope !== Scope.Unknown) {
							detail = `${variable.scope}.${variable.identifier}`;
						}
						if (variable.declarationLocation) {
							localVarSymbols.push(new DocumentSymbol(
								variable.identifier,
								detail,
								usesConstantConvention(variable.identifier) || variable.final ? SymbolKind.Constant : SymbolKind.Variable,
								variable.declarationLocation.range,
								variable.declarationLocation.range
							));
						}
					});
					currFuncSymbol.children = currFuncSymbol.children.concat(localVarSymbols);
				}

				functionSymbols.push(currFuncSymbol);
			}
		}

		componentSymbol.children = componentSymbol.children.concat(functionSymbols);

		return [componentSymbol];
	}

	/**
	 * Provide symbol information for templates
	 * @param documentStateContext The document context for which to provide symbols.
	 * @param _token
	 * @returns
	 */
	private static async getTemplateSymbols(documentStateContext: DocumentStateContext, _token: CancellationToken): Promise<DocumentSymbol[]> {
		const templateSymbols: DocumentSymbol[] = [];
		// TODO: Cache template variables?
		const allVariables: Variable[] = await parseVariableAssignments(documentStateContext, false, undefined, _token);
		allVariables.forEach((variable: Variable) => {
			const kind: SymbolKind = usesConstantConvention(variable.identifier) || variable.final ? SymbolKind.Constant : SymbolKind.Variable;
			let detail = "";
			if (variable.scope !== Scope.Unknown) {
				detail = `${variable.scope}.${variable.identifier}`;
			}

			if (variable.declarationLocation) {
				templateSymbols.push(new DocumentSymbol(
					variable.identifier,
					detail,
					kind,
					variable.declarationLocation.range,
					variable.declarationLocation.range
				));
			}
		});

		// TODO: Include inline functions

		return templateSymbols;
	}
}
