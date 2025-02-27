import { CancellationToken, Location, Range, TextDocument, Uri } from "vscode";
import { MyMap, MySet } from "../utils/collections";
import { Attributes, parseAttributes } from "./attribute";
import { DataType } from "./dataType";
import { DocBlockKeyValue, parseDocBlock } from "./docblock";
import { Access, UserFunction, UserFunctionSignature } from "./userFunction";
import { DocumentStateContext } from "../utils/documentUtil";

const propertyPattern: RegExp = /((\/\*\*((?:\*(?!\/)|[^*])*)\*\/\s+)?(?:<cf|[\s\t])property\b)\s((?!=)[^;>]*)/gi;
// const attributePattern: RegExp = /\b(\w+)\b(?:\s*=\s*(?:(['"])(.*?)\2|([a-z0-9:.]+)))?/gi;

const propertyAttributeNames: MySet<string> = new MySet([
	"name",
	"displayname",
	"hint",
	"default",
	"required",
	"type",
	"serializable",
	"getter",
	"setter",
]);
const booleanAttributes: MySet<string> = new MySet([
	"getter",
	"setter",
]);

export interface Property {
	name: string;
	dataType: DataType;
	dataTypeComponentUri?: Uri; // Only when dataType is Component
	description?: string;
	getter?: boolean;
	setter?: boolean;
	nameRange: Range;
	dataTypeRange?: Range;
	propertyRange: Range;
	default?: string;
}

// Collection of properties for a particular component. Key is property name lowercased.
export class Properties extends MyMap<string, Property> { }

/**
 * Returns an array of Property objects that define properties within the given component
 * @param documentStateContext The document to parse which should represent a component
 * @param _token
 * @returns
 */
export async function parseProperties(documentStateContext: DocumentStateContext, _token: CancellationToken): Promise<Properties> {
	const properties: Properties = new Properties();
	const document: TextDocument = documentStateContext.document;
	const componentText: string = document.getText();
	let propertyMatch: RegExpExecArray | null;
	// eslint-disable-next-line no-cond-assign
	while (propertyMatch = propertyPattern.exec(componentText)) {
		const propertyAttributePrefix: string = propertyMatch[1];
		const propertyFullDoc: string = propertyMatch[2];
		const propertyDocContent: string = propertyMatch[3];
		const propertyAttrs: string = propertyMatch[4];
		const property: Property = {
			name: "",
			dataType: DataType.Any,
			description: "",
			nameRange: new Range(
				document.positionAt(propertyMatch.index),
				document.positionAt(propertyMatch.index + propertyMatch[0].length)
			),
			propertyRange: new Range(
				document.positionAt(propertyMatch.index),
				document.positionAt(propertyMatch.index + propertyMatch[0].length + 1)
			),
		};

		if (propertyFullDoc) {
			const propertyDocBlockParsed: DocBlockKeyValue[] = parseDocBlock(document,
				new Range(
					document.positionAt(propertyMatch.index + 3),
					document.positionAt(propertyMatch.index + 3 + propertyDocContent.length)
				)
			);

			for (const docElem of propertyDocBlockParsed) {
				const activeKey: string = docElem.key;
				if (activeKey === "type") {
					const [dataType, dataTypeComponentUri]: [DataType, Uri] = await DataType.getDataTypeAndUri(docElem.value, document.uri, _token);
					if (dataType) {
						property.dataType = dataType;
						if (dataTypeComponentUri) {
							property.dataTypeComponentUri = dataTypeComponentUri;
						}

						property.dataTypeRange = docElem.valueRange;
					}
				}
				else if (activeKey === "hint") {
					property.description = docElem.value;
				}
				else if (booleanAttributes.has(activeKey)) {
					property[activeKey] = DataType.isTruthy(docElem.value);
				}
				else {
					property[activeKey] = docElem.value;
				}
			}
		}

		if (/=/.test(propertyAttrs)) {
			const propertyAttributesOffset: number = propertyMatch.index + propertyAttributePrefix.length;
			const propertyAttributeRange = new Range(
				document.positionAt(propertyAttributesOffset),
				document.positionAt(propertyAttributesOffset + propertyAttrs.length)
			);
			const parsedPropertyAttributes: Attributes = parseAttributes(document, propertyAttributeRange, propertyAttributeNames);
			if (!parsedPropertyAttributes.has("name")) {
				continue;
			}

			for (const [attrKey, attr] of parsedPropertyAttributes) {
				if (attrKey === "name") {
					property.name = attr.value;
					property.nameRange = attr.valueRange;
				}
				else if (attrKey === "type") {
					const [dataType, dataTypeComponentUri]: [DataType, Uri] = await DataType.getDataTypeAndUri(attr.value, document.uri, _token);
					if (dataType) {
						property.dataType = dataType;
						if (dataTypeComponentUri) {
							property.dataTypeComponentUri = dataTypeComponentUri;
						}

						property.dataTypeRange = attr.valueRange;
					}
				}
				else if (attrKey === "hint") {
					property.description = attr.value;
				}
				else if (booleanAttributes.has(attrKey)) {
					property[attrKey] = DataType.isTruthy(attr.value);
				}
				else {
					property[attrKey] = attr.value;
				}
			}
		}
		else {
			const parsedPropertyAttributes: RegExpExecArray = /\s*(\S+)\s+([\w$]+)\s*$/.exec(propertyAttrs);
			if (!parsedPropertyAttributes) {
				continue;
			}

			const dataTypeString: string = parsedPropertyAttributes[1];
			const [dataType, dataTypeComponentUri]: [DataType, Uri] = await DataType.getDataTypeAndUri(dataTypeString, document.uri, _token);
			if (dataType) {
				property.dataType = dataType;
				if (dataTypeComponentUri) {
					property.dataTypeComponentUri = dataTypeComponentUri;
				}
			}
			property.name = parsedPropertyAttributes[2];

			const removedName: string = propertyMatch[0].slice(0, -property.name.length);
			const nameAttributeOffset: number = propertyMatch.index + removedName.length;
			property.nameRange = new Range(
				document.positionAt(nameAttributeOffset),
				document.positionAt(nameAttributeOffset + property.name.length)
			);

			const dataTypeOffset: number = propertyMatch.index + removedName.lastIndexOf(dataTypeString);
			property.dataTypeRange = new Range(
				document.positionAt(dataTypeOffset),
				document.positionAt(dataTypeOffset + dataTypeString.length)
			);
		}

		if (property.name) {
			properties.set(property.name.toLowerCase(), property);
		}
	}

	return properties;
}

