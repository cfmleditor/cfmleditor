import { DefinitionProvider, TextDocument, Position, CancellationToken, DefinitionLink, Uri, Range, workspace, WorkspaceConfiguration } from "vscode";
import { objectReferencePatterns, ReferencePattern, Component } from "../entities/component";
import { cachedComponentPathToUri, getComponent, searchAllFunctionNames } from "./cachedEntities";
import { Scope, getValidScopesPrefixPattern, getVariableScopePrefixPattern, unscopedPrecedence } from "../entities/scope";
import { UserFunction, UserFunctionSignature, Argument, getLocalVariables, getFunctionFromPrefix } from "../entities/userFunction";
import { Property } from "../entities/property";
import { equalsIgnoreCase } from "../utils/textUtil";
import { Variable, parseVariableAssignments, getApplicationVariables, getServerVariables } from "../entities/variable";
import { DocumentPositionStateContext, getDocumentPositionStateContext } from "../utils/documentUtil";
import { SearchMode } from "../utils/collections";
import { getFunctionSuffixPattern } from "../entities/function";

export default class CFMLDefinitionProvider implements DefinitionProvider {
	/**
	 * Provide the definition of the symbol at the given position in the given document.
	 * @param document The document for which the command was invoked.
	 * @param position The position for which the command was invoked.
	 * @param _token A cancellation token.
	 * @returns
	 */
	public async provideDefinition(document: TextDocument, position: Position, _token: CancellationToken | undefined): Promise<DefinitionLink[] | undefined> {
		// console.log("provideDefinition:CFMLDefinitionProvider:" + _token?.isCancellationRequested);

		const cfmlDefinitionSettings: WorkspaceConfiguration = workspace.getConfiguration("cfml.definition", document.uri);
		if (!cfmlDefinitionSettings.get<boolean>("enable", true)) {
			return undefined;
		}

		const cfmlCompletionSettings: WorkspaceConfiguration = workspace.getConfiguration("cfml.suggest", document.uri);
		const replaceComments = cfmlCompletionSettings.get<boolean>("replaceComments", true);

		const documentPositionStateContext: DocumentPositionStateContext = getDocumentPositionStateContext(document, position, true, replaceComments, _token, false);

		if (documentPositionStateContext.positionInComment) {
			return undefined;
		}

		const results: DefinitionLink[] = [];

		const docIsCfcFile: boolean = documentPositionStateContext.isCfcFile;
		const docIsCfmFile: boolean = documentPositionStateContext.isCfmFile;
		const documentText: string = documentPositionStateContext.sanitizedDocumentText;
		let wordRange: Range | undefined = document.getWordRangeAtPosition(position);

		const currentWord: string = documentPositionStateContext.currentWord;
		const lowerCurrentWord: string = currentWord.toLowerCase();
		if (!wordRange) {
			wordRange = new Range(position, position);
		}

		const docPrefix: string = documentPositionStateContext.docPrefix;

		/*
		 * Object References
		 * A catch-all for object references using Regular Expressions.
		 * - new Foo()
		 * - createObject("component", "Foo")
		 * - import "Foo"
		 * - component="Foo'
		 * - isInstanceOf("Foo")
		 */
		// TODO: These references should ideally be in cachedEntities.
		let referenceMatch: RegExpExecArray | null;
		objectReferencePatterns.map((element: ReferencePattern) => {
			const pattern: RegExp = element.pattern;
			while ((referenceMatch = pattern.exec(documentText))) {
				const path: string = referenceMatch[element.refIndex];
				const offset: number = referenceMatch.index + referenceMatch[0].lastIndexOf(path);
				const pathRange = new Range(
					document.positionAt(offset),
					document.positionAt(offset + path.length)
				);

				if (pathRange.contains(position)) {
					const componentUri: Uri | undefined = cachedComponentPathToUri(path, document.uri, _token);
					if (componentUri) {
						const comp: Component | undefined = getComponent(componentUri);
						if (comp) {
							results.push({
								originSelectionRange: pathRange,
								targetUri: comp.uri,
								targetRange: comp.declarationRange,
								targetSelectionRange: comp.declarationRange,
							});
						}
					}
				}
			}
		});

		if (docIsCfcFile) {
			const thisComponent: Component | undefined = documentPositionStateContext.component;
			if (thisComponent) {
				/*
				 * Component Extends
				 * component extends="Foo" {}
				 * <cfcomponent extends="Foo">
				 */
				if (thisComponent.extendsRange && thisComponent.extendsRange.contains(position)) {
					if (thisComponent.extends) {
						const extendsComp: Component | undefined = getComponent(thisComponent.extends);
						if (extendsComp) {
							results.push({
								originSelectionRange: thisComponent.extendsRange,
								targetUri: extendsComp.uri,
								targetRange: extendsComp.declarationRange,
								targetSelectionRange: extendsComp.declarationRange,
							});
						}
					}
				}

				/*
				 * Component Implements
				 * component implements="IFoo" {}
				 * <cfcomponent implements="IFoo">
				 */
				if (thisComponent.implementsRanges) {
					thisComponent.implementsRanges.map((range: Range, idx: number) => {
						if (range && range.contains(position) && thisComponent.implements) {
							const implComp: Component | undefined = getComponent(thisComponent.implements[idx]);
							if (implComp) {
								results.push({
									originSelectionRange: range,
									targetUri: implComp.uri,
									targetRange: implComp.declarationRange,
									targetSelectionRange: implComp.declarationRange,
								});
							}
						}
					});
				}

				// Component functions (related)
				for (const [, func] of thisComponent.functions) {
					/*
					 * Function return types
					 * - ComponentType function foo() {}
					 * - <cffunction name="foo" returntype="ComponentType">
					 */
					if (func.returnTypeUri && func.returnTypeRange && func.returnTypeRange.contains(position)) {
						const returnTypeComp: Component | undefined = getComponent(func.returnTypeUri);
						if (returnTypeComp) {
							results.push({
								originSelectionRange: func.returnTypeRange,
								targetUri: returnTypeComp.uri,
								targetRange: returnTypeComp.declarationRange,
								targetSelectionRange: returnTypeComp.declarationRange,
							});
						}
					}

					/*
					 * Argument types
					 * - function foo(ComponentType arg) {}
					 * - <cfargument type="ComponentType">
					 */
					func.signatures.map((signature: UserFunctionSignature) => {
						const parameters = signature.parameters.filter((arg: Argument) => {
							return arg.dataTypeComponentUri && arg.dataTypeRange && arg.dataTypeRange.contains(position);
						});

						parameters.map((arg: Argument) => {
							if (arg.dataTypeComponentUri) {
								const argTypeComp: Component | undefined = getComponent(arg.dataTypeComponentUri);
								if (argTypeComp) {
									results.push({
										originSelectionRange: arg.dataTypeRange,
										targetUri: argTypeComp.uri,
										targetRange: argTypeComp.declarationRange,
										targetSelectionRange: argTypeComp.declarationRange,
									});
								}
							}
						});
					});

					if (func.bodyRange && func.bodyRange.contains(position)) {
						/*
						 * Local variables defined with:
						 * - var variableName = value;
						 * - local.variableName = value;
						 */
						const localVariables = await getLocalVariables(func, documentPositionStateContext, thisComponent.isScript, _token);
						const localVarPrefixPattern = getValidScopesPrefixPattern([Scope.Local], true);
						if (localVarPrefixPattern.test(docPrefix)) {
							localVariables.filter((localVar: Variable) => {
								return position.isAfterOrEqual(localVar.declarationLocation.range.start) && equalsIgnoreCase(localVar.identifier, currentWord);
							}).forEach((localVar: Variable) => {
								results.push({
									targetUri: localVar.declarationLocation.uri,
									targetRange: localVar.declarationLocation.range,
									targetSelectionRange: localVar.declarationLocation.range,
								});
							});
						}

						/*
						 * Argument variables defined with:
						 * - <cfargument name="argumentName">
						 */
						if (results.length === 0) {
							const argumentPrefixPattern = getValidScopesPrefixPattern([Scope.Arguments], true);
							if (argumentPrefixPattern.test(docPrefix)) {
								func.signatures.forEach((signature: UserFunctionSignature) => {
									signature.parameters.filter((arg: Argument) => {
										return equalsIgnoreCase(arg.name, currentWord);
									}).forEach((arg: Argument) => {
										results.push({
											targetUri: thisComponent.uri,
											targetRange: arg.nameRange,
											targetSelectionRange: arg.nameRange,
										});
									});
								});
							}
						}
					}
				}

				/*
				 * Component properties (declarations)
				 * - <cfproperty type="Foo" name="Bar">
				 * - property type="Foo" name="Bar";
				 */
				const componentproperties = thisComponent.properties.filter((prop: Property) => {
					return prop.dataTypeComponentUri !== undefined && prop.dataTypeRange && prop.dataTypeRange.contains(position) ? true : false;
				});

				for (const [, prop] of componentproperties) {
					if (prop.dataTypeComponentUri) {
						const dataTypeComp: Component | undefined = getComponent(prop.dataTypeComponentUri);
						if (dataTypeComp) {
							results.push({
								originSelectionRange: prop.dataTypeRange,
								targetUri: dataTypeComp.uri,
								targetRange: dataTypeComp.declarationRange,
								targetSelectionRange: dataTypeComp.declarationRange,
							});
						}
					}
				}

				/*
				 * Component variables
				 * - variables.foo = "bar";
				 */
				const variablesPrefixPattern = getValidScopesPrefixPattern([Scope.Variables], false);
				if (variablesPrefixPattern.test(documentPositionStateContext.docPrefix)) {
					thisComponent.variables.filter((variable: Variable) => {
						return equalsIgnoreCase(variable.identifier, currentWord);
					}).forEach((variable: Variable) => {
						results.push({
							targetUri: variable.declarationLocation.uri,
							targetRange: variable.declarationLocation.range,
							targetSelectionRange: variable.declarationLocation.range,
						});
					});
				}
			}
		}
		else if (docIsCfmFile) {
			/*
			 * Assigned variables
			 * - <cfset foo = "bar">
			 * - <cfset url.foo = "bar">
			 * - <cfparam name="url.foo">
			 * - <cfloop index="foo">
			 */
			const docVariableAssignments: Variable[] = await parseVariableAssignments(documentPositionStateContext, false, undefined, _token);
			const variableScopePrefixPattern: RegExp = getVariableScopePrefixPattern();
			const variableScopePrefixMatch: RegExpExecArray | null = variableScopePrefixPattern.exec(documentPositionStateContext.docPrefix);
			if (variableScopePrefixMatch) {
				const validScope: string = variableScopePrefixMatch[1];
				let currentScope: Scope;
				if (validScope) {
					currentScope = Scope.valueOf(validScope);
				}

				docVariableAssignments.filter((variable: Variable) => {
					if (!equalsIgnoreCase(variable.identifier, currentWord)) {
						return false;
					}

					if (currentScope) {
						return (variable.scope === currentScope || (variable.scope === Scope.Unknown && unscopedPrecedence.includes(currentScope)));
					}

					return (unscopedPrecedence.includes(variable.scope) || variable.scope === Scope.Unknown);
				}).forEach((variable: Variable) => {
					results.push({
						targetUri: variable.declarationLocation.uri,
						targetRange: variable.declarationLocation.range,
						targetSelectionRange: variable.declarationLocation.range,
					});
				});
			}
		}

		/*
		 * User function
		 * - <cffunction name="foo">
		 */
		const userFunc: UserFunction | undefined = await getFunctionFromPrefix(documentPositionStateContext, lowerCurrentWord, undefined, _token);
		if (userFunc) {
			results.push({
				targetUri: userFunc.location.uri,
				targetRange: userFunc.nameRange, // TODO: userFunc.location.range
				targetSelectionRange: userFunc.nameRange,
			});
		}

		/*
		 * Application variables in Application.cfc
		 * - application.foo = "bar";
		 * - session.foo = "bar";
		 * - request.foo = "bar";
		 */
		const applicationVariablesPrefixPattern = getValidScopesPrefixPattern([Scope.Application, Scope.Session, Scope.Request], false);
		const variableScopePrefixMatch: RegExpExecArray | null = applicationVariablesPrefixPattern.exec(documentPositionStateContext.docPrefix);
		if (variableScopePrefixMatch) {
			const currentScope = Scope.valueOf(variableScopePrefixMatch[1]);

			const applicationDocVariables: Variable[] = await getApplicationVariables(document.uri);
			applicationDocVariables.filter((variable: Variable) => {
				return variable.scope === currentScope && equalsIgnoreCase(variable.identifier, currentWord);
			}).forEach((variable: Variable) => {
				results.push({
					targetUri: variable.declarationLocation.uri,
					targetRange: variable.declarationLocation.range,
					targetSelectionRange: variable.declarationLocation.range,
				});
			});
		}

		/*
		 * Server variables in Server.cfc
		 * - server.foo = "bar";
		 */
		const serverVariablesPrefixPattern = getValidScopesPrefixPattern([Scope.Server], false);
		if (serverVariablesPrefixPattern.test(documentPositionStateContext.docPrefix)) {
			const serverDocVariables: Variable[] = getServerVariables(document.uri);
			serverDocVariables.filter((variable: Variable) => {
				return variable.scope === Scope.Server && equalsIgnoreCase(variable.identifier, currentWord);
			}).forEach((variable: Variable) => {
				results.push({
					targetUri: variable.declarationLocation.uri,
					targetRange: variable.declarationLocation.range,
					targetSelectionRange: variable.declarationLocation.range,
				});
			});
		}

		// Search for function by name
		if (results.length === 0 && documentPositionStateContext.isContinuingExpression && cfmlDefinitionSettings.get<boolean>("userFunctions.search.enable", false)) {
			const lookaheadMaxLength: number = cfmlDefinitionSettings.get<number>("lookahead.maxLength", -1);
			const endOfWordOffset = document.offsetAt(wordRange.end);
			const searchDocumentOffset = lookaheadMaxLength > -1 ? Math.min((endOfWordOffset + lookaheadMaxLength), documentText.length) : documentText.length;
			const wordSuffix: string = documentText.slice(endOfWordOffset, searchDocumentOffset);
			const functionSuffixPattern: RegExp = getFunctionSuffixPattern();
			if (functionSuffixPattern.test(wordSuffix)) {
				const functionSearchResults = searchAllFunctionNames(lowerCurrentWord, SearchMode.EqualTo);
				functionSearchResults.forEach((userFunc: UserFunction) => {
					// Check if the function is in the current document
					if (userFunc.location.uri.fsPath !== document.uri.fsPath) {
						results.push({
							targetUri: userFunc.location.uri,
							targetRange: userFunc.nameRange, // TODO: userFunc.location.range
							targetSelectionRange: userFunc.nameRange,
						});
					}
				});
			}
		}

		return results;
	}
}
