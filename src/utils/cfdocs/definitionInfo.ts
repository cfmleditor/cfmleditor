import { DataType } from "../../entities/dataType";
import { GlobalFunction, GlobalTag } from "../../entities/globals";
import { Parameter } from "../../entities/parameter";
import { Signature } from "../../entities/signature";
import { equalsIgnoreCase } from "../textUtil";
import CFDocsService from "./cfDocsService";
import { CFMLEngine, CFMLEngineName } from "./cfmlEngine";
import { multiSigGlobalFunctions } from "./multiSignatures";
import { decode } from "html-entities";

export interface Param {
	name: string;
	type: string;
	required: boolean;
	description?: string;
	default?: string;
	values?: string[];
}

export interface EngineCompatibilityDetail {
	minimum_version?: string;
	deprecated?: string;
	removed?: string;
	notes?: string;
	docs?: string;
}

export interface EngineInfo {
	// expected to be CFMLEngineName
	[name: string]: EngineCompatibilityDetail;
}

export interface Example {
	title: string;
	description: string;
	code: string;
	result: string;
	runnable?: boolean;
}

/**
 * Resolves a string value of data type to an enumeration member
 * @param type The data type string to resolve
 * @returns
 */
function getParamDataType(type: string): DataType {
	switch (type) {
		case "any":
			return DataType.Any;
		case "array":
			return DataType.Array;
		case "binary":
			return DataType.Binary;
		case "boolean":
			return DataType.Boolean;
		case "component":
			return DataType.Component;
		case "date":
			return DataType.Date;
		case "function":
			return DataType.Function;
		case "guid":
			return DataType.GUID;
		case "numeric":
			return DataType.Numeric;
		case "query":
			return DataType.Query;
		case "string":
			return DataType.String;
		case "struct":
			return DataType.Struct;
		case "uuid":
			return DataType.UUID;
		case "variablename":
			return DataType.VariableName;
		case "xml":
			return DataType.XML;
		default:
			// console.log("Unknown param type: " + type);
			return DataType.Any;
	}
}

/**
 * Resolves a string value of data type to an enumeration member
 * @param type The data type string to resolve
 * @returns
 */
function getReturnDataType(type: string): DataType {
	switch (type) {
		case "any":
			return DataType.Any;
		case "array":
			return DataType.Array;
		case "binary":
			return DataType.Binary;
		case "boolean":
			return DataType.Boolean;
		case "date":
			return DataType.Date;
		case "function":
			return DataType.Function;
		case "guid":
			return DataType.GUID;
		case "numeric":
			return DataType.Numeric;
		case "query":
			return DataType.Query;
		case "string":
			return DataType.String;
		case "struct":
			return DataType.Struct;
		case "uuid":
			return DataType.UUID;
		case "variablename":
			return DataType.VariableName;
		case "void":
			return DataType.Void;
		case "xml":
			return DataType.XML;
		default:
			return DataType.Any; // DataType.Void?
	}
}

export class CFDocsDefinitionInfo {
	private static allFunctionNames: string[];
	private static allTagNames: string[];

	public name: string;
	public type: string;
	public syntax: string;
	public member?: string;
	public script?: string;
	public returns?: string;
	public related?: string[];
	public description?: string;
	public discouraged?: string;
	public params?: Param[];
	public engines?: EngineInfo;
	public links?: string[];
	public examples?: Example[];

	/**
	 *
	 * @param name
	 * @param type
	 * @param syntax
	 * @param member
	 * @param script
	 * @param returns
	 * @param related
	 * @param description
	 * @param discouraged
	 * @param params
	 * @param engines
	 * @param links
	 * @param examples
	 */
	constructor(
		name: string, type: string, syntax: string, member: string, script: string, returns: string, related: string[],
		description: string, discouraged: string, params: Param[], engines: EngineInfo, links: string[], examples: Example[]
	) {
		this.name = name;
		this.type = type;
		this.syntax = syntax;
		this.member = member;
		this.script = script;
		this.returns = returns;
		this.related = related;
		this.description = description;
		this.discouraged = discouraged;
		this.params = params;
		this.engines = engines;
		this.links = links;
		this.examples = examples;
	}

