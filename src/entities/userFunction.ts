import { DataType } from "./dataType";
import { Location, Uri, TextDocument, Position, Range, CancellationToken } from "vscode";
import { Function, getScriptFunctionArgRanges } from "./function";
import { Parameter } from "./parameter";
import { Signature } from "./signature";
import { Component, isSubcomponentOrEqual } from "./component";
import { Variable, parseVariableAssignments, collectDocumentVariableAssignments, getApplicationVariables, getBestMatchingVariable, getVariableExpressionPrefixPattern, getVariableCallExpressionPrefixPattern } from "./variable";
import { Scope } from "./scope";
import { DocBlockKeyValue, parseDocBlock, getKeyPattern } from "./docblock";
import { Attributes, Attribute, parseAttributes } from "./attribute";
import { equalsIgnoreCase } from "../utils/textUtil";
import { MyMap, MySet } from "../utils/collections";
import { getComponent, hasComponent } from "../features/cachedEntities";
import { parseTags, Tag } from "./tag";
import { DocumentStateContext, DocumentPositionStateContext } from "../utils/documentUtil";
import { getClosingPosition, getNextCharacterPosition, isInRanges, getCfScriptRanges } from "../utils/contextUtil";
import { Utils } from "vscode-uri";
import { uriBaseName } from "../utils/fileUtil";

