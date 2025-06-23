import { DataType } from "./dataType";
import { Scope, unscopedPrecedence } from "./scope";
import { Location, TextDocument, Range, Uri, Position, CancellationToken } from "vscode";
import { getCfScriptRanges, isCfcFile, getClosingPosition } from "../utils/contextUtil";
import { COMPONENT_EXT, Component, getApplicationUri, getServerUri } from "./component";
import { UserFunction, UserFunctionSignature, Argument, getLocalVariables, UserFunctionVariable, parseScriptFunctionArgs, functionValuePattern, isUserFunctionVariable } from "./userFunction";
import { getCachedApplicationVariables, getCachedServerVariables, getComponent } from "../features/cachedEntities";
import { equalsIgnoreCase } from "../utils/textUtil";
import { MyMap, MySet } from "../utils/collections";
import { parseAttributes, Attributes } from "./attribute";
import { getTagPattern, OutputVariableTags, VariableAttribute, parseTags, Tag, getCfStartTagPattern, getCfScriptTagPatternIgnoreBody, parseStartTags, StartTag } from "./tag";
import { Properties, Property } from "./property";
import { getSelectColumnsFromQueryText, Query, QueryColumns, queryValuePattern } from "./query";
import { DocumentStateContext, DocumentPositionStateContext } from "../utils/documentUtil";
import { getScriptFunctionArgRanges } from "./function";
import { constructParameterLabel } from "./parameter";
import { uriBaseName } from "../utils/fileUtil";

