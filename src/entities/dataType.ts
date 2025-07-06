import { CancellationToken, Uri } from "vscode";
import { equalsIgnoreCase } from "../utils/textUtil";
import { componentPathToUri } from "./component";
import { queryValuePattern } from "./query";
import { functionValuePattern } from "./userFunction";

export enum DataType {
	Any = "any",
	Array = "array",
	Binary = "binary",
	Boolean = "boolean",
	Component = "component",
	Date = "date",
	Function = "function",
	GUID = "guid",
	Numeric = "numeric",
	Query = "query",
	String = "string",
	Struct = "struct",
	UUID = "uuid",
	VariableName = "variablename",
	Void = "void",
	XML = "xml",
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace DataType {
	/**
	 * Resolves a string value of data type to an enumeration member
	 * @param dataType The data type string to resolve
	 * @returns
	 */
	export function valueOf(dataType: string): DataType {
		switch (dataType.toLowerCase()) {
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
			case "void":
				return DataType.Void;
			case "xml":
				return DataType.XML;
			default:
				return DataType.Any;
		}
	}

	/**
	 * Resolves a string value of param type to an enumeration member
	 * @param paramType The param type string to resolve
	 * @returns
	 */
	export function paramTypeToDataType(paramType: string): DataType {
		switch (paramType.toLowerCase()) {
			case "any":
				return DataType.Any;
			case "array":
				return DataType.Array;
			case "binary":
				return DataType.Binary;
			case "boolean":
				return DataType.Boolean;
			/*
			case "component":
				return DataType.Component;
			*/
			case "date": case "eurodate": case "usdate":
				return DataType.Date;
			case "function":
				return DataType.Function;
			case "guid":
				return DataType.GUID;
			case "numeric": case "float": case "integer": case "range":
				return DataType.Numeric;
			case "query":
				return DataType.Query;
			case "string": case "creditcard": case "email": case "regex": case "regular_expression":
			case "ssn": case "social_security_number": case "telephone": case "url": case "zipcode":
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
				return DataType.Any;
		}
	}

	/**
	 * Validates whether a string is numeric
	 * @param numStr A string to check
	 * @returns
	 */
	export function isNumeric(numStr: string): boolean {
		let numStrTest: string = numStr;
		if (/^(["'])[0-9.]+\1$/.test(numStrTest)) {
			numStrTest = numStrTest.slice(1, -1);
		}
		return (!isNaN(parseFloat(numStrTest)) && isFinite(parseFloat(numStrTest)));
	}

	/**
	 * Validates whether a string is a string literal
	 * @param str A string to check
	 * @returns
	 */
	export function isStringLiteral(str: string): boolean {
		const trimmedStr: string = str.trim();

		return (trimmedStr.length > 1 && ((trimmedStr.startsWith("'") && trimmedStr.endsWith("'")) || (trimmedStr.startsWith("\"") && trimmedStr.endsWith("\""))));
	}

	/**
	 * Gets the string literal value from the given CFML string literal
	 * @param str A string literal from which to get the string value
	 * @returns
	 */
	export function getStringLiteralValue(str: string): string {
		let trimmedStr: string = str.trim();
		const stringDelimiter: string = trimmedStr.charAt(0);
		trimmedStr = trimmedStr.slice(1, -1);
		let stringValue: string = "";

		let previousChar: string = "";
		let currentChar: string = "";
		for (let idx = 0; idx < trimmedStr.length; idx++) {
			currentChar = trimmedStr.charAt(idx);

			// Skip if escaped
			if (previousChar === stringDelimiter && currentChar === stringDelimiter) {
				previousChar = "";
				continue;
			}

			stringValue += currentChar;

			previousChar = currentChar;
		}

		return stringValue;
	}

	/**
	 * Checks whether a string is a valid data type
	 * @param dataType A string to check
	 * @returns
	 */
	function isDataType(dataType: string): boolean {
		return (dataType && (equalsIgnoreCase(dataType, "any") || valueOf(dataType) !== DataType.Any)) ? true : false;
	}

	/**
	 * Returns the truthy value of a string
	 * @param boolStr A string to evaluate
	 * @returns
	 */
	export function isTruthy(boolStr: string): boolean {
		if (equalsIgnoreCase(boolStr, "true") || equalsIgnoreCase(boolStr, "yes")) {
			return true;
		}
		if (isNumeric(boolStr)) {
			return (parseFloat(boolStr) !== 0);
		}

		return false;
	}

	/**
	 * Gets the data type and if applicable component URI from given string.
	 * @param dataType The string to check
	 * @param documentUri The document's URI that contains this type string
	 * @param _token
	 * @returns
	 */
	export async function getDataTypeAndUri(dataType: string, documentUri: Uri, _token: CancellationToken | undefined): Promise<[DataType | undefined, Uri | undefined]> {
		if (!dataType) {
			return [undefined, undefined];
		}

		if (isDataType(dataType)) {
			return [valueOf(dataType), undefined];
		}
		else {
			const typeUri: Uri | undefined = await componentPathToUri(dataType, documentUri, _token);
			if (typeUri) {
				return [DataType.Component, typeUri];
			}
		}

		return [undefined, undefined];
	}

	/**
	 * Analyzes the given value to try to infer its type
	 * @param value The value to analyze
	 * @param documentUri The URI of the document containing the value
	 * @param _token
	 * @returns
	 */
	export async function inferDataTypeFromValue(value: string, documentUri: Uri, _token: CancellationToken | undefined): Promise<[DataType | undefined, Uri | undefined]> {
		if (value.length === 0) {
			return [DataType.String, undefined];
		}

		if (/^(['"])?(false|true|no|yes)\1$/i.test(value)) {
			return [DataType.Boolean, undefined];
		}

		if (isNumeric(value)) {
			return [DataType.Numeric, undefined];
		}

		if (/^(["'])(?!#)/.test(value)) {
			return [DataType.String, undefined];
		}

		if (functionValuePattern.test(value)) {
			return [DataType.Function, undefined];
		}

		if (/^(?:["']\s*#\s*)?(arrayNew\(|\[)/i.test(value)) {
			return [DataType.Array, undefined];
		}

		if (queryValuePattern.test(value)) {
			return [DataType.Query, undefined];
		}

		if (/^(?:["']\s*#\s*)?(structNew\(|\{)/i.test(value)) {
			return [DataType.Struct, undefined];
		}

		if (/^(?:["']\s*#\s*)?(createDate(Time)?\()/i.test(value)) {
			return [DataType.Date, undefined];
		}

		const objectMatch1 = /^(?:["']\s*#\s*)?(createObject\((["'])component\2\s*,\s*(["'])([^'"]+)\3)/i.exec(value);
		if (objectMatch1) {
			const [dataType, uri]: [DataType | undefined, Uri | undefined] = await getDataTypeAndUri(objectMatch1[4], documentUri, _token);
			if (dataType) {
				return [dataType, uri];
			}
			return [DataType.Component, undefined];
		}

		const objectMatch2 = /^(?:["']\s*#\s*)?(new\s+(["'])?([^\s'"(]+)\2\()/i.exec(value);
		if (objectMatch2) {
			const [dataType, uri]: [DataType | undefined, Uri | undefined] = await getDataTypeAndUri(objectMatch2[3], documentUri, _token);
			if (dataType) {
				return [dataType, uri];
			}
			return [DataType.Component, undefined];
		}

		const objectMatch3 = /^(?:["']\s*#\s*)?(createObject(?:\(\s*(?!["'](?:component|com|java|corba|webservice)["']))(["'])([^'"]+)\2)/i.exec(value);
		if (objectMatch3) {
			const [dataType, uri]: [DataType | undefined, Uri | undefined] = await getDataTypeAndUri(objectMatch3[3], documentUri, _token);
			if (dataType) {
				return [dataType, uri];
			}
			return [DataType.Component, undefined];
		}

		// TODO: Check against functions and use its return type

		return [DataType.Any, undefined];
	}
}