	/**
	 * Returns whether this object is a function
	 * @returns
	 */
	public isFunction(): boolean {
		return (equalsIgnoreCase(this.type, "function"));
	}

	/**
	 * Returns whether this object is a tag
	 * @returns
	 */
	public isTag(): boolean {
		return (equalsIgnoreCase(this.type, "tag"));
	}

	/**
	 * Returns a GlobalFunction object based on this object
	 * @returns
	 */
	public toGlobalFunction(): GlobalFunction {
		const signatures: Signature[] = [];
		if (multiSigGlobalFunctions.has(this.name)) {
			const thisMultiSigs: string[][] | undefined = multiSigGlobalFunctions.get(this.name);
			if (thisMultiSigs) {
				thisMultiSigs.forEach((thisMultiSig: string[]) => {
					const parameters: Parameter[] = [];
					thisMultiSig.forEach((multiSigParam: string) => {
						let paramFound = false;
						if (this.params) {
							for (const param of this.params) {
								const multiSigParamParsed: string = multiSigParam.split("=")[0];
								if (param.name === multiSigParamParsed) {
									const parameter: Parameter = {
										name: multiSigParam,
										type: param.type,
										dataType: getParamDataType(param.type.toLowerCase()),
										required: param.required,
										description: param.description ? param.description : "",
										default: param.default,
										enumeratedValues: param.values,
									};
									parameters.push(parameter);
									paramFound = true;
									break;
								}
							}
						}
						if (!paramFound) {
							const parameter: Parameter = {
								name: multiSigParam,
								type: "any",
								dataType: DataType.Any,
								required: false,
								description: "",
							};
							parameters.push(parameter);
						}
					});
					const signatureInfo: Signature = {
						parameters: parameters,
					};
					signatures.push(signatureInfo);
				});
			}
		}
		else {
			if (this.params) {
				const parameters: Parameter[] = this.params.map((param: Param) => {
					return {
						name: param.name,
						type: param.type,
						dataType: getParamDataType(param.type.toLowerCase()),
						required: param.required,
						description: decode(param.description),
						default: param.default,
						enumeratedValues: param.values,
					};
				});
				const signatureInfo: Signature = {
					parameters: parameters,
				};
				signatures.push(signatureInfo);
			}
		}

		return {
			name: this.name,
			syntax: this.syntax,
			description: (this.description ? decode(this.description) : ""),
			returntype: getReturnDataType(this.returns ? this.returns.toLowerCase() : "any"),
			signatures: signatures,
		};
	}

	/**
	 * Returns a GlobalTag object based on this object
	 * @returns
	 */
	public toGlobalTag(): GlobalTag {
		const parameters: Parameter[] = this.params
			? this.params.map((param: Param) => {
					return {
						name: param.name,
						type: param.type,
						dataType: getParamDataType(param.type.toLowerCase()),
						required: param.required,
						description: decode(param.description),
						default: param.default,
						enumeratedValues: param.values,
					};
				})
			: [];

		const signatureInfo: Signature = {
			parameters: parameters,
		};
		const signatures: Signature[] = [];
		signatures.push(signatureInfo);

		return {
			name: this.name,
			syntax: this.syntax,
			scriptSyntax: this.script,
			description: (this.description ? decode(this.description) : ""),
			signatures: signatures,
			hasBody: true,
		};
	}