/**
 * Constructs the getter implicit function for the given component property
 * @param property The component property for which to construct the getter
 * @param componentUri The URI of the component in which the property is defined
 * @returns
 */
export function constructGetter(property: Property, componentUri: Uri): UserFunction {
	return {
		access: Access.Public,
		static: false,
		abstract: false,
		final: false,
		bodyRange: undefined,
		name: "get" + property.name.charAt(0).toUpperCase() + property.name.slice(1),
		description: property.description,
		returntype: property.dataType,
		returnTypeUri: property.dataTypeComponentUri,
		nameRange: property.nameRange,
		signatures: [{ parameters: [] }],
		location: new Location(componentUri, property.propertyRange),
		isImplicit: true,
	};
}

/**
 * Constructs the setter implicit function for the given component property
 * @param property The component property for which to construct the setter
 * @param componentUri The URI of the component in which the property is defined
 * @returns
 */
export function constructSetter(property: Property, componentUri: Uri): UserFunction {
	const implicitFunctionSignature: UserFunctionSignature = {
		parameters: [
			{
				name: property.name,
				type: property.dataType.toString(),
				nameRange: undefined,
				description: property.description,
				required: true,
				dataType: property.dataType,
				dataTypeComponentUri: property.dataTypeComponentUri,
				default: property.default,
			},
		],
	};

	return {
		access: Access.Public,
		static: false,
		abstract: false,
		final: false,
		bodyRange: undefined,
		name: "set" + property.name.charAt(0).toUpperCase() + property.name.slice(1),
		description: property.description,
		returntype: DataType.Component,
		returnTypeUri: componentUri,
		nameRange: property.nameRange,
		signatures: [implicitFunctionSignature],
		location: new Location(componentUri, property.propertyRange),
		isImplicit: true,
	};
}