// FIXME: Erroneously matches implicit struct key assignments using = since '{' can also open a code block. Also matches within string or comment.
const cfscriptVariableAssignmentPattern = /(((?:^|[;{}]|\bfor\s*\(|\bcase\s+.+?:|\bdefault\s*:|\bfinal)\s*(\bvar\s+)?(?:(application|arguments|attributes|caller|cffile|cgi|client|cookie|flash|form|local|request|server|session|static|this|thistag|thread|url|variables)\s*(?:\?\.|\.\s*|::\s*|\[\s*(['"])))?)([a-zA-Z_$][$\w]*)\5\s*\]?(?:\s*(?:\?\.|\.\s*|::\s*|\[\s*(['"])?)[$\w]+\7(?:\s*\])?)*\s*=\s*)([^=][^;]*)/gi;
const forInVariableAssignmentPattern = /((?:\bfor\s*\()\s*(\bvar\s+)?(?:(application|arguments|attributes|caller|cffile|cgi|client|cookie|flash|form|local|request|server|session|static|this|thistag|thread|url|variables)\s*(?:\?\.|\.\s*|::\s*|\[\s*(['"])))?)([a-zA-Z_$][$\w]*)\4\s*\]?(?:\s*(?:\?\.|\.\s*|::\s*|\[\s*(['"])?)[$\w]+\6(?:\s*\])?)*(?:\s+in\s+)/gi;
const tagVariableAssignmentPattern = /((<cfset\s+(?:final\s+)?(var\s+)?(?:(application|arguments|attributes|caller|cffile|cgi|client|cookie|flash|form|local|request|server|session|static|this|thistag|thread|url|variables)\s*(?:\?\.|\.\s*|::\s*|\[\s*(['"])))?)([a-zA-Z_$][$\w]*)\5\s*\]?(?:\s*(?:\?\.|\.\s*|::\s*|\[\s*(['"])?)[$\w]+\7(?:\s*\])?)*\s*=\s*)([^=][^>]*)/gi;
const tagParamPattern = getTagPattern("cfparam");
const scriptParamPattern = /\b(cfparam\s*\(\s*|param\s+)([^;]*);/gi;
// Does not match when a function is part of the expression
const variableExpressionPattern = /\b((application|arguments|attributes|caller|cffile|cgi|client|cookie|flash|form|local|request|server|session|static|this|thistag|thread|url|variables)\s*(?:\?\.|\.\s*|::\s*|\[\s*(['"])))?([a-zA-Z_$][$\w]*)\3\s*\]?(?:\s*(?:\?\.|\.\s*|::\s*|\[\s*(['"])?)[$\w]+\5(?:\s*\])?)*/i;
const variableExpressionPrefixPattern = /\b((application|arguments|attributes|caller|cffile|cgi|client|cookie|flash|form|local|request|server|session|static|this|thistag|thread|url|variables)\s*(?:\?\.|\.\s*|::\s*|\[\s*(['"])))?([a-zA-Z_$][$\w]*)\3\s*\]?(?:\s*(?:\?\.|\.\s*|::\s*|\[\s*(['"])?)[$\w]+\5(?:\s*\])?)*\s*(?:\?\.|\.\s*|::\s*|\[\s*['"]?)$/i;
const variableCallExpressionPrefixPattern = /[^\s](?:\s*\)\s*\.\s*)$/i;

// TODO: Import outputVariableTags from tag.ts when bug is found/resolved

// const outputVariableTags: OutputVariableTags = getOutputVariableTags();
const outputVariableTags: OutputVariableTags = {
	cfchart: [
		{
			attributeName: "name",
			dataType: DataType.Binary,
		},
	],
	cfcollection: [
		{
			attributeName: "name",
			dataType: DataType.Query,
		},
	],
	cfdbinfo: [
		{
			attributeName: "name",
			dataType: DataType.Any,
		},
	],
	cfdirectory: [
		{
			attributeName: "name",
			dataType: DataType.Query,
		},
	],
	cfdocument: [
		{
			attributeName: "name",
			dataType: DataType.Binary,
		},
	],
	cfexecute: [
		{
			attributeName: "variable",
			dataType: DataType.String,
		},
	],
	cffeed: [
		{
			attributeName: "name",
			dataType: DataType.Struct,
		},
		{
			attributeName: "query",
			dataType: DataType.Query,
		},
	],
	cffile: [
		{
			attributeName: "result",
			dataType: DataType.Struct,
		},
		{
			attributeName: "variable",
			dataType: DataType.Any,
		},
	],
	cfftp: [
		{
			attributeName: "name",
			dataType: DataType.Query,
		},
		{
			attributeName: "result",
			dataType: DataType.Struct,
		},
	],
	cfhtmltopdf: [
		{
			attributeName: "name",
			dataType: DataType.Binary,
		},
	],
	cfhttp: [
		{
			attributeName: "name",
			dataType: DataType.Query,
		},
		{
			attributeName: "result",
			dataType: DataType.Struct,
		},
	],
	cfimage: [
		{
			attributeName: "name",
			dataType: DataType.Any,
		},
		{
			attributeName: "structName",
			dataType: DataType.Struct,
		},
	],
	cfimap: [
		{
			attributeName: "name",
			dataType: DataType.Query,
		},
	],
	// cfinvoke dataType could be taken from function return type
	cfinvoke: [
		{
			attributeName: "returnvariable",
			dataType: DataType.Any,
		},
	],
	cfldap: [
		{
			attributeName: "name",
			dataType: DataType.Query,
		},
	],
	// cfloop dataTypes are conditional
	cfloop: [
		{
			attributeName: "index",
			dataType: DataType.Any,
		},
		{
			attributeName: "item",
			dataType: DataType.Any,
		},
	],
	cfntauthenticate: [
		{
			attributeName: "result",
			dataType: DataType.Any,
		},
	],
	// cfobject excluded and handled elsewhere
	// cfparam excluded and handled elsewhere
	cfpdf: [
		{
			attributeName: "name",
			dataType: DataType.Binary,
		},
	],
	cfpop: [
		{
			attributeName: "name",
			dataType: DataType.Query,
		},
	],
	cfprocparam: [
		{
			attributeName: "variable",
			dataType: DataType.Any,
		},
	],
	cfprocresult: [
		{
			attributeName: "name",
			dataType: DataType.Query,
		},
	],
	// cfproperty excluded and handled elsewhere
	cfquery: [
		{
			attributeName: "name",
			dataType: DataType.Query,
		},
		{
			attributeName: "result",
			dataType: DataType.Struct,
		},
	],
	cfregistry: [
		{
			attributeName: "name",
			dataType: DataType.Query,
		},
		{
			attributeName: "variable",
			dataType: DataType.Any,
		},
	],
	cfreport: [
		{
			attributeName: "name",
			dataType: DataType.Any,
		},
	],
	cfsavecontent: [
		{
			attributeName: "variable",
			dataType: DataType.String,
		},
	],
	cfsearch: [
		{
			attributeName: "name",
			dataType: DataType.Query,
		},
	],
	cfsharepoint: [
		{
			attributeName: "name",
			dataType: DataType.Any,
		},
	],
	cfspreadsheet: [
		{
			attributeName: "name",
			dataType: DataType.Any,
		},
		{
			attributeName: "query",
			dataType: DataType.Query,
		},
	],
	cfstoredproc: [
		{
			attributeName: "result",
			dataType: DataType.Struct,
		},
	],
	cfwddx: [
		{
			attributeName: "output",
			dataType: DataType.Any,
		},
	],
	cfxml: [
		{
			attributeName: "variable",
			dataType: DataType.XML,
		},
	],
	cfzip: [
		{
			attributeName: "name",
			dataType: DataType.Query,
		},
		{
			attributeName: "variable",
			dataType: DataType.Any,
		},
	],
};

/**
 * Checks whether the given identifier uses the constant naming convention
 * @param ident The identifier to test
 * @returns
 */
export function usesConstantConvention(ident: string): boolean {
	return ident === ident.toUpperCase();
}

/**
 * Returns a regular expression that matches when prefixed by a specified unscoped variable accessing a property
 * @param variableName The name of a variable
 * @returns
 */
export function getVariablePrefixPattern(variableName: string) {
	const pattern: string = `(?:^|[^.\\s])\\s*(?:\\b${variableName}\\s*(?:\\?\\.\\s*|\\.\\s*|::\\s*|\\[\\s*['"]))$`;

	return new RegExp(pattern, "i");
}

/**
 * Returns a regular expression that matches a variable (or similar) and captures its parts
 * 1. variable prefix
 * 2. variable scope
 * 3. quote
 * 4. variable name
 * @returns
 */
export function getVariableExpressionPrefixPattern() {
	return variableExpressionPrefixPattern;
}

/**
 *
 * @returns
 */
export function getVariableCallExpressionPrefixPattern() {
	return variableCallExpressionPrefixPattern;
}

/**
 * Returns all of the variables declared
 * @param documentStateContext Contextual information for a given document's state
 * @param isScript Whether this document or range is defined entirely in CFScript
 * @param docRange Range within which to check
 * @param _token
 * @returns
 */
export async function parseVariableAssignments(documentStateContext: DocumentStateContext, isScript: boolean, docRange: Range | undefined, _token: CancellationToken | undefined): Promise<Variable[]> {
	let variables: Variable[] = [];
	const document: TextDocument = documentStateContext.document;
	const documentUri: Uri = document.uri;
	let textOffset: number = 0;
	let documentText: string = documentStateContext.sanitizedDocumentText;

	if (docRange) {
		if (document.validateRange(docRange)) {
			textOffset = document.offsetAt(docRange.start);
			documentText = documentText.slice(textOffset, document.offsetAt(docRange.end));
		}
		else {
			return variables;
		}
	}

	// Add function arguments
	if (isCfcFile(document, _token)) {
		const comp: Component | undefined = getComponent(document.uri, _token);
		if (comp) {
			comp.functions.forEach((func: UserFunction) => {
				if (!func.isImplicit && (!docRange || (func.bodyRange && func.bodyRange.contains(docRange)))) {
					if (func.signatures) {
						func.signatures.forEach((signature: UserFunctionSignature) => {
							signature.parameters.forEach((param: Argument) => {
								const argName: string = param.name;
								if (getMatchingVariables(variables, argName, Scope.Arguments).length === 0) {
									variables.push({
										identifier: argName,
										dataType: param.dataType,
										scope: Scope.Arguments,
										final: false,
										description: param.description,
										declarationLocation: new Location(
											document.uri,
											param.nameRange
										),
										initialValue: param.default,
									});
								}
							});
						});
					}
				}
			});
		}
	}

	// params
	let paramMatch: RegExpExecArray | null;
	const paramPattern: RegExp = isScript ? scriptParamPattern : tagParamPattern;
	while ((paramMatch = paramPattern.exec(documentText))) {
		const paramPrefix: string = paramMatch[1];
		const paramAttr: string = paramMatch[2];

		const paramAttributeRange = new Range(
			document.positionAt(textOffset + paramMatch.index + paramPrefix.length),
			document.positionAt(textOffset + paramMatch.index + paramPrefix.length + paramAttr.length)
		);

		const parsedAttr: Attributes = parseAttributes(document, paramAttributeRange);
		const nameAttr = parsedAttr.get("name");
		if (!parsedAttr.has("name") || !nameAttr || !nameAttr.value) {
			continue;
		}

		let paramType: DataType = DataType.Any;
		let paramTypeComponentUri: Uri | undefined;
		const typeAttr = parsedAttr.get("type");
		const defaultAttr = parsedAttr.get("default");
		if (parsedAttr.has("type") && typeAttr && !!typeAttr.value) {
			paramType = DataType.paramTypeToDataType(typeAttr.value);
		}
		else if (parsedAttr.has("default") && defaultAttr && defaultAttr.value !== undefined) {
			const [dataType, uri]: [DataType | undefined, Uri | undefined] = await DataType.inferDataTypeFromValue(defaultAttr.value, documentUri, _token);
			if (dataType && uri) {
				paramType = dataType;
				paramTypeComponentUri = uri;
			}
		}

		const paramName = nameAttr.value;
		const paramNameMatch = variableExpressionPattern.exec(paramName);
		if (!paramNameMatch) {
			continue;
		}
		const varNamePrefix: string = paramNameMatch[1];
		const varNamePrefixLen: number = varNamePrefix ? varNamePrefix.length : 0;
		const scope: string = paramNameMatch[2];
		const varName: string = paramNameMatch[4];

		let scopeVal: Scope = Scope.Unknown;
		if (scope) {
			scopeVal = Scope.valueOf(scope);
		}

		const varRangeStart = nameAttr.valueRange.start.translate(0, varNamePrefixLen);
		const varRange = new Range(
			varRangeStart,
			varRangeStart.translate(0, varName.length)
		);

		const matchingVars = getMatchingVariables(variables, varName, scopeVal);
		if (matchingVars.length > 0) {
			if (matchingVars.length > 1 || matchingVars[0].declarationLocation.range.start.isBefore(varRange.start)) {
				continue;
			}
			else {
				// Remove entry
				variables = variables.filter((variable: Variable) => {
					return variable !== matchingVars[0];
				});
			}
		}

		const initialValue: string | undefined = parsedAttr.has("default") && defaultAttr ? defaultAttr.value : undefined;

		variables.push({
			identifier: varName,
			dataType: paramType,
			dataTypeComponentUri: paramTypeComponentUri,
			scope: scopeVal,
			final: false,
			declarationLocation: new Location(
				document.uri,
				varRange
			),
			initialValue: initialValue,
		});
	}

	// variable assignments
	let variableMatch: RegExpExecArray | null;
	const variableAssignmentPattern: RegExp = isScript ? cfscriptVariableAssignmentPattern : tagVariableAssignmentPattern;
	while ((variableMatch = variableAssignmentPattern.exec(documentText))) {
		const initValuePrefix: string = variableMatch[1];
		const varPrefix: string = variableMatch[2];
		const varScope: string = variableMatch[3];
		const scope: string = variableMatch[4];
		const varName: string = variableMatch[6];
		const initValue: string = variableMatch[8];

		// TODO: Does not account for arguments being overridden.
		let scopeVal: Scope = Scope.Unknown;
		if (scope) {
			scopeVal = Scope.valueOf(scope);
		}
		else if (varScope) {
			scopeVal = Scope.Local;
		}

		const varMatchStartOffset: number = textOffset + variableMatch.index + varPrefix.length;
		const varRange = new Range(
			document.positionAt(varMatchStartOffset),
			document.positionAt(varMatchStartOffset + varName.length)
		);

		const matchingVars: Variable[] = getMatchingVariables(variables, varName, scopeVal);
		if (matchingVars.length > 0) {
			if (matchingVars.length > 1 || matchingVars[0].declarationLocation.range.start.isBefore(varRange.start)) {
				continue;
			}
			else {
				// Remove entry
				variables = variables.filter((variable: Variable) => {
					return variable !== matchingVars[0];
				});
			}
		}

		if (scopeVal === Scope.Unknown) {
			scopeVal = Scope.Variables;
		}
		const [dataType, dataTypeComponentUri]: [DataType | undefined, Uri | undefined] = await DataType.inferDataTypeFromValue(initValue, documentUri, _token);

		let thisVar: Variable | undefined = dataType
			? {
					identifier: varName,
					dataType: dataType,
					dataTypeComponentUri: dataTypeComponentUri,
					scope: scopeVal,
					final: false,
					declarationLocation: new Location(
						document.uri,
						varRange
					),
				}
			: undefined;

		if (dataType === DataType.Query) {
			const valueMatch = queryValuePattern.exec(initValue);
			if (valueMatch) {
				const fullValueMatch: string = valueMatch[0];
				const functionName: string = valueMatch[1];

				const initValueOffset = textOffset + variableMatch.index + initValuePrefix.length;
				const paramsStartOffset: number = initValueOffset + valueMatch.index + fullValueMatch.length;
				const paramsEndOffset: number = initValueOffset + initValue.length - 1;
				const paramsRange = new Range(document.positionAt(paramsStartOffset), document.positionAt(paramsEndOffset));
				const paramRanges: Range[] = getScriptFunctionArgRanges(documentStateContext, paramsRange, ";", _token);
				if (paramRanges.length > 0) {
					const firstParamText: string = document.getText(paramRanges[0]);

					// TODO: If not string literal, but string variable, retrieve string value from variable. Account for using named param.
					if (DataType.isStringLiteral(firstParamText)) {
						const firstParamVal: string = DataType.getStringLiteralValue(firstParamText);
						let columns: QueryColumns;
						if (equalsIgnoreCase(functionName, "queryNew")) {
							columns = new MySet(firstParamVal.split(","));
						}
						else {
							columns = getSelectColumnsFromQueryText(firstParamVal);
						}
						if (columns.size > 0) {
							const query: Query | undefined = thisVar as Query;
							if (query) {
								query.selectColumnNames = columns;
								thisVar = query;
							}
						}
					}
				}
			}
		}
		else if (dataType === DataType.Function) {
			const userFunction: UserFunctionVariable | undefined = thisVar as UserFunctionVariable;

			const valueMatch = functionValuePattern.exec(initValue);
			if (valueMatch) {
				const fullValueMatch: string = valueMatch[0];

				const initValueOffset = textOffset + variableMatch.index + initValuePrefix.length;
				const paramsStartOffset: number = initValueOffset + valueMatch.index + fullValueMatch.length;
				const paramsEndPosition: Position = getClosingPosition(documentStateContext, paramsStartOffset, ")", _token);
				const paramsRange = new Range(
					document.positionAt(paramsStartOffset),
					paramsEndPosition.translate(0, -1)
				);

				if (userFunction) {
					userFunction.signature = {
						parameters: await parseScriptFunctionArgs(documentStateContext, paramsRange, [], _token),
					};
					thisVar = userFunction;
				}
			}
		}

		if (thisVar) {
			thisVar.initialValue = initValue;
			variables.push(thisVar);
		}
	}

	if (!isScript || documentStateContext.cfmlEngine.supportsScriptTags()) {
		// Tags with output attributes
		const foundOutputVarTags: MySet<string> = new MySet();
		let cfTagMatch: RegExpExecArray | null;
		const cfTagPattern: RegExp = isScript ? getCfScriptTagPatternIgnoreBody() : getCfStartTagPattern();
		while ((cfTagMatch = cfTagPattern.exec(documentText))) {
			const tagName = cfTagMatch[2].toLowerCase();
			if (!foundOutputVarTags.has(tagName) && Object.prototype.hasOwnProperty.call(outputVariableTags, tagName)) {
				foundOutputVarTags.add(tagName);
			}
		}

		foundOutputVarTags.forEach((tagName: string) => {
			const tagOutputAttributes: VariableAttribute[] = outputVariableTags[tagName];

			const parsedOutputVariableTags: StartTag[] = (tagName === "cfquery" ? parseTags(documentStateContext, tagName, docRange, _token) : parseStartTags(documentStateContext, tagName, isScript, docRange, _token));
			parsedOutputVariableTags.forEach((tag: StartTag) => {
				const tagAttributes: Attributes = tag.attributes;
				tagOutputAttributes.filter((tagOutputAttribute: VariableAttribute) => {
					return tagAttributes.has(tagOutputAttribute.attributeName);
				}).forEach((tagOutputAttribute: VariableAttribute) => {
					const attributeName: string = tagOutputAttribute.attributeName;
					const tagAttr = tagAttributes.get(attributeName);
					const attributeVal: string | undefined = tagAttr ? tagAttr.value : undefined;
					if (!tagAttr || !attributeVal) {
						return;
					}
					const varExpressionMatch: RegExpExecArray | null = variableExpressionPattern.exec(attributeVal);
					if (!varExpressionMatch) {
						return;
					}
					const varNamePrefix: string = varExpressionMatch[1];
					const varNamePrefixLen: number = varNamePrefix ? varNamePrefix.length : 0;
					const scope: string = varExpressionMatch[2];
					const varName: string = varExpressionMatch[4];

					let scopeVal: Scope = Scope.Unknown;
					if (scope) {
						scopeVal = Scope.valueOf(scope);
					}

					const varRangeStart: Position = tagAttr.valueRange.start.translate(0, varNamePrefixLen);
					const varRange = new Range(
						varRangeStart,
						varRangeStart.translate(0, varName.length)
					);

					const matchingVars: Variable[] = getMatchingVariables(variables, varName, scopeVal);
					if (matchingVars.length > 0) {
						if (matchingVars.length > 1 || matchingVars[0].declarationLocation.range.start.isBefore(varRange.start)) {
							return;
						}
						else {
							// Remove entry
							variables = variables.filter((variable: Variable) => {
								return variable !== matchingVars[0];
							});
						}
					}

					if (scopeVal === Scope.Unknown) {
						scopeVal = Scope.Variables;
					}

					let outputVar: Variable = {
						identifier: varName,
						dataType: tagOutputAttribute.dataType,
						scope: scopeVal,
						final: false,
						declarationLocation: new Location(
							document.uri,
							varRange
						),
					};

					if (tagName === "cfquery" && "bodyRange" in tag) {
						const queryTag = tag as Tag;
						const bodyText: string = document.getText(queryTag.bodyRange);
						const columns: QueryColumns = getSelectColumnsFromQueryText(bodyText);

						if (columns.size > 0) {
							const query: Query | undefined = outputVar as Query;
							if (query) {
								query.selectColumnNames = columns;
								outputVar = query;
							}
						}
					}

					variables.push(outputVar);
				});
			});
		});
	}

	if (!isScript) {
		// Check cfscript sections
		const cfScriptRanges: Range[] = getCfScriptRanges(document, docRange, _token);
		for (const range of cfScriptRanges) {
			const cfscriptVars: Variable[] = await parseVariableAssignments(documentStateContext, true, range, _token);

			cfscriptVars.forEach((scriptVar: Variable) => {
				const matchingVars: Variable[] = getMatchingVariables(variables, scriptVar.identifier, scriptVar.scope);
				if (matchingVars.length === 0) {
					variables.push(scriptVar);
				}
				else if (matchingVars.length === 1 && scriptVar.declarationLocation.range.start.isBefore(matchingVars[0].declarationLocation.range.start)) {
					// Replace entry
					const matchingIndex: number = variables.findIndex((value: Variable) => {
						return value.scope === scriptVar.scope && equalsIgnoreCase(value.identifier, scriptVar.identifier);
					});
					if (matchingIndex !== -1) {
						variables[matchingIndex] = scriptVar;
					}
				}
			});
		}
	}
	else {
		// Check for-in loops
		let forInVariableMatch: RegExpExecArray | null;
		while ((forInVariableMatch = forInVariableAssignmentPattern.exec(documentText))) {
			const varPrefix: string = forInVariableMatch[1];
			const varScope: string = forInVariableMatch[2];
			const scope: string = forInVariableMatch[3];
			const varName: string = forInVariableMatch[5];

			let scopeVal: Scope = Scope.Unknown;
			if (scope) {
				scopeVal = Scope.valueOf(scope);
			}
			else if (varScope) {
				scopeVal = Scope.Local;
			}

			const varMatchStartOffset = textOffset + forInVariableMatch.index + varPrefix.length;
			const varRange = new Range(
				document.positionAt(varMatchStartOffset),
				document.positionAt(varMatchStartOffset + varName.length)
			);

			const matchingVars = getMatchingVariables(variables, varName, scopeVal);
			if (matchingVars.length > 0) {
				if (matchingVars.length > 1 || matchingVars[0].declarationLocation.range.start.isBefore(varRange.start)) {
					continue;
				}
				else {
					// Remove entry
					variables = variables.filter((variable: Variable) => {
						return variable !== matchingVars[0];
					});
				}
			}

			if (scopeVal === Scope.Unknown) {
				scopeVal = Scope.Variables;
			}

			variables.push({
				identifier: varName,
				dataType: DataType.Any,
				scope: scopeVal,
				final: false,
				declarationLocation: new Location(
					document.uri,
					varRange
				),
			});
		}
	}

	return variables;
}

/**
 * Returns Variable array representation of Properties
 * @param properties The properties of a component to convert
 * @param documentUri The URI of the document in which these properties are declared
 * @returns
 */
export function propertiesToVariables(properties: Properties, documentUri: Uri): Variable[] {
	const propertyVars: Variable[] = [];
	properties.forEach((prop: Property) => {
		propertyVars.push({
			identifier: prop.name,
			dataType: prop.dataType,
			dataTypeComponentUri: prop.dataTypeComponentUri,
			scope: Scope.Variables,
			final: false,
			declarationLocation: new Location(documentUri, prop.propertyRange),
			description: prop.description,
		});
	});

	return propertyVars;
}

/**
 * Returns Variable array representation of Arguments
 * @param args The arguments of a function to convert
 * @param documentUri The URI of the document in which these arguments are declared
 * @returns
 */
export function argumentsToVariables(args: Argument[], documentUri: Uri): Variable[] {
	return args.map((arg: Argument) => {
		const argVar: Variable = {
			identifier: arg.name,
			dataType: arg.dataType,
			dataTypeComponentUri: arg.dataTypeComponentUri,
			scope: Scope.Arguments,
			final: false,
			declarationLocation: new Location(documentUri, arg.nameRange),
			description: arg.description,
		};

		return argVar;
	});
}

/**
 * Returns the variable that best matches the given name and scope
 * @param variables The variables to check
 * @param varName The variable name for which to check
 * @param varScope The variable's scope
 * @returns
 */
export function getBestMatchingVariable(variables: Variable[], varName: string, varScope?: Scope): Variable | undefined {
	let foundVar: Variable | undefined;

	if (varScope) {
		foundVar = variables.find((currentVar: Variable) => {
			return currentVar.scope === varScope && equalsIgnoreCase(currentVar.identifier, varName);
		});

		if (!foundVar && unscopedPrecedence.includes(varScope)) {
			foundVar = variables.find((currentVar: Variable) => {
				return currentVar.scope === Scope.Unknown && equalsIgnoreCase(currentVar.identifier, varName);
			});
		}
	}
	else {
		for (const checkScope of unscopedPrecedence) {
			foundVar = variables.find((currentVar: Variable) => {
				return currentVar.scope === checkScope && equalsIgnoreCase(currentVar.identifier, varName);
			});
			if (foundVar) {
				return foundVar;
			}
		}

		foundVar = variables.find((currentVar: Variable) => {
			return currentVar.scope === Scope.Unknown && equalsIgnoreCase(currentVar.identifier, varName);
		});
	}

	return foundVar;
}

/**
 * Returns the variables that match the given name and scope
 * @param variables The variables to check
 * @param varName The variable name for which to check
 * @param scope The variable's scope
 * @returns
 */
export function getMatchingVariables(variables: Variable[], varName: string, scope = Scope.Unknown): Variable[] {
	let checkScopes: Scope[];
	if (scope === Scope.Unknown) {
		checkScopes = [Scope.Local, Scope.Arguments, Scope.Variables, Scope.Unknown];
	}
	else {
		checkScopes = [scope];
	}

	return variables.filter((variable: Variable) => {
		return checkScopes.includes(variable.scope) && equalsIgnoreCase(variable.identifier, varName);
	});
}

/**
 * Gets the application variables for the given document
 * @param baseUri The URI of the document for which the Application file will be found
 * @returns
 */
export async function getApplicationVariables(baseUri: Uri): Promise<Variable[]> {
	let applicationVariables: Variable[] = [];
	const applicationUri: Uri | undefined = await getApplicationUri(baseUri);
	if (applicationUri) {
		const cachedApplicationVariables: Variable[] | undefined = getCachedApplicationVariables(applicationUri);
		if (cachedApplicationVariables) {
			applicationVariables = cachedApplicationVariables;
		}
	}

	return applicationVariables;
}

/**
 * Gets the server variables
 * @param baseUri The URI of the document for which the Server file will be found
 * @param _token
 * @returns
 */
export function getServerVariables(baseUri: Uri, _token: CancellationToken | undefined): Variable[] {
	let serverVariables: Variable[] = [];

	const serverUri: Uri | undefined = getServerUri(baseUri, _token);
	if (serverUri) {
		serverVariables = getCachedServerVariables(serverUri) || [];
	}

	return serverVariables;
}

/**
 * Collects all variable assignments accessible based on the given documentPositionStateContext
 * @param documentPositionStateContext The contextual information of the state of a document and the cursor position
 * @param _token
 * @returns
 */
export async function collectDocumentVariableAssignments(documentPositionStateContext: DocumentPositionStateContext, _token: CancellationToken | undefined): Promise<Variable[]> {
	let allVariableAssignments: Variable[] = [];

	if (documentPositionStateContext.isCfmFile) {
		const docVariableAssignments: Variable[] = await parseVariableAssignments(documentPositionStateContext, false, undefined, _token);
		allVariableAssignments = allVariableAssignments.concat(docVariableAssignments);
	}
	else if (documentPositionStateContext.isCfcFile) {
		const thisComponent = documentPositionStateContext.component;
		if (thisComponent) {
			const documentUri: Uri = documentPositionStateContext.document.uri;

			// properties
			const componentProperties: Properties = thisComponent.properties;
			allVariableAssignments = allVariableAssignments.concat(propertiesToVariables(componentProperties, documentUri));

			// component variables
			let currComponent: Component | undefined = thisComponent;
			let componentVariables: Variable[] = [];
			while (currComponent) {
				const currComponentVariables: Variable[] = currComponent.variables.filter((variable: Variable) => {
					return !componentVariables.some((existingVariable: Variable) => {
						return existingVariable.scope === variable.scope && equalsIgnoreCase(existingVariable.identifier, variable.identifier);
					});
				});
				componentVariables = componentVariables.concat(currComponentVariables);

				// Also check in init function
				const initMethod: string = currComponent.initmethod ? currComponent.initmethod.toLowerCase() : "init";
				if (currComponent.functions.has(initMethod)) {
					const currInitFunc: UserFunction | undefined = currComponent.functions.get(initMethod);

					if (currInitFunc && currInitFunc.bodyRange) {
						const currInitVariables: Variable[] = (await parseVariableAssignments(documentPositionStateContext, currComponent.isScript, currInitFunc.bodyRange, _token)).filter((variable: Variable) => {
							return [Scope.Variables, Scope.This].includes(variable.scope) && !componentVariables.some((existingVariable: Variable) => {
								return existingVariable.scope === variable.scope && equalsIgnoreCase(existingVariable.identifier, variable.identifier);
							});
						});
						componentVariables = componentVariables.concat(currInitVariables);
					}
				}

				allVariableAssignments = allVariableAssignments.concat(componentVariables);

				if (currComponent.extends) {
					currComponent = getComponent(currComponent.extends, _token);
				}
				else {
					currComponent = undefined;
				}
			}

			// function arguments
			let functionArgs: Argument[] = [];
			thisComponent.functions.filter((func: UserFunction) => {
				return func.bodyRange && func.bodyRange.contains(documentPositionStateContext.position) && func.signatures && func.signatures.length !== 0 ? true : false; ;
			}).forEach((func: UserFunction) => {
				func.signatures.forEach((signature: UserFunctionSignature) => {
					functionArgs = signature.parameters;
				});
			});
			allVariableAssignments = allVariableAssignments.concat(argumentsToVariables(functionArgs, documentUri));

			// function local variables
			let localVariables: Variable[] = [];
			const filteredFunctions = thisComponent.functions.filter((func: UserFunction) => {
				return (func.bodyRange && func.bodyRange.contains(documentPositionStateContext.position)) ? true : false;
			});

			for (const [, func] of filteredFunctions) {
				const tmp = await getLocalVariables(func, documentPositionStateContext, thisComponent.isScript, _token);
				localVariables = localVariables.concat(tmp);
			}
			allVariableAssignments = allVariableAssignments.concat(localVariables);
		}
	}

	return allVariableAssignments;
}

/**
 * Creates a type string for the given variable
 * @param variable A variable for which to get the type
 * @returns
 */
export function getVariableTypeString(variable: Variable): string {
	let varType: string = variable.dataType;
	if (variable.dataTypeComponentUri) {
		varType = uriBaseName(variable.dataTypeComponentUri, COMPONENT_EXT);
	}
	else if (variable.dataType === DataType.Function) {
		let argString: string = "...";
		if (isUserFunctionVariable(variable)) {
			argString = variable.signature.parameters.map(constructParameterLabel).join(", ");
		}
		varType = `function(${argString})`;
	}

	return varType;
}

// TODO: Add identifierRange and have declarationLocation contain full declaration range
export interface Variable {
	identifier: string;
	dataType: DataType;
	dataTypeComponentUri?: Uri; // Only when dataType is Component
	scope: Scope;
	final: boolean;
	declarationLocation: Location;
	description?: string;
	initialValue?: string;
}

export class VariablesByScope extends MyMap<Scope, Variable[]> { }

export class VariablesByUri extends MyMap<string, Variable[]> { } // key is Uri.toString()

export interface Struct extends Variable {
	keys: StructKeys;
}

export class StructKeys extends MySet<Variable> { }
