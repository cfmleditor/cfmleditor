import { TypeDefinitionProvider, TextDocument, Position, CancellationToken, Definition, Range, Location, workspace, WorkspaceConfiguration } from "vscode";
import { Component } from "../entities/component";
import { getComponent } from "./cachedEntities";
import { Scope, getValidScopesPrefixPattern, getVariableScopePrefixPattern, unscopedPrecedence } from "../entities/scope";
import { UserFunction, UserFunctionSignature, Argument, getLocalVariables, getFunctionFromPrefix } from "../entities/userFunction";
import { Property } from "../entities/property";
import { equalsIgnoreCase } from "../utils/textUtil";
import { Variable, parseVariableAssignments, getApplicationVariables, getServerVariables } from "../entities/variable";
import { DocumentPositionStateContext, getDocumentPositionStateContext } from "../utils/documentUtil";

export default class CFMLTypeDefinitionProvider implements TypeDefinitionProvider {

    /**
     * Provide the type definition of the symbol at the given position in the given document.
     * @param document The document for which the command was invoked.
     * @param position The position for which the command was invoked.
     * @param _token A cancellation token.
     * @returns
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public async provideTypeDefinition(document: TextDocument, position: Position, _token: CancellationToken): Promise<Definition> {
        // console.log("provideTypeDefinition:CFMLTypeDefinitionProvider:" + _token?.isCancellationRequested);

        const results: Definition = [];

        const cfmlCompletionSettings: WorkspaceConfiguration = workspace.getConfiguration("cfml.suggest", document.uri);
        const replaceComments = cfmlCompletionSettings.get<boolean>("replaceComments", true);

        const documentPositionStateContext: DocumentPositionStateContext = await getDocumentPositionStateContext(document, position, false, replaceComments, _token, false);

        if (documentPositionStateContext.positionInComment) {
            return null;
        }

        const docIsCfcFile: boolean = documentPositionStateContext.isCfcFile;
        const docIsCfmFile: boolean = documentPositionStateContext.isCfmFile;
        let wordRange: Range = document.getWordRangeAtPosition(position);
        const currentWord: string = documentPositionStateContext.currentWord;
        const lowerCurrentWord: string = currentWord.toLowerCase();
        if (!wordRange) {
            wordRange = new Range(position, position);
        }

        const docPrefix: string = documentPositionStateContext.docPrefix;

        if (docIsCfcFile) {
            const thisComponent: Component = documentPositionStateContext.component;
            if (thisComponent) {
                // Component functions (related)
                for (const [, func] of thisComponent.functions) {
                    // Argument declarations
                    await Promise.all(func.signatures.map(async (signature: UserFunctionSignature) => {
                        const signatureparameters = signature.parameters.filter((arg: Argument) => {
                            return arg.dataTypeComponentUri && arg.nameRange && arg.nameRange.contains(position);
                        })

                        await Promise.all(signatureparameters.map(async (arg: Argument) => {
                            const argTypeComp: Component = await getComponent(arg.dataTypeComponentUri, _token);
                            if (argTypeComp) {
                                results.push(new Location(
                                    argTypeComp.uri,
                                    argTypeComp.declarationRange
                                ));
                            }
                        }));
                    }));

                    if (func.bodyRange && func.bodyRange.contains(position)) {
                        // Local variable uses
                        const localVariables = await getLocalVariables(func, documentPositionStateContext, thisComponent.isScript, _token);
                        const localVarPrefixPattern = getValidScopesPrefixPattern([Scope.Local], true);
                        if (localVarPrefixPattern.test(docPrefix)) {
                            const localVariablesfiltered = localVariables.filter((localVar: Variable) => {
                                return position.isAfterOrEqual(localVar.declarationLocation.range.start) && equalsIgnoreCase(localVar.identifier, currentWord) && localVar.dataTypeComponentUri;
                            });
                            await Promise.all(localVariablesfiltered.map(async (localVar: Variable) => {
                                const localVarTypeComp: Component = await getComponent(localVar.dataTypeComponentUri, _token);
                                if (localVarTypeComp) {
                                    results.push(new Location(
                                        localVarTypeComp.uri,
                                        localVarTypeComp.declarationRange
                                    ));
                                }
                            }));
                        }

                        // Argument uses
                        if (results.length === 0) {
                            const argumentPrefixPattern = getValidScopesPrefixPattern([Scope.Arguments], true);
                            if (argumentPrefixPattern.test(docPrefix)) {
                                await Promise.all(func.signatures.map(async (signature: UserFunctionSignature) => {
                                    const signatureparameters = signature.parameters.filter((arg: Argument) => {
                                        return equalsIgnoreCase(arg.name, currentWord) && arg.dataTypeComponentUri;
                                    });
                                    await Promise.all(signatureparameters.map(async (arg: Argument) => {
                                        const argTypeComp: Component = await getComponent(arg.dataTypeComponentUri, _token);
                                        if (argTypeComp) {
                                            results.push(new Location(
                                                argTypeComp.uri,
                                                argTypeComp.declarationRange
                                            ));
                                        }
                                    }));
                                }));
                            }
                        }
                    }
                }

                // Component properties (declarations)
                const thisComponentproperties = thisComponent.properties.filter((prop: Property) => {
                    return prop.dataTypeComponentUri !== undefined && prop.nameRange.contains(position);
                })

                for (const [, prop] of thisComponentproperties) {
                    const propTypeComp: Component = await getComponent(prop.dataTypeComponentUri, _token);
                    if (propTypeComp) {
                        results.push(new Location(
                            propTypeComp.uri,
                            propTypeComp.declarationRange
                        ));
                    }
                }

                // Component variables
                const variablesPrefixPattern = getValidScopesPrefixPattern([Scope.Variables], false);
                if (variablesPrefixPattern.test(docPrefix)) {

                    const thisComponentvariables = thisComponent.variables.filter((variable: Variable) => {
                        return equalsIgnoreCase(variable.identifier, currentWord) && variable.dataTypeComponentUri;
                    });
                    await Promise.all(thisComponentvariables.map(async (variable: Variable) => {
                        const varTypeComp: Component = await getComponent(variable.dataTypeComponentUri, _token);
                        if (varTypeComp) {
                            results.push(new Location(
                                varTypeComp.uri,
                                varTypeComp.declarationRange
                            ));
                        }
                    }));
                }
            }
        } else if (docIsCfmFile) {
            const docVariableAssignments: Variable[] = await parseVariableAssignments(documentPositionStateContext, false, undefined, _token);
            const variableScopePrefixPattern: RegExp = getVariableScopePrefixPattern();
            const variableScopePrefixMatch: RegExpExecArray = variableScopePrefixPattern.exec(docPrefix);
            if (variableScopePrefixMatch) {
                const validScope: string = variableScopePrefixMatch[1];
                let currentScope: Scope;
                if (validScope) {
                    currentScope = Scope.valueOf(validScope);
                }

                const docVariableAssignmentsfiltered = docVariableAssignments.filter((variable: Variable) => {
                    if (!equalsIgnoreCase(variable.identifier, currentWord) || !variable.dataTypeComponentUri) {
                        return false;
                    }

                    if (currentScope) {
                        return (variable.scope === currentScope || (variable.scope === Scope.Unknown && unscopedPrecedence.includes(currentScope)));
                    }

                    return (unscopedPrecedence.includes(variable.scope) || variable.scope === Scope.Unknown);
                });

                await Promise.all(docVariableAssignmentsfiltered.map(async (variable: Variable) => {
                    const varTypeComp: Component = await getComponent(variable.dataTypeComponentUri, _token);
                    if (varTypeComp) {
                        results.push(new Location(
                            varTypeComp.uri,
                            varTypeComp.declarationRange
                        ));
                    }
                }));
            }
        }

        // User functions
        const externalUserFunc: UserFunction = await getFunctionFromPrefix(documentPositionStateContext, lowerCurrentWord, undefined, _token);
        if (externalUserFunc && externalUserFunc.returnTypeUri) {
            const returnTypeComponent: Component = await getComponent(externalUserFunc.returnTypeUri, _token);
            if (returnTypeComponent) {
                results.push(new Location(
                    returnTypeComponent.uri,
                    returnTypeComponent.declarationRange
                ));
            }
        }

        // Application variables
        const applicationVariablesPrefixPattern = getValidScopesPrefixPattern([Scope.Application, Scope.Session, Scope.Request], false);
        const variableScopePrefixMatch: RegExpExecArray = applicationVariablesPrefixPattern.exec(docPrefix);
        if (variableScopePrefixMatch) {
            const currentScope: string = Scope.valueOf(variableScopePrefixMatch[1]);

            const applicationDocVariables: Variable[] = await getApplicationVariables(document.uri);
            const applicationDocVariablesfiltered = applicationDocVariables.filter((variable: Variable) => {
                return variable.scope === currentScope && equalsIgnoreCase(variable.identifier, currentWord) && variable.dataTypeComponentUri;
            });

            await Promise.all(applicationDocVariablesfiltered.map(async (variable: Variable) => {
                const varTypeComp: Component = await getComponent(variable.dataTypeComponentUri, _token);
                if (varTypeComp) {
                    results.push(new Location(
                        varTypeComp.uri,
                        varTypeComp.declarationRange
                    ));
                }
            }));
        }

        // Server variables
        const serverVariablesPrefixPattern = getValidScopesPrefixPattern([Scope.Server], false);
        if (serverVariablesPrefixPattern.test(docPrefix)) {
            const serverDocVariables: Variable[] = getServerVariables(document.uri, _token);
            const serverDocVariablesfiltered = serverDocVariables.filter((variable: Variable) => {
                return variable.scope === Scope.Server && equalsIgnoreCase(variable.identifier, currentWord) && variable.dataTypeComponentUri;
            });

            await Promise.all(serverDocVariablesfiltered.map(async (variable: Variable) => {
                const varTypeComp: Component = await getComponent(variable.dataTypeComponentUri, _token);
                if (varTypeComp) {
                    results.push(new Location(
                        varTypeComp.uri,
                        varTypeComp.declarationRange
                    ));
                }
            }));
        }

        return results;
    }
}
