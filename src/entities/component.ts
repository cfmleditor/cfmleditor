import { CancellationToken, Position, Range, TextDocument, Uri, workspace } from "vscode";
import { getComponent, hasComponent, cachedComponentPathToUri } from "../features/cachedEntities";
import { MySet } from "../utils/collections";
import { isCfcFile } from "../utils/contextUtil";
import { DocumentPositionStateContext, DocumentStateContext } from "../utils/documentUtil";
import { fileExists, findUpWorkspaceFile, resolveBaseName, resolveCustomMappingPaths, resolveRelativePath, resolveRootPath } from "../utils/fileUtil";
import { Attribute, Attributes, parseAttributes } from "./attribute";
import { DataType } from "./dataType";
import { DocBlockKeyValue, parseDocBlock } from "./docblock";
import { constructGetter, constructSetter, parseProperties, Properties, Property } from "./property";
import { ComponentFunctions, parseScriptFunctions, parseTagFunctions, UserFunction } from "./userFunction";
import { parseVariableAssignments, Variable } from "./variable";

export const COMPONENT_EXT: string = ".cfc";
export const COMPONENT_FILE_GLOB: string = "**/*" + COMPONENT_EXT;

export const COMPONENT_TAG_PATTERN: RegExp = /((<cf)(component|interface)\b)([^>]*)/i;
export const COMPONENT_SCRIPT_PATTERN: RegExp = /((\/\*\*((?:\*(?!\/)|[^*])*)\*\/\s+)?(component|interface)\b)([^{]*)/i;

export const componentExtendsPathPrefix: RegExp = /\b(extends|implements)\s*=\s*(['"])?([^'"#\s]*?)$/i;

export const componentDottedPathPrefix: RegExp = /\b(import|new)\s+(?:component\s*:\s*)?(['"])?([^('":;\n]*?)$/i;

export const objectNewInstanceInitPrefix: RegExp = /\bnew\s+(?:component\s*:\s*)?(['"])?([^('":]+?)\1\($/i;

export interface ReferencePattern {
	pattern: RegExp;
	refIndex: number;
}

export const objectReferencePatterns: ReferencePattern[] = [
	// new object
	{
		pattern: /\bnew\s+(?:component\s*:\s*)?(['"])?([^('":]+?)\1\(/gi,
		refIndex: 2,
	},
	// import
	{
		pattern: /\bimport\s+(['"])?([^'"]+?)\1(?:;|\n)/gi,
		refIndex: 2,
	},
	// createObject
	{
		pattern: /\bcreateObject\s*\(\s*(['"])component\1\s*,\s*(['"])([^'"]+?)\2/gi,
		refIndex: 3,
	},
	// createObject("...")
	{
		pattern: /\bcreateObject\s*(?:\(\s*(?!["'](?:component|com|java|corba|webservice)["']))(['"])\s*([^'"]+?)\1/gi,
		refIndex: 2,
	},
	// cfobject or cfinvoke
	{
		pattern: /\bcomponent\s*(?:=|:)\s*(['"])([^'"]+?)\1/gi,
		refIndex: 2,
	},
	// isInstanceOf
	{
		pattern: /\bisInstanceOf\s*\(\s*[\w$.]+\s*,\s*(['"])([^'"]+?)\1/gi,
		refIndex: 2,
	},
];
// TODO: variableReferencePatterns

const componentAttributeNames: MySet<string> = new MySet([
	"accessors",
	"alias",
	"autoindex",
	"bindingname",
	"consumes",
	"displayname",
	"extends",
	"hint",
	"httpmethod",
	"implements",
	"indexable",
	"indexlanguage",
	"initmethod",
	"mappedsuperclass",
	"namespace",
	"output",
	"persistent",
	"porttypename",
	"produces",
	"rest",
	"restPath",
	"serializable",
	"serviceaddress",
	"serviceportname",
	"style",
	"wsdlfile",
	"wsVersion",
]);
const booleanAttributes: MySet<string> = new MySet([
	"accessors",
	"autoindex",
	"indexable",
	"mappedsuperclass",
	"output",
	"persistent",
	"rest",
	"serializable",
]);

export interface Component {
	uri: Uri;
	name: string;
	isScript: boolean;
	isInterface: boolean; // should be a separate type, but chose this for the purpose of simplification
	declarationRange: Range;
	displayname: string;
	hint: string;
	accessors: boolean;
	initmethod?: string;
	// TODO: Investigate matching implements since interfaces can extend multiple interfaces
	extends?: Uri;
	extendsRange?: Range;
	implements?: Uri[];
	implementsRanges?: Range[];
	functions: ComponentFunctions;
	properties: Properties;
	variables: Variable[];
	imports: string[];
}

interface ComponentAttributes {
	accessors?: boolean;
	alias?: string;
	autoindex?: boolean;
	bindingname?: string;
	consumes?: string;
	displayname?: string;
	extends?: string;
	hint?: string;
	httpmethod?: string;
	implements?: string;
	indexable?: boolean;
	indexlanguage?: string;
	initmethod?: string;
	mappedsuperclass?: boolean;
	namespace?: string;
	output?: boolean;
	persistent?: boolean;
	porttypename?: string;
	produces?: string;
	rest?: boolean;
	restPath?: string;
	serializable?: boolean;
	serviceaddress?: string;
	serviceportname?: string;
	style?: string;
	wsdlfile?: string;
	wsVersion?: string;
}
export interface ComponentsByUri {
	[uri: string]: Component; // key is Uri.toString()
}
export interface ComponentsByName {
	[name: string]: ComponentsByUri; // key is Component name lowercased
}

/**
 * Determines whether the given document is a script-based component
 * @param document The document to check
 * @param _token
 * @returns
 */
export function isScriptComponent(document: TextDocument, _token: CancellationToken | undefined): boolean {
	const componentTagMatch: RegExpExecArray | null = COMPONENT_TAG_PATTERN.exec(document.getText());
	if (componentTagMatch) {
		return false;
	}

	return isCfcFile(document, _token);
}

/**
 * Parses a component document and returns an object conforming to the Component interface
 * @param documentStateContext The context information for a TextDocument to be parsed
 * @param _token
 * @returns
 */
export async function parseComponent(documentStateContext: DocumentStateContext, _token: CancellationToken | undefined): Promise<Component | undefined> {
	const document: TextDocument = documentStateContext.document;
	const documentText: string = document.getText();
	const componentIsScript: boolean = documentStateContext.docIsScript;

	let componentMatch: RegExpExecArray | null;
	let head: string;
	let attributePrefix: string;
	let fullPrefix: string | undefined;
	let componentDoc: string | undefined;
	let checkTag: string | undefined;
	let componentType: string;
	let componentAttrs: string;

	if (!componentIsScript) {
		componentMatch = COMPONENT_TAG_PATTERN.exec(documentText);

		if (!componentMatch) {
			return undefined;
		}

		head = componentMatch[0];
		attributePrefix = componentMatch[1];
		checkTag = componentMatch[2];
		componentType = componentMatch[3];
		componentAttrs = componentMatch[4];
	}
	else {
		componentMatch = COMPONENT_SCRIPT_PATTERN.exec(documentText);

		if (!componentMatch) {
			return undefined;
		}

		head = componentMatch[0];
		attributePrefix = componentMatch[1];
		fullPrefix = componentMatch[2];
		componentDoc = componentMatch[3];
		componentType = componentMatch[4];
		componentAttrs = componentMatch[5];
	}

	let declarationStartOffset: number = componentMatch.index;
	if (fullPrefix) {
		declarationStartOffset += fullPrefix.length;
	}
	if (checkTag) {
		declarationStartOffset += checkTag.length;
	}

	const componentAttributes: ComponentAttributes = {};
	const component: Component = {
		uri: document.uri,
		name: resolveBaseName(document.fileName, COMPONENT_EXT),
		isScript: componentIsScript,
		isInterface: componentType === "interface",
		declarationRange: new Range(document.positionAt(declarationStartOffset), document.positionAt(declarationStartOffset + componentType.length)),
		displayname: "",
		hint: "",
		extends: undefined,
		implements: undefined,
		accessors: false,
		functions: new ComponentFunctions(),
		properties: await parseProperties(documentStateContext, _token),
		variables: [],
		imports: [],
	};

	if (componentDoc) {
		const parsedDocBlock: DocBlockKeyValue[] = parseDocBlock(
			document,
			new Range(
				document.positionAt(componentMatch.index + 3),
				document.positionAt(componentMatch.index + 3 + componentDoc.length)
			)
		);
		const docBlockAttributes: ComponentAttributes = processDocBlock(parsedDocBlock);
		Object.assign(componentAttributes, docBlockAttributes);

		parsedDocBlock.filter((docAttribute: DocBlockKeyValue) => {
			return docAttribute.key === "extends" && docAttribute.value;
		}).forEach((docAttribute: DocBlockKeyValue) => {
			if (docAttribute.valueRange) {
				component.extendsRange = new Range(
					docAttribute.valueRange.start,
					docAttribute.valueRange.end
				);
			}
		});

		const implDocAttr = parsedDocBlock.find((docAttribute: DocBlockKeyValue) => {
			return docAttribute.key === "implements" && !!docAttribute.value;
		});
		if (implDocAttr && implDocAttr.valueRange) {
			component.implementsRanges = [];
			const implInitialOffset = document.offsetAt(implDocAttr.valueRange.start);
			let implOffset: number = 0;
			implDocAttr.value.split(",").forEach((element: string) => {
				const whitespaceMatch: RegExpExecArray | null = /\s+/.exec(element);
				const whitespaceLen = whitespaceMatch ? whitespaceMatch[0].length : 0;
				const interfacePathWordRange: Range | undefined = document.getWordRangeAtPosition(document.positionAt(implInitialOffset + implOffset + whitespaceLen), /[$\w.]+/);
				if (interfacePathWordRange && component.implementsRanges) {
					component.implementsRanges.push(interfacePathWordRange);
				}

				implOffset += element.length + 1;
			});
		}
	}

	if (componentAttrs) {
		const componentAttributePrefixOffset: number = componentMatch.index + attributePrefix.length;
		const componentAttributeRange = new Range(
			document.positionAt(componentAttributePrefixOffset),
			document.positionAt(componentAttributePrefixOffset + componentAttrs.length)
		);

		const parsedAttributes: Attributes = parseAttributes(document, componentAttributeRange, componentAttributeNames);

		const tagAttributes: ComponentAttributes = processAttributes(parsedAttributes);
		Object.assign(componentAttributes, tagAttributes);

		if (parsedAttributes.has("extends")) {
			const extendsAttr: Attribute | undefined = parsedAttributes.get("extends");
			if (extendsAttr && extendsAttr.value) {
				component.extendsRange = new Range(
					extendsAttr.valueRange.start,
					extendsAttr.valueRange.end
				);
			}
		}

		if (parsedAttributes.has("implements")) {
			const implementsAttr: Attribute | undefined = parsedAttributes.get("implements");
			if (implementsAttr && implementsAttr.value) {
				component.implementsRanges = [];
				const implInitialOffset = document.offsetAt(implementsAttr.valueRange.start);
				let implOffset: number = 0;
				implementsAttr.value.split(",").forEach((element: string) => {
					const whitespaceMatch: RegExpExecArray | null = /\s+/.exec(element);
					const whitespaceLen = whitespaceMatch ? whitespaceMatch[0].length : 0;
					const interfacePathWordRange: Range | undefined = document.getWordRangeAtPosition(document.positionAt(implInitialOffset + implOffset + whitespaceLen), /[$\w.]+/);
					if (component.implementsRanges && interfacePathWordRange) {
						component.implementsRanges.push(interfacePathWordRange);
					}

					implOffset += element.length + 1;
				});
			}
		}
	}

	const componentPropertyNames = Object.getOwnPropertyNames(component);

	for (const propName of componentPropertyNames) {
		// TODO: Is this just supposed to be checking for existence or also value? Because it is ignoring falsy property values too
		if (componentAttributes[propName]) {
			if (propName === "extends" && componentAttributes.extends) {
				component.extends = await componentPathToUri(componentAttributes.extends, document.uri, _token);
			}
			else if (propName === "implements") {
				const componentimplements = componentAttributes.implements ? componentAttributes.implements.split(",") : [];
				for (const element of componentimplements) {
					const implementsUri: Uri | undefined = await componentPathToUri(element.trim(), document.uri, _token);
					if (implementsUri) {
						if (!component.implements) {
							component.implements = [];
						}
						component.implements.push(implementsUri);
					}
				}
			}
			else if (propName === "persistent" && componentAttributes.persistent) {
				component.accessors = true;
			}
			else {
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				component[propName] = componentAttributes[propName];
			}
		}
	}

	documentStateContext.component = component;
	const componentFunctions = new ComponentFunctions();
	let userFunctions: UserFunction[] = [];
	userFunctions = userFunctions.concat(await parseScriptFunctions(documentStateContext, _token));
	userFunctions = userFunctions.concat(await parseTagFunctions(documentStateContext, _token));
	let earliestFunctionRangeStart: Position = document.positionAt(documentText.length);
	userFunctions.forEach((compFun: UserFunction) => {
		if (compFun.location.range.start.isBefore(earliestFunctionRangeStart)) {
			earliestFunctionRangeStart = compFun.location.range.start;
		}
		componentFunctions.set(compFun.name.toLowerCase(), compFun);
	});

	// Implicit functions
	if (component.accessors) {
		component.properties.forEach((prop: Property) => {
			// getters
			if (typeof prop.getter === "undefined" || prop.getter) {
				const getterKey = "get" + prop.name.toLowerCase();
				if (!componentFunctions.has(getterKey)) {
					componentFunctions.set(getterKey, constructGetter(prop, component.uri));
				}
			}
			// setters
			if (typeof prop.setter === "undefined" || prop.setter) {
				const setterKey = "set" + prop.name.toLowerCase();
				if (!componentFunctions.has(setterKey)) {
					componentFunctions.set(setterKey, constructSetter(prop, component.uri));
				}
			}
		});
	}

	component.functions = componentFunctions;

	// Only check before first function definition
	const componentDefinitionRange = new Range(document.positionAt(componentMatch.index + head.length), earliestFunctionRangeStart);
	component.variables = await parseVariableAssignments(documentStateContext, componentIsScript, componentDefinitionRange, _token);

	// TODO: Get imports

	return component;
}

/**
 * Parses a component document and returns an object conforming to the Component interface
 * @param documentPositionStateContext The context information for the TextDocument and position to be check
 * @returns
 */
export function isInComponentHead(documentPositionStateContext: DocumentPositionStateContext): boolean {
	const document: TextDocument = documentPositionStateContext.document;
	const documentText: string = documentPositionStateContext.sanitizedDocumentText;
	const componentPattern: RegExp = documentPositionStateContext.docIsScript ? COMPONENT_SCRIPT_PATTERN : COMPONENT_TAG_PATTERN;
	const componentMatch: RegExpExecArray | null = componentPattern.exec(documentText);

	if (!componentMatch) {
		return false;
	}

	const head: string = componentMatch[0];

	if (!head) {
		return false;
	}

	const componentHeadRange = new Range(new Position(0, 0), document.positionAt(componentMatch.index + head.length));

	return componentHeadRange.contains(documentPositionStateContext.position);
}

/**
 * Parses a documentation block for a component and returns an object conforming to the ComponentAttributes interface
 * @param docBlock The documentation block to be processed
 * @returns
 */
function processDocBlock(docBlock: DocBlockKeyValue[]): ComponentAttributes {
	const docBlockObj: ComponentAttributes = {};
	docBlock.forEach((docElem: DocBlockKeyValue) => {
		const activeKey = docElem.key;
		if (booleanAttributes.has(activeKey)) {
			docBlockObj[activeKey] = DataType.isTruthy(docElem.value);
		}
		else {
			docBlockObj[activeKey] = docElem.value;
		}
	});

	return docBlockObj;
}

/**
 * Processes a set of attributes for a component and returns an object conforming to the ComponentAttributes interface
 * @param attributes A set of attributes
 * @returns
 */
function processAttributes(attributes: Attributes): ComponentAttributes {
	const attributeObj: ComponentAttributes = {};

	attributes.forEach((attr: Attribute, attrKey: string) => {
		if (booleanAttributes.has(attrKey)) {
			attributeObj[attrKey] = DataType.isTruthy(attr.value);
		}
		else {
			attributeObj[attrKey] = attr.value;
		}
	});

	return attributeObj;
}

/**
 * Resolves a component in dot-path notation to a URI
 * @param dotPath A string for a component in dot-path notation
 * @param baseUri The URI from which the component path will be resolved
 * @param _token
 * @returns
 */
export async function componentPathToUri(dotPath: string, baseUri: Uri, _token: CancellationToken | undefined): Promise<Uri | undefined> {
	if (!dotPath) {
		return undefined;
	}

	const cachedResult: Uri | undefined = cachedComponentPathToUri(dotPath, baseUri, _token);
	if (cachedResult) {
		return cachedResult;
	}

	const normalizedPath: string = Uri.parse(dotPath + COMPONENT_EXT).toString();

	/* Note
    If ColdFusion finds a directory that matches the first path element, but does not find a CFC under that directory, ColdFusion returns a not found error and does NOT search for another directory.
    This implementation does not do this.
    */

	// relative to local directory
	const localPath: string = resolveRelativePath(baseUri, normalizedPath);

	if (await fileExists(localPath)) {
		return Uri.file(localPath);
	}

	// relative to web root
	const rootPath: string | undefined = resolveRootPath(baseUri, normalizedPath);
	if (rootPath && await fileExists(rootPath)) {
		return Uri.file(rootPath);
	}

	// custom mappings
	const customMappingPaths: string[] = resolveCustomMappingPaths(baseUri, normalizedPath);
	for (const mappedPath of customMappingPaths) {
		if (await fileExists(mappedPath)) {
			return Uri.file(mappedPath);
		}
	}

	return undefined;
}

/**
 * Returns just the name part for a component dot path
 * @param path Dot path to a component
 * @returns
 */
export function getComponentNameFromDotPath(path: string): string | undefined {
	return path.split(".").pop();
}

/**
 * Finds the applicable Application file for the given file URI
 * @param baseUri The URI from which the Application file will be searched
 * @returns
 */
export async function getApplicationUri(baseUri: Uri): Promise<Uri | undefined> {
	if (baseUri.scheme !== "file") {
		return undefined;
	}

	const applicationFile: Uri | undefined = await findUpWorkspaceFile("Application.cfc", baseUri);

	return applicationFile;
}

/**
 * Finds the applicable Server file for the given file URI
 * @param baseUri The URI from which the Server file will be searched
 * @param _token
 * @returns
 */
export function getServerUri(baseUri: Uri, _token: CancellationToken | undefined): Uri | undefined {
	let componentUri: Uri | undefined;

	const fileName = "Server.cfc";
	const rootPath: string | undefined = resolveRootPath(baseUri, fileName);

	if (rootPath) {
		const rootUri: Uri = Uri.file(rootPath);

		if (hasComponent(rootUri, _token)) {
			componentUri = rootUri;
		}
	}

	// TODO: custom mapping

	return componentUri;
}

/**
 * Get the web root URI for a given file URI
 *
 * This is similar to `workspace.getWorkspaceFolder`, but it accounts for the `webroot` setting.
 * @param fileUri The URI of the file for which to get the web root
 * @returns The web root URI for the given file URI, or undefined if the file is not in a workspace
 */
export function getWebroot(fileUri: Uri): Uri | undefined {
	// Get the workspace folder for the file URI, or return undefined if not found
	const workspaceUri = workspace.getWorkspaceFolder(fileUri)?.uri;
	if (!workspaceUri) {
		return undefined;
	}

	// Add on the webroot setting, which is relative to the workspace root
	const webrootRelative = workspace.getConfiguration("cfml", fileUri).get<string>("webroot", "");
	const webrootUri = Uri.joinPath(workspaceUri, webrootRelative);

	return webrootUri;
}

/**
 * Checks whether `checkComponent` is a subcomponent or equal to `baseComponent`
 * @param checkComponent The candidate subcomponent
 * @param baseComponent The candidate base component
 * @param _token
 * @returns
 */
export function isSubcomponentOrEqual(checkComponent: Component, baseComponent: Component, _token: CancellationToken | undefined): boolean {
	let localCheckComponent: Component | undefined = checkComponent;
	while (localCheckComponent) {
		if (localCheckComponent.uri.toString() === baseComponent.uri.toString()) {
			return true;
		}

		if (localCheckComponent.extends) {
			localCheckComponent = getComponent(localCheckComponent.extends, _token);
		}
		else {
			localCheckComponent = undefined;
		}
	}

	return false;
}

/**
 * Checks whether `checkComponent` is a subcomponent of `baseComponent`
 * @param checkComponent The candidate subcomponent
 * @param baseComponent The candidate base component
 * @param _token
 * @returns
 */
export function isSubcomponent(checkComponent: Component, baseComponent: Component, _token: CancellationToken | undefined): boolean {
	let localCheckComponent: Component | undefined = checkComponent;
	if (localCheckComponent.extends) {
		localCheckComponent = getComponent(localCheckComponent.extends, _token);
	}
	else {
		return false;
	}

	while (localCheckComponent) {
		if (localCheckComponent.uri.toString() === baseComponent.uri.toString()) {
			return true;
		}

		if (localCheckComponent.extends) {
			localCheckComponent = getComponent(localCheckComponent.extends, _token);
		}
		else {
			localCheckComponent = undefined;
		}
	}

	return false;
}

/**
 * Gets a function by name if it exists in the component
 * @param component the component object
 * @param functionName the name of the function
 * @returns
 */
export function getComponentFunction(component: Component, functionName: string): UserFunction | undefined {
	if (!component || !component.functions) {
		return undefined;
	}

	// Normalize the function name to lowercase for case-insensitive comparison
	const normalizedFunctionName = functionName.toLowerCase();

	// Check if any UserFunction in the component.functions array matches the functionName
	return Array.from(component.functions.values()).find((userFunction: UserFunction) => {
		return userFunction.name.toLowerCase() === normalizedFunctionName;
	});
}
