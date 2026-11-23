import { DataType } from "./dataType";
import { Signature, constructSignatureLabelParamsPart, constructSignatureLabelParamsPrefix } from "./signature";
import { Argument, UserFunction } from "./userFunction";
import { DocumentStateContext } from "../utils/documentUtil";
import { Range, TextDocument, Position, CancellationToken } from "vscode";
import { getNextCharacterPosition } from "../utils/contextUtil";
import { getParameterName, Parameter } from "./parameter";
import { COMPONENT_EXT } from "./component";
import { uriBaseName } from "../utils/fileUtil";

const functionSuffixPattern: RegExp = /^\s*\(([^)]*)/;

export interface Function {
	name: string;
	description: string;
	returntype: DataType;
	returnDescription?: string;
	signatures: Signature[];
}

/**
 * Shows the function description and any documented return value.
 * @param func The documented function.
 * @param description The description for the selected signature.
 * @returns The Markdown documentation.
 */
export function getFunctionDocumentation(func: Function, description = func.description): string {
	return func.returnDescription
		? [description, "**Returns** " + func.returnDescription].filter(Boolean).join("\n\n")
		: description;
}

/**
 * Uses the published call order when a single signature can be matched to its documentation.
 * @param parameters The structured signature parameters.
 * @param syntax The published invocation example, if available.
 * @returns Parameters in the documented call order.
 */
function parametersInCallOrder(parameters: Parameter[], syntax: string | undefined): Parameter[] {
	const args = syntax?.match(/^[\w$]+\s*\(([^()]*)\)$/)?.[1];
	if (!args) {
		return parameters;
	}
	const names = args.split(",").map(arg => arg.replaceAll(/[[\]]/g, "").trim().split(/\s+/).at(-1)?.toLowerCase());
	const byName = new Map(parameters.map(param => [getParameterName(param).toLowerCase(), param]));
	if (names.length !== parameters.length || new Set(names).size !== names.length) {
		return parameters;
	}
	const ordered = names.map(name => name && byName.get(name));
	return ordered.every((param): param is Parameter => !!param) ? ordered : parameters;
}

/**
 * Renders function signatures as CFScript declaration previews.
 * @param func The function to display.
 * @param syntax The published invocation for a built-in function, when available.
 * @returns The declaration previews.
 */
export function functionHoverSyntax(func: Function, syntax?: string): string {
	const declaredReturnType = (func as UserFunction).returnTypeName;
	const returnType = declaredReturnType ?? getReturnTypeString(func);
	const signatures = func.signatures.length ? func.signatures : [{ parameters: [] }];
	return signatures.map((signature) => {
		const parameters = signatures.length === 1 ? parametersInCallOrder(signature.parameters, syntax) : signature.parameters;
		const signatureArgs = parameters.map((param) => {
			const uri = (param as Argument).dataTypeComponentUri;
			const qualifiedType = param.type && /^[\w$]+(?:\.[\w$]+)+$/.test(param.type) ? param.type : undefined;
			const type = qualifiedType ?? (uri ? uriBaseName(uri, COMPONENT_EXT) : param.dataType || param.type || DataType.Any);
			return (param.required ? "required " : "") + type + " " + getParameterName(param);
		}).join(", ");
		return returnType + " function " + func.name + "(" + signatureArgs + ")";
	}).join("\n");
}

export enum MemberType {
	Array = "array",
	Date = "date",
	Image = "image",
	List = "list",
	Query = "query",
	String = "string",
	Struct = "struct",
	Spreadsheet = "spreadsheet",
	XML = "xml",
}

/**
 * Constructs a string showing a function invocation sample
 * @param func The function for which the syntax string will be constructed
 * @param signatureIndex The index of the signature to use
 * @returns
 */
export function constructSyntaxString(func: Function, signatureIndex: number = 0): string {
	const funcSignatureParamsLabel = func.signatures.length !== 0 ? constructSignatureLabelParamsPart(func.signatures[signatureIndex].parameters) : "";
	const returnType: string = getReturnTypeString(func);

	return `${constructSignatureLabelParamsPrefix(func)}(${funcSignatureParamsLabel}): ${returnType}`;
}

/**
 * Gets a regular expression that matches after the function identifier and captures the parameter contents
 * @returns
 */
export function getFunctionSuffixPattern(): RegExp {
	return functionSuffixPattern;
}

/**
 * Gets a display string for the given function's return type
 * @param func The function for which to get the display return type
 * @returns
 */
export function getReturnTypeString(func: Function): string {
	let returnType: string | undefined;
	if ("returnTypeUri" in func) {
		const userFunction: UserFunction = func as UserFunction;
		if (userFunction.returnTypeUri) {
			returnType = uriBaseName(userFunction.returnTypeUri, COMPONENT_EXT);
		}
	}

	if (!returnType) {
		returnType = func.returntype ? func.returntype : DataType.Any;
	}

	return returnType;
}

/**
 * Gets the ranges for each argument given the range for all of the arguments
 * @param documentStateContext The context information for the TextDocument containing function arguments
 * @param argsRange The full range for a set of arguments
 * @param separatorChar The character that separates function arguments
 * @param _token
 * @returns
 */
export function getScriptFunctionArgRanges(documentStateContext: DocumentStateContext, argsRange: Range, separatorChar: string = ",", _token: CancellationToken | undefined): Range[] {
	const argRanges: Range[] = [];
	const document: TextDocument = documentStateContext.document;
	const argsEndOffset: number = document.offsetAt(argsRange.end);

	let argStartPosition = argsRange.start;
	while (argStartPosition.isBeforeOrEqual(argsRange.end)) {
		const argSeparatorPos: Position = getNextCharacterPosition(documentStateContext, document.offsetAt(argStartPosition), argsEndOffset, separatorChar, false, _token);
		const argRange: Range = new Range(argStartPosition, argSeparatorPos);
		argRanges.push(argRange);
		argStartPosition = argSeparatorPos.translate(0, 1);
	}

	return argRanges;
}