const scriptFunctionPattern: RegExp = /((\/\*\*((?:\*(?!\/)|[^*])*)\*\/\s+)?(?:\b(private|package|public|remote|static|final|abstract|default)\s+)?(?:\b(private|package|public|remote|static|final|abstract|default)\s+)?)(?:\b([A-Za-z0-9_.$]+)\s+)?function\s+([_$a-zA-Z][$\w]*)\s*\(/gi;
const scriptFunctionArgPattern: RegExp = /((?:(required)\s+)?(?:\b([\w.]+)\b\s+)?(\b[_$a-zA-Z][$\w]*\b)(?:\s*=\s*(\{[^}]*\}|\[[^\]]*\]|\([^)]*\)|(?:(?!\b\w+\s*=).)+))?)(.*)?/i;
export const functionValuePattern: RegExp = /^function\s*\(/i;
export const normalizeSplit: RegExp = /(::|\?\.)/g;

/*
const userFunctionAttributeNames: MySet<string> = new MySet([
  "name",
  "access",
  "description",
  "displayname",
  "hint",
  "output",
  "returnformat",
  "returntype",
  "roles",
  "securejson",
  "verifyclient",
  "restpath",
  "httpmethod",
  "produces",
  "consumes"
]);
*/

const userFunctionBooleanAttributes: MySet<string> = new MySet([
	"static",
	"abstract",
	"final",
]);

const accessArr: string[] = ["public", "private", "package", "remote"];

// TODO: Add pattern for arrow function

export enum Access {
	Public = "public",
	Private = "private",
	Package = "package",
	Remote = "remote",
}
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Access {
	/**
	 * Resolves a string value of access type to an enumeration member
	 * @param access The access type string to resolve
	 * @returns
	 */
	export function valueOf(access: string): Access {
		switch (access.toLowerCase()) {
			case "public":
				return Access.Public;
			case "private":
				return Access.Private;
			case "package":
				return Access.Package;
			case "remote":
				return Access.Remote;
			default:
				return Access.Public;
		}
	}
}

export interface Argument extends Parameter {
	// description is hint
	nameRange: Range;
	dataTypeRange?: Range;
	dataTypeComponentUri?: Uri; // Only when dataType is Component
}
interface ArgumentAttributes {
	name: string;
	type?: string;
	default?: string;
	displayname?: string;
	hint?: string;
	required?: string;
	restargsource?: string;
	restargname?: string;
}
/*
const argumentAttributesToInterfaceMapping = {
  type: "dataType",
  default: "default",
  hint: "description",
  required: "required"
};
*/
const argumentAttributeNames: MySet<string> = new MySet([
	"name",
	"type",
	"default",
	"displayname",
	"hint",
	"required",
	"restargsource",
	"restargname",
]);
/*
const argumentBooleanAttributes: MySet<string> = new MySet([
  "required"
]);
*/
export interface UserFunctionSignature extends Signature {
	parameters: Argument[];
}

export interface UserFunction extends Function {
	access: Access;
	static: boolean;
	abstract: boolean;
	final: boolean;
	returnTypeUri?: Uri; // Only when returntype is Component
	returnTypeRange?: Range;
	nameRange: Range;
	bodyRange?: Range;
	signatures: UserFunctionSignature[];
	location: Location;
	isImplicit: boolean;
}

export interface UserFunctionVariable extends Variable {
	signature: UserFunctionSignature;
	// returnType?
}

/**
 * Checks whether a Variable is a UserFunction
 * @param variable The variable object to check
 * @returns
 */
export function isUserFunctionVariable(variable: Variable): variable is UserFunctionVariable {
	return "signature" in variable;
}

// Collection of user functions for a particular component. Key is function name lowercased.
export class ComponentFunctions extends MyMap<string, UserFunction> { }

/*
export interface UserFunctionsByUri {
  [uri: string]: ComponentFunctions; // key is Uri.toString()
}
*/

export interface UserFunctionByUri {
	[uri: string]: UserFunction; // key is Uri.toString()
}

export interface UserFunctionsByName {
	[name: string]: UserFunctionByUri; // key is UserFunction.name lowercased
}

/**
 * Parses the CFScript function definitions and returns an array of UserFunction objects
 * @param documentStateContext The context information for a TextDocument in which to parse the CFScript functions
 * @param _token
 * @returns
 */
export async function parseScriptFunctions(documentStateContext: DocumentStateContext, _token: CancellationToken | undefined): Promise<UserFunction[]> {
	const document: TextDocument = documentStateContext.document;
	const userFunctions: UserFunction[] = [];
	const componentBody: string = documentStateContext.sanitizedDocumentText;
	let scriptFunctionMatch: RegExpExecArray | null;
	while ((scriptFunctionMatch = scriptFunctionPattern.exec(componentBody))) {
		const fullMatch: string = scriptFunctionMatch[0];
		const returnTypePrefix: string = scriptFunctionMatch[1];
		const modifier1: string = scriptFunctionMatch[4];
		const modifier2: string = scriptFunctionMatch[5];
		const returnType: string = scriptFunctionMatch[6];
		const functionName: string = scriptFunctionMatch[7];

		const functionNameStartOffset: number = scriptFunctionMatch.index + fullMatch.lastIndexOf(functionName);
		const functionNameRange: Range = new Range(
			document.positionAt(functionNameStartOffset),
			document.positionAt(functionNameStartOffset + functionName.length)
		);

		const argumentsStartOffset: number = scriptFunctionMatch.index + fullMatch.length;
		const argumentsEndPosition: Position = getClosingPosition(documentStateContext, argumentsStartOffset, ")", _token);
		const functionArgsRange: Range = new Range(
			document.positionAt(argumentsStartOffset),
			argumentsEndPosition.translate(0, -1)
		);

		let functionBodyStartPos: Position;
		let functionEndPosition: Position;
		let functionAttributeRange: Range;
		let functionBodyRange: Range | undefined;

		if ((documentStateContext.component && documentStateContext.component.isInterface && !equalsIgnoreCase(modifier1, "default") && !equalsIgnoreCase(modifier2, "default"))
			|| equalsIgnoreCase(modifier1, "abstract") || equalsIgnoreCase(modifier2, "abstract")
		) {
			functionBodyStartPos = getNextCharacterPosition(documentStateContext, document.offsetAt(argumentsEndPosition), componentBody.length - 1, ";", false, _token);
			functionEndPosition = functionBodyStartPos;
			functionAttributeRange = new Range(
				argumentsEndPosition,
				functionEndPosition
			);
		}
		else {
			functionBodyStartPos = getNextCharacterPosition(documentStateContext, document.offsetAt(argumentsEndPosition), componentBody.length - 1, "{", true, _token);
			functionEndPosition = getClosingPosition(documentStateContext, document.offsetAt(functionBodyStartPos), "}", _token);

			try {
				functionAttributeRange = new Range(
					argumentsEndPosition,
					functionBodyStartPos.translate(0, -1)
				);
			}
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			catch (ex) {
				console.warn(`Error parsing ${document.uri.fsPath}:${functionName}`);
				functionAttributeRange = new Range(
					argumentsEndPosition,
					functionBodyStartPos
				);
			}

			functionBodyRange = new Range(
				functionBodyStartPos,
				functionEndPosition.translate(0, -1)
			);
		}

		const functionRange: Range = new Range(
			document.positionAt(scriptFunctionMatch.index),
			functionEndPosition
		);

		let userFunction: UserFunction = {
			access: Access.Public,
			static: false,
			abstract: false,
			final: false,
			name: functionName,
			description: "",
			returntype: DataType.Any,
			signatures: [],
			nameRange: functionNameRange,
			bodyRange: functionBodyRange,
			location: new Location(document.uri, functionRange),
			isImplicit: false,
		};

		if (returnType) {
			const [dataType, returnTypeUri]: [DataType | undefined, Uri | undefined] = await DataType.getDataTypeAndUri(returnType, document.uri, _token);
			if (dataType) {
				userFunction.returntype = dataType;
				if (returnTypeUri) {
					userFunction.returnTypeUri = returnTypeUri;
				}
				const returnTypeOffset: number = scriptFunctionMatch.index + returnTypePrefix.length;
				userFunction.returnTypeRange = new Range(
					document.positionAt(returnTypeOffset),
					document.positionAt(returnTypeOffset + returnType.length)
				);
			}
		}

		if (modifier1) {
			const modifier1Type: string = parseModifier(modifier1);
			if (modifier1Type === "access") {
				userFunction.access = Access.valueOf(modifier1);
			}
			else {
				userFunction[modifier1Type] = true;
			}
		}

		if (modifier2) {
			const modifier2Type = parseModifier(modifier2);
			if (modifier2Type === "access") {
				userFunction.access = Access.valueOf(modifier2);
			}
			else {
				userFunction[modifier2Type] = true;
			}
		}

		const parsedAttributes: Attributes = parseAttributes(document, functionAttributeRange);
		userFunction = await assignFunctionAttributes(userFunction, parsedAttributes, _token);

		// Walk backwards to find the first comment before the function
		let precedingCommentRange: Range | undefined;
		for (let i = documentStateContext.commentRanges.length - 1; i >= 0; i--) {
			const commentRange: Range = documentStateContext.commentRanges[i];
			if (commentRange.end.isAfterOrEqual(functionRange.start)) {
				continue;
			}
			precedingCommentRange = commentRange;
			break;
		}
		// Check if we found a docblock for this function
		let fullDocBlock: string | undefined;
		let docBlockRange: Range | undefined;
		if (precedingCommentRange) {
			const commentText = document.getText(precedingCommentRange);
			// Check if the comment is a docblock
			if (commentText.startsWith("/**")) {
				// Check that the docblock is directly before the function
				const textBetween = document.getText(new Range(precedingCommentRange.end, functionRange.start));
				if (textBetween.trim().length == 0) {
					fullDocBlock = commentText;
					// Remove the leading "/**" and trailing "*/"
					docBlockRange = new Range(precedingCommentRange.start.translate(0, 3), precedingCommentRange.end.translate(0, -2));
				}
			}
		}

		let scriptDocBlockParsed: DocBlockKeyValue[] = [];
		if (fullDocBlock && docBlockRange) {
			scriptDocBlockParsed = parseDocBlock(document,
				docBlockRange
			);
			await Promise.all(scriptDocBlockParsed.map(async (docElem: DocBlockKeyValue) => {
				if (docElem.key === "access") {
					userFunction.access = Access.valueOf(docElem.value);
				}
				else if (docElem.key === "returntype") {
					const [dataType, uri]: [DataType | undefined, Uri | undefined] = await DataType.getDataTypeAndUri(docElem.value, document.uri, _token);
					if (dataType) {
						userFunction.returntype = dataType;

						const returnTypeKeyMatch: RegExpExecArray | null = getKeyPattern("returnType").exec(fullDocBlock);
						if (returnTypeKeyMatch) {
							const returnTypePath: string = returnTypeKeyMatch[1];
							if (scriptFunctionMatch) {
								const returnTypeOffset: number = scriptFunctionMatch.index + returnTypeKeyMatch.index;
								userFunction.returnTypeRange = new Range(
									document.positionAt(returnTypeOffset),
									document.positionAt(returnTypeOffset + returnTypePath.length)
								);
							}
						}
						if (uri) {
							userFunction.returnTypeUri = uri;
						}
					}
				}
				else if (userFunctionBooleanAttributes.has(docElem.key)) {
					userFunction[docElem.key] = DataType.isTruthy(docElem.value);
				}
				else if (docElem.key === "hint") {
					userFunction.description = docElem.value;
				}
				else if (docElem.key === "description" && userFunction.description === "") {
					userFunction.description = docElem.value;
				}
			}));
		}
		const signature: UserFunctionSignature = {
			parameters: await parseScriptFunctionArgs(documentStateContext, functionArgsRange, scriptDocBlockParsed, _token),
		};
		userFunction.signatures = [signature];

		userFunctions.push(userFunction);
	}

	return userFunctions;
}

/**
 * Parses the given arguments into an array of Argument objects that is returned
 * @param documentStateContext The context information for a TextDocument possibly containing function arguments
 * @param argsRange A range within the given document that contains the CFScript arguments
 * @param docBlock The parsed documentation block for the function to which these arguments belong
 * @param _token
 * @returns
 */
export async function parseScriptFunctionArgs(documentStateContext: DocumentStateContext, argsRange: Range, docBlock: DocBlockKeyValue[], _token: CancellationToken | undefined): Promise<Argument[]> {
	const document: TextDocument = documentStateContext.document;
	const documentUri: Uri = document.uri;

	const scriptArgRanges: Range[] = getScriptFunctionArgRanges(documentStateContext, argsRange, ",", _token);

	const promise = Promise.all(scriptArgRanges.map(async (argRange: Range) => {
		const argText: string = documentStateContext.sanitizedDocumentText.slice(document.offsetAt(argRange.start), document.offsetAt(argRange.end));
		const argStartOffset = document.offsetAt(argRange.start);
		const scriptFunctionArgMatch: RegExpExecArray | null = scriptFunctionArgPattern.exec(argText);
		if (scriptFunctionArgMatch) {
			const fullArg = scriptFunctionArgMatch[0];
			const attributePrefix = scriptFunctionArgMatch[1];
			const argRequired = scriptFunctionArgMatch[2];
			const argType = scriptFunctionArgMatch[3];
			const argName = scriptFunctionArgMatch[4];
			let argDefault = scriptFunctionArgMatch[5];
			const argAttributes = scriptFunctionArgMatch[6];
			const argOffset = argStartOffset + scriptFunctionArgMatch.index;

			if (!argName) {
				return;
			}

			let argDefaultAndAttributesLen = 0;
			if (argDefault) {
				argDefaultAndAttributesLen += argDefault.length;
			}
			let parsedArgAttributes: Attributes | undefined;
			if (argAttributes) {
				argDefaultAndAttributesLen += argAttributes.length;

				const functionArgPrefixOffset = argOffset + attributePrefix.length;
				// Account for trailing comma?
				const functionArgRange = new Range(
					document.positionAt(functionArgPrefixOffset),
					document.positionAt(functionArgPrefixOffset + argDefaultAndAttributesLen)
				);
				parsedArgAttributes = parseAttributes(document, functionArgRange, argumentAttributeNames);
			}
			let removedDefaultAndAttributes = fullArg;
			if (argDefaultAndAttributesLen > 0) {
				removedDefaultAndAttributes = fullArg.slice(0, -argDefaultAndAttributesLen);
			}
			const argNameOffset = argOffset + removedDefaultAndAttributes.lastIndexOf(argName);

			let convertedArgType: DataType = DataType.Any;
			let typeUri: Uri | undefined;
			let argTypeRange: Range | undefined;
			if (argType) {
				const [dataType, returnTypeUri]: [DataType | undefined, Uri | undefined] = await DataType.getDataTypeAndUri(argType, documentUri, _token);
				if (dataType) {
					convertedArgType = dataType;
					if (returnTypeUri) {
						typeUri = returnTypeUri;
					}

					const argTypeOffset: number = fullArg.indexOf(argType);
					argTypeRange = new Range(
						document.positionAt(argOffset + argTypeOffset),
						document.positionAt(argOffset + argTypeOffset + argType.length)
					);
				}
			}

			const argument: Argument = {
				name: argName,
				type: argType,
				required: argRequired ? true : false,
				dataType: convertedArgType,
				description: "",
				nameRange: new Range(
					document.positionAt(argNameOffset),
					document.positionAt(argNameOffset + argName.length)
				),
			};

			if (argDefault) {
				argDefault = argDefault.trim();
				if (argDefault.length > 1 && /['"]/.test(argDefault.charAt(0)) && /['"]/.test(argDefault.charAt(argDefault.length - 1))) {
					argDefault = argDefault.slice(1, -1).trim();
				}
				if (argDefault.length > 2 && argDefault.startsWith("#") && argDefault.endsWith("#") && !argDefault.slice(1, -1).includes("#")) {
					argDefault = argDefault.slice(1, -1).trim();
				}
				argument.default = argDefault;
			}

			if (typeUri) {
				argument.dataTypeComponentUri = typeUri;
			}

			if (argTypeRange) {
				argument.dataTypeRange = argTypeRange;
			}

			if (parsedArgAttributes) {
				// Bit of a hack because I can't work this out right now
				const attributes: Attribute[] = [];
				parsedArgAttributes.forEach((attribute: Attribute) => {
					attributes.push(attribute);
				});

				await Promise.all(attributes.map(async (attr: Attribute) => {
					const argAttrName: string = attr.name;
					const argAttrVal: string = attr.value;
					if (argAttrName === "required") {
						argument.required = DataType.isTruthy(argAttrVal);
					}
					else if (argAttrName === "hint") {
						argument.description = argAttrVal;
					}
					else if (argAttrName === "default") {
						argument.default = argAttrVal;
					}
					else if (argAttrName === "type") {
						const [dataType, dataTypeComponentUri]: [DataType | undefined, Uri | undefined] = await DataType.getDataTypeAndUri(argAttrVal, documentUri, _token);
						if (dataType) {
							argument.dataType = dataType;
							if (dataTypeComponentUri) {
								argument.dataTypeComponentUri = dataTypeComponentUri;
							}

							argument.dataTypeRange = new Range(
								attr.valueRange.start,
								attr.valueRange.end
							);
						}
					}
				}));
			}

			const matchingDocBlocks = docBlock.filter((docElem: DocBlockKeyValue) => {
				return equalsIgnoreCase(docElem.key, argument.name);
			});

			await Promise.all(matchingDocBlocks.map(async (docElem: DocBlockKeyValue) => {
				if (docElem.subkey === "required") {
					argument.required = DataType.isTruthy(docElem.value);
				}
				else if (!docElem.subkey || docElem.subkey === "hint") {
					argument.description = docElem.value;
				}
				else if (docElem.subkey === "default") {
					argument.default = docElem.value;
				}
				else if (docElem.subkey === "type") {
					const [dataType, dataTypeComponentUri]: [DataType | undefined, Uri | undefined] = await DataType.getDataTypeAndUri(docElem.value, documentUri, _token);
					if (dataType) {
						argument.dataType = dataType;
						if (dataTypeComponentUri) {
							argument.dataTypeComponentUri = dataTypeComponentUri;
						}

						argument.dataTypeRange = docElem.valueRange
							? new Range(
								docElem.valueRange.start,
								docElem.valueRange.end
							)
							: undefined;
					}
				}
			}));

			return argument;
		}
		else {
			return undefined;
		}
	}));

	const args: Argument[] = (await promise).filter((arg: Argument | undefined) => {
		return arg !== undefined;
	});

	return args;
}

/**
 * Parses the tag function definitions and returns an array of UserFunction objects
 * @param documentStateContext The context information for a TextDocument in which to parse the tag functions
 * @param _token
 * @returns
 */
export async function parseTagFunctions(documentStateContext: DocumentStateContext, _token: CancellationToken | undefined): Promise<UserFunction[]> {
	const userFunctions: UserFunction[] = [];
	const documentUri: Uri = documentStateContext.document.uri;

	const parsedFunctionTags: Tag[] = parseTags(documentStateContext, "cffunction", undefined, _token);

	await Promise.all(parsedFunctionTags.map(async (tag: Tag) => {
		const functionRange: Range = tag.tagRange;
		const functionBodyRange: Range | undefined = tag.bodyRange;
		const parsedAttributes: Attributes = tag.attributes;
		const nameAttr: Attribute | undefined = parsedAttributes.get("name");

		if (!nameAttr) {
			return;
		}

		if (!parsedAttributes.has("name") || !nameAttr.value) {
			return;
		}

		const userFunction: UserFunction = {
			access: Access.Public,
			static: false,
			abstract: false,
			final: false,
			name: nameAttr.value,
			description: "",
			returntype: DataType.Any,
			signatures: [],
			nameRange: nameAttr.valueRange,
			bodyRange: functionBodyRange,
			location: new Location(documentUri, functionRange),
			isImplicit: false,
		};

		await assignFunctionAttributes(userFunction, parsedAttributes, _token);

		const signature: UserFunctionSignature = {
			parameters: await parseTagFunctionArguments(documentStateContext, functionBodyRange, _token),
		};
		userFunction.signatures = [signature];

		userFunctions.push(userFunction);
	}));

	return userFunctions;
}

/**
 * Parses the given function body to extract the arguments into an array of Argument objects that is returned
 * @param documentStateContext The context information for a TextDocument containing these function arguments
 * @param functionBodyRange A range in the given document for the function body
 * @param _token
 * @returns
 */
async function parseTagFunctionArguments(documentStateContext: DocumentStateContext, functionBodyRange: Range | undefined, _token: CancellationToken | undefined): Promise<Argument[]> {
	const args: Argument[] = [];
	const documentUri: Uri = documentStateContext.document.uri;

	if (functionBodyRange === undefined || functionBodyRange === null) {
		return args;
	}

	const parsedArgumentTags: Tag[] = parseTags(documentStateContext, "cfargument", functionBodyRange, _token);

	await Promise.all(parsedArgumentTags.map(async (tag: Tag) => {
		const parsedAttributes: Attributes = tag.attributes;

		const argumentAttributes: ArgumentAttributes | undefined = processArgumentAttributes(parsedAttributes);

		if (!argumentAttributes) {
			return;
		}

		const nameAttr: Attribute | undefined = parsedAttributes.get("name");
		const typeAttr: Attribute | undefined = parsedAttributes.get("type");
		const argNameRange: Range | undefined = nameAttr ? nameAttr.valueRange : undefined;

		let argRequired: boolean;
		if (argumentAttributes.required) {
			argRequired = DataType.isTruthy(argumentAttributes.required);
		}
		else {
			argRequired = false;
		}

		const argType = argumentAttributes.type;
		let convertedArgType: DataType = DataType.Any;
		let typeUri: Uri | undefined;
		let argTypeRange: Range | undefined;
		if (argType) {
			const [dataType, uri]: [DataType | undefined, Uri | undefined] = await DataType.getDataTypeAndUri(argType, documentUri, _token);
			if (dataType) {
				convertedArgType = dataType;
				if (uri) {
					typeUri = uri;
				}
				if (typeAttr) {
					argTypeRange = typeAttr ? typeAttr.valueRange : undefined;
					if (argTypeRange) {
						argTypeRange = new Range(
							argTypeRange.start,
							argTypeRange.end
						);
					}
				}
			}
		}

		const argument: Argument | undefined = argNameRange
			? {
					name: argumentAttributes.name,
					type: argType,
					required: argRequired,
					dataType: convertedArgType,
					description: argumentAttributes.hint ? argumentAttributes.hint : "",
					nameRange: argNameRange,
				}
			: undefined;

		if (argument) {
			let argDefault: string | undefined = argumentAttributes.default;
			if (argDefault) {
				argDefault = argDefault.trim();
				if (argDefault.length > 1 && /['"]/.test(argDefault.charAt(0)) && /['"]/.test(argDefault.charAt(argDefault.length - 1))) {
					argDefault = argDefault.slice(1, -1).trim();
				}
				if (argDefault.length > 2 && argDefault.startsWith("#") && argDefault.endsWith("#") && !argDefault.slice(1, -1).includes("#")) {
					argDefault = argDefault.slice(1, -1).trim();
				}
				argument.default = argDefault;
			}

			if (typeUri) {
				argument.dataTypeComponentUri = typeUri;
			}

			if (argTypeRange) {
				argument.dataTypeRange = argTypeRange;
			}

			args.push(argument);
		}
	}));

	return args;
}

/**
 * Assigns the given function attributes to the given user function
 * @param userFunction The user function to which the attributes will be assigned
 * @param functionAttributes The attributes that will be assigned to the user function
 * @param _token
 * @returns
 */
async function assignFunctionAttributes(userFunction: UserFunction, functionAttributes: Attributes, _token: CancellationToken | undefined): Promise<UserFunction> {
	// Bit of a hack because I can't work this out right now
	const attributes: Attribute[] = [];
	functionAttributes.forEach((attribute: Attribute) => {
		attributes.push(attribute);
	});

	await Promise.all(attributes.map(async (attribute: Attribute) => {
		const attrName: string = attribute.name;
		if (attribute.value) {
			const attrVal: string = attribute.value;
			if (attrName === "access") {
				userFunction.access = Access.valueOf(attrVal);
			}
			else if (attrName === "returntype") {
				const [returntype, returnTypeUri]: [DataType | undefined, Uri | undefined] = await DataType.getDataTypeAndUri(attrVal, userFunction.location.uri, _token);
				if (returntype) {
					userFunction.returntype = returntype;
					if (returnTypeUri) {
						userFunction.returnTypeUri = returnTypeUri;
					}
					const returnTypeAttr = functionAttributes.get("returntype");
					const returnTypeRange: Range | undefined = returnTypeAttr ? returnTypeAttr.valueRange : undefined;

					if (returnTypeRange) {
						userFunction.returnTypeRange = new Range(
							returnTypeRange.start,
							returnTypeRange.end
						);
					}
				}
			}
			else if (userFunctionBooleanAttributes.has(attrName)) {
				userFunction[attrVal] = DataType.isTruthy(attrVal);
			}
			else if (attrName === "hint") {
				userFunction.description = attrVal;
			}
			else if (attrName === "description" && userFunction.description === "") {
				userFunction.description = attrVal;
			}
		}
	}));

	return userFunction;
}

/**
 * Parses a set of attribute/value pairs for a function argument and returns an object conforming to the ArgumentAttributes interface
 * @param attributes A set of attribute/value pairs for a function argument
 * @returns
 */
function processArgumentAttributes(attributes: Attributes): ArgumentAttributes | undefined {
	const attributeObj = {};
	attributes.forEach((attr: Attribute, attrKey: string) => {
		attributeObj[attrKey] = attr.value;
	});

	if (!attributeObj["name"]) {
		return undefined;
	}

	return attributeObj as ArgumentAttributes;
}

/**
 * Parses the given user function to extract the local variables into an array of Variable objects that is returned
 * @param func The UserFunction within which to parse local variables
 * @param documentStateContext The contextual information of the state of a document containing the given function
 * @param isScript Whether this function is defined entirely in CFScript
 * @param _token
 * @returns
 */
export async function getLocalVariables(func: UserFunction, documentStateContext: DocumentStateContext, isScript: boolean, _token: CancellationToken | undefined): Promise<Variable[]> {
	if (!func || !func.bodyRange) {
		return [];
	}

	const allVariables: Variable[] = await parseVariableAssignments(documentStateContext, isScript, func.bodyRange, _token);

	return allVariables.filter((variable: Variable) => {
		return (variable.scope === Scope.Local);
	});
}

/**
 * Identifies if the modifier is of an Access type or other
 * @param modifier A string representing the function modifier
 * @returns
 */
function parseModifier(modifier: string): string {
	if (accessArr.includes(modifier.toLowerCase())) {
		return "access";
	}

	return modifier;
}

/**
 * Gets the function based on its key and position in the document
 * @param documentPositionStateContext The contextual information of the state of a document and the cursor position
 * @param functionKey The function key for which to get
 * @param docPrefix The document prefix of the function if not the same as docPrefix within documentPositionStateContext
 * @param _token
 * @returns
 */
export async function getFunctionFromPrefix(documentPositionStateContext: DocumentPositionStateContext, functionKey: string, docPrefix: string | undefined, _token: CancellationToken | undefined): Promise<UserFunction | undefined> {
	let foundFunction: UserFunction | undefined;

	if (docPrefix === undefined || docPrefix === null) {
		docPrefix = documentPositionStateContext.docPrefix;
	}

	// TODO: Replace regex check with variable references range check
	// TODO: Check for function variables?
	const varPrefixMatch: RegExpExecArray | null = getVariableExpressionPrefixPattern().exec(docPrefix);
	if (varPrefixMatch) {
		const varMatchText: string = varPrefixMatch[0].replace(normalizeSplit, ".");
		const varScope: string = varPrefixMatch[2];
		const varQuote: string = varPrefixMatch[3];
		const varName: string = varPrefixMatch[4];

		let dotSeparatedCount = 2;
		if (varScope && !varQuote) {
			dotSeparatedCount++;
		}

		if (varMatchText.split(".").length === dotSeparatedCount) {
			if (documentPositionStateContext.isCfcFile && !varScope && equalsIgnoreCase(varName, "super")) {
				if (documentPositionStateContext.component && documentPositionStateContext.component.extends) {
					const baseComponent: Component | undefined = getComponent(documentPositionStateContext.component.extends);
					if (baseComponent) {
						foundFunction = getFunctionFromComponent(baseComponent, functionKey, documentPositionStateContext.document.uri, undefined, false);
					}
				}
			}
			else if (documentPositionStateContext.isCfcFile && !varScope && (equalsIgnoreCase(varName, Scope.Variables) || equalsIgnoreCase(varName, Scope.This))) {
				// TODO: Disallow implicit functions if using variables scope
				let disallowedAccess: Access | undefined;
				if (equalsIgnoreCase(varName, Scope.This)) {
					disallowedAccess = Access.Private;
				}
				const disallowImplicit: boolean = equalsIgnoreCase(varName, Scope.Variables);

				if (documentPositionStateContext.component) {
					foundFunction = getFunctionFromComponent(documentPositionStateContext.component, functionKey, documentPositionStateContext.document.uri, disallowedAccess, disallowImplicit);
				}
			}
			else if (documentPositionStateContext.isCfmFile && !varScope && equalsIgnoreCase(varName, Scope.Variables)) {
				foundFunction = await getFunctionFromTemplate(documentPositionStateContext, functionKey, _token);
			}
			else {
				// TODO: Allow passing variable assignments
				const allDocumentVariableAssignments: Variable[] = await collectDocumentVariableAssignments(documentPositionStateContext, _token);

				let variableAssignments: Variable[] = allDocumentVariableAssignments;
				const fileName: string = uriBaseName(documentPositionStateContext.document.uri);
				if (varScope && fileName !== "Application.cfm") {
					const applicationDocVariables: Variable[] | undefined = await getApplicationVariables(documentPositionStateContext.document.uri);
					if (applicationDocVariables) {
						variableAssignments = variableAssignments.concat(applicationDocVariables);
					}
				}

				const scopeVal: Scope | undefined = varScope ? Scope.valueOf(varScope) : undefined;
				const foundVar: Variable | undefined = getBestMatchingVariable(variableAssignments, varName, scopeVal);

				if (foundVar && foundVar.dataTypeComponentUri) {
					const foundVarComponent: Component | undefined = getComponent(foundVar.dataTypeComponentUri);
					if (foundVarComponent) {
						foundFunction = getFunctionFromComponent(foundVarComponent, functionKey, documentPositionStateContext.document.uri, undefined, false);
					}
				}
			}
		}
	}
	else {
		const varMatchText2 = getVariableCallExpressionPrefixPattern().exec(docPrefix);
		if (!varMatchText2) {
			if (documentPositionStateContext.isCfmFile) {
				foundFunction = await getFunctionFromTemplate(documentPositionStateContext, functionKey, _token);
			}
			else if (documentPositionStateContext.component) {
				foundFunction = getFunctionFromComponent(documentPositionStateContext.component, functionKey, documentPositionStateContext.document.uri, undefined, false);
			}
		}
	}

	return foundFunction;
}

/**
 * Gets the function based on the component to which it belongs, its name, and from where it is being called
 * @param component The component in which to begin looking
 * @param lowerFunctionName The function name all lowercased
 * @param callerUri The URI of the document from which the function is being called
 * @param disallowedAccess An access specifier to disallow
 * @param disallowImplicit Whether to disallow implicit functions from being checked
 * @returns
 */
export function getFunctionFromComponent(component: Component, lowerFunctionName: string, callerUri: Uri, disallowedAccess: Access | undefined, disallowImplicit: boolean = false): UserFunction | undefined {
	const validFunctionAccess: MySet<Access> = new MySet([Access.Remote, Access.Public]);
	if (hasComponent(callerUri)) {
		const callerComponent: Component | undefined = getComponent(callerUri);
		if (callerComponent && isSubcomponentOrEqual(callerComponent, component)) {
			validFunctionAccess.add(Access.Private);
			validFunctionAccess.add(Access.Package);
		}
	}

	if (!validFunctionAccess.has(Access.Package) && Utils.dirname(callerUri).fsPath === Utils.dirname(component.uri).fsPath) {
		validFunctionAccess.add(Access.Package);
	}

	if (disallowedAccess && validFunctionAccess.has(disallowedAccess)) {
		validFunctionAccess.delete(disallowedAccess);
	}

	let currComponent: Component | undefined = component;
	while (currComponent) {
		if (currComponent.functions.has(lowerFunctionName)) {
			const foundFunc: UserFunction | undefined = currComponent.functions.get(lowerFunctionName);
			if (foundFunc && validFunctionAccess.has(foundFunc.access) && !(disallowImplicit && foundFunc.isImplicit)) {
				return foundFunc;
			}
		}

		if (currComponent.extends) {
			currComponent = getComponent(currComponent.extends);
		}
		else {
			currComponent = undefined;
		}
	}

	return undefined;
}

/**
 * Gets the function based on the document to which it belongs and its name
 * @param documentStateContext The contextual information of the state of a document
 * @param lowerFunctionName The function name all lowercased
 * @param _token
 * @returns
 */
export async function getFunctionFromTemplate(documentStateContext: DocumentStateContext, lowerFunctionName: string, _token: CancellationToken | undefined): Promise<UserFunction | undefined> {
	const tagFunctions: UserFunction[] = await parseTagFunctions(documentStateContext, _token);
	const cfscriptRanges: Range[] = getCfScriptRanges(documentStateContext.document, undefined, _token);
	const scriptFunctions: UserFunction[] = await parseScriptFunctions(documentStateContext, _token);

	const allTemplateFunctions: UserFunction[] = tagFunctions.concat(scriptFunctions.filter((func: UserFunction) => {
		return isInRanges(cfscriptRanges, func.location.range.start, false, _token);
	}));

	return allTemplateFunctions.find((func: UserFunction) => {
		return equalsIgnoreCase(func.name, lowerFunctionName);
	});
}

/**
 * Returns UserFunction array representation of function variables with some properties undefined
 * @param variables The variables to convert
 * @returns
 */
export function variablesToUserFunctions(variables: UserFunctionVariable[]): UserFunction[] {
	return variables.map((variable: UserFunctionVariable) => {
		const userFun: UserFunction = {
			name: variable.identifier,
			description: variable.description ? variable.description : "",
			returntype: DataType.Any, // Get this from variable
			access: Access.Public, // Define?
			static: false,
			abstract: false,
			final: variable.final,
			nameRange: variable.declarationLocation.range,
			bodyRange: undefined, // Define
			signatures: [variable.signature],
			location: variable.declarationLocation, // Range is only declaration
			isImplicit: false,
		};
		return userFun;
	});
}
