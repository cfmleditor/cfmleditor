import { IHTMLDataProvider, ITagData, IAttributeData } from "./htmlLanguageTypes";
import { HTMLDataProvider } from "./dataProvider";
import { HTML5_TAGS, HTML5_GLOBAL_ATTRIBUTES, HTML5_EVENTS, HTML5_VALUE_MAP } from "./data/html5";
import { equalsIgnoreCase } from "../../utils/textUtil";

export const htmlDataProvider: IHTMLDataProvider = new HTMLDataProvider("html5", {
	version: 1,
	tags: HTML5_TAGS,
	globalAttributes: HTML5_GLOBAL_ATTRIBUTES.concat(HTML5_EVENTS),
	valueSets: HTML5_VALUE_MAP,
});

// Recreate maps since they are private
const htmlTagMap: { [t: string]: ITagData } = {};

HTML5_TAGS.forEach((t) => {
	htmlTagMap[t.name] = t;
});

/**
 * Whether the given name is a known HTML tag
 * @param name Tag name to check
 * @returns
 */
export function isKnownTag(name: string): boolean {
	return name.toLowerCase() in htmlTagMap;
}

// isStandardTag (when status becomes available)

/**
 * Gets HTML tag data
 * @param name The tag name
 * @returns
 */
export function getTag(name: string): ITagData | undefined {
	return htmlTagMap[name.toLowerCase()];
}

/**
 * Whether the tag with the given name has an attribute with the given name
 * @param tagName The tag name
 * @param attributeName The attribute name
 * @returns
 */
export function hasAttribute(tagName: string, attributeName: string): boolean {
	return htmlDataProvider.provideAttributes(tagName.toLowerCase()).some((attr: IAttributeData) => {
		return equalsIgnoreCase(attr.name, attributeName);
	});
}

/**
 * Gets HTML tag attribute data
 * @param tagName The tag name
 * @param attributeName The attribute name
 * @returns
 */
export function getAttribute(tagName: string, attributeName: string): IAttributeData | undefined {
	return htmlDataProvider.provideAttributes(tagName.toLowerCase()).find((attr: IAttributeData) => {
		return equalsIgnoreCase(attr.name, attributeName);
	});
}