	/**
	 * Checks if this definition is compatible with given engine
	 * @param targetEngine The CFML engine with which to check compatibility
	 * @returns
	 */
	public isCompatible(targetEngine: CFMLEngine): boolean {
		const targetEngineVendor: CFMLEngineName = targetEngine.getName();

		// We want to check if this definition is compatible with the user's chosen CFML engine.
		// If this definition does not specify any engines, assume it is compatible with all engines.
		if (!this.engines) {
			return true;
		}

		// If the user hasn't specified an engine, we can assume that most definitions are compatible.
		if (targetEngineVendor === CFMLEngineName.Unknown) {
			// Get the set of engines supported by this definition.
			const engineSet = new Set(Object.keys(this.engines));
			// CFDocs provides compatibility info for some non-CFML engines, like BoxLang.
			// Any definitions that are not compatible with a CFML engine should not be shown.
			engineSet.delete("boxlang");
			const hasCompatibleEngine = engineSet.size > 0;
			return hasCompatibleEngine;
		}

		const vendorCompatibility: EngineCompatibilityDetail = this.engines[targetEngineVendor];
		if (!vendorCompatibility) {
			// Example: CFDocs has info for `arrayGetMetadata()`, but Lucee is not listed as a compatible engine (at least when this was written)
			return false;
		}

		const targetEngineVersion: string | undefined = targetEngine.getVersion();
		if (!targetEngineVersion) {
			// This definition may have a min or max version, but if the user hasn't specified an engine version, assume it is compatible.
			return true;
		}

		if (vendorCompatibility.minimum_version) {
			const earliestSupportedVersion: CFMLEngine = new CFMLEngine(targetEngineVendor, vendorCompatibility.minimum_version);
			if (targetEngine.isOlder(earliestSupportedVersion)) {
				// Example: `arraySplice()` has a minimum version of Lucee 6, or ColdFusion 2018.0.5
				return false;
			}
		}

		if (vendorCompatibility.removed) {
			const earliestUnsupportedEngine: CFMLEngine = new CFMLEngine(targetEngineVendor, vendorCompatibility.removed);
			if (targetEngine.isNewerOrEquals(earliestUnsupportedEngine)) {
				// Example: `GetBaseTemplatePath()` has been removed in ColdFusion 2025
				return false;
			}
		}

		// The definition is compatible with the user's engine and version
		return true;
	}

	/**
	 * Gets all function names documented by CFDocs. Once retrieved, they are statically stored.
	 * @returns
	 */
	public static async getAllFunctionNames(): Promise<string[]> {
		if (!CFDocsDefinitionInfo.allFunctionNames) {
			CFDocsDefinitionInfo.allFunctionNames = await CFDocsService.getAllFunctionNames();
		}

		return CFDocsDefinitionInfo.allFunctionNames;
	}

	/**
	 * Gets all tag names documented by CFDocs. Once retrieved, they are statically stored.
	 * @returns
	 */
	public static async getAllTagNames(): Promise<string[]> {
		if (!CFDocsDefinitionInfo.allTagNames) {
			CFDocsDefinitionInfo.allTagNames = await CFDocsService.getAllTagNames();
		}

		return CFDocsDefinitionInfo.allTagNames;
	}

	/**
	 * Returns whether the given identifier is the name of a function documented in CFDocs
	 * @param name The identifier to check for
	 * @returns
	 */
	public static async isFunctionName(name: string): Promise<boolean> {
		const allFunctionNames: string[] = await CFDocsDefinitionInfo.getAllFunctionNames();
		return allFunctionNames.includes(name.toLowerCase());
	}

	/**
	 * Returns whether the given identifier is the name of a tag documented in CFDocs
	 * @param name The identifier to check for
	 * @returns
	 */
	public static async isTagName(name: string): Promise<boolean> {
		const allTagNames: string[] = await CFDocsDefinitionInfo.getAllTagNames();
		return allTagNames.includes(name.toLowerCase());
	}

	/**
	 * Returns whether the given identifier is the name of a function or tag documented in CFDocs
	 * @param name The identifier to check for
	 * @returns
	 */
	public static async isIdentifier(name: string): Promise<boolean> {
		return (await CFDocsDefinitionInfo.isFunctionName(name) || await CFDocsDefinitionInfo.isTagName(name));
	}
}
