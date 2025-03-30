import { Range, TextDocument } from "vscode";
import { MyMap, MySet, NameWithOptionalValue } from "../utils/collections";

export const ATTRIBUTES_PATTERN = /\b([\w:-]+)\b(?:(\s*(?:=|:)\s*)(?:(['"])(.*?)\3|([\w$:.]+)))?/gi;
export const VALUE_PATTERN = /\b([\w:-]+)\s*(?:=|:)\s*(?:(['"])?((?:(?!\2).)*)|([\S]*))$/;

export interface Attribute {
	name: string; // lowercased
	value: string;
	// range: Range;
	valueRange: Range;
}

export enum IncludeAttributesSetType {
	None = "none",
	Required = "required",
	All = "all",
}

// Extends Quote from textUtils.ts
export enum AttributeQuoteType {
	None = "none",
	Double = "double",
	Single = "single",
}

export interface IncludeAttributesCustom {
	[name: string]: NameWithOptionalValue<string>[]; // lowercased name
}

// Collection of attributes. Key is attribute name lowercased
export class Attributes extends MyMap<string, Attribute> { }

/**
 * Gets a regular expression that matches an attribute with the given name
 * @param attributeName The attribute name to use for the pattern
 * @returns
 */
export function getAttributePattern(attributeName: string): RegExp {
	return new RegExp(`\\b${attributeName}\\s*=\\s*(?:['"])?`, "i");
}

/**
 * Parses a given attribute string and returns an object representation
 * @param document A text document containing attributes
 * @param attributeRange A range in which the attributes are found
 * @param validAttributeNames A set of valid names
 * @returns
 */
export function parseAttributes(document: TextDocument, attributeRange: Range, validAttributeNames?: MySet<string>): Attributes {
	const attributeStr: string = document.getText(attributeRange);
	const attributes: Attributes = new Attributes();
	let attributeMatch: RegExpExecArray | null;
	while ((attributeMatch = ATTRIBUTES_PATTERN.exec(attributeStr))) {
		const attributeName = attributeMatch[1];
		if (validAttributeNames && !validAttributeNames.has(attributeName.toLowerCase())) {
			continue;
		}
		const separator: string = attributeMatch[2];
		const quotedValue: string = attributeMatch[4];
		const unquotedValue: string = attributeMatch[5];
		const attributeValue: string = quotedValue !== undefined ? quotedValue : unquotedValue;

		let attributeValueOffset: number;
		let attributeValueRange: Range | undefined;
		if (attributeValue) {
			attributeValueOffset = document.offsetAt(attributeRange.start) + attributeMatch.index + attributeName.length
				+ separator.length + (quotedValue !== undefined ? 1 : 0);
			attributeValueRange = new Range(
				document.positionAt(attributeValueOffset),
				document.positionAt(attributeValueOffset + attributeValue.length)
			);
		}

		if (attributeValueRange) {
			attributes.set(attributeName.toLowerCase(), {
				name: attributeName,
				value: attributeValue,
				valueRange: attributeValueRange,
			});
		}
	}

	return attributes;
}
