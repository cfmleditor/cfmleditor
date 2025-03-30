import { MarkdownString, Range, TextDocument, Position, CancellationToken } from "vscode";
import { getDocumentContextRanges, isCfcFile } from "./contextUtil";
import { getComponent, hasComponent } from "../features/cachedEntities";
import { AttributeQuoteType } from "../entities/attribute";

export enum Quote {
	Single = "single",
	Double = "double",
}

/**
 * Returns the quote of the given type
 * @param quote quote to return string literal
 * @returns string literal for type of quote
 */
export function getQuote(quote: Quote | AttributeQuoteType): string {
	let quoteStr: string = "";

	switch (quote) {
		case Quote.Single:
			quoteStr = "'";
			break;
		case Quote.Double:
			quoteStr = "\"";
			break;
		default:
			break;
	}

	return quoteStr;
}

/**
 * Returns whether the strings are equal ignoring case
 * @param string1 A string to compare
 * @param string2 A string to compare
 * @returns boolean
 */
export function equalsIgnoreCase(string1: string, string2: string): boolean {
	if (string1 === undefined || string2 === undefined) {
		return false;
	}
	return string1.toLowerCase() === string2.toLowerCase();
}

/**
 * Transforms text to Markdown-compatible string
 * @param text A candidate string
 * @returns string
 */
export function textToMarkdownCompatibleString(text: string): string {
	return text.replace(/\n(?!\n)/g, "  \n");
}

/**
 * Transforms text to MarkdownString
 * @param text A candidate string
 * @returns MarkdownString
 */
export function textToMarkdownString(text: string): MarkdownString {
	return new MarkdownString(textToMarkdownCompatibleString(text));
}

/**
 * Escapes special markdown characters
 * @param text A candidate string
 * @returns string
 */
export function escapeMarkdown(text: string): string {
	return text.replace(/[\\`*_{}[\]()#+\-.!]/g, "\\$&");
}

/**
 * Returns a text document's text with all non-whitespace characters within a given range replaced with spaces
 * @param document The text document in which to replace
 * @param ranges The range within which to replace text
 * @returns string
 */
export function replaceRangeWithSpaces(document: TextDocument, ranges: Range[]): string {
	let documentText: string = document.getText();
	const stringRegex: RegExp = /\S/g;

	ranges.forEach((range: Range) => {
		const rangeStartOffset: number = document.offsetAt(range.start);
		const rangeEndOffset: number = document.offsetAt(range.end);
		documentText = documentText.substring(0, rangeStartOffset)
			+ documentText.substring(rangeStartOffset, rangeEndOffset).replace(stringRegex, " ")
			+ documentText.substring(rangeEndOffset, documentText.length);
	});

	return documentText;
}

/**
 * Returns a text document's text replacing all comment text with whitespace.
 * @param document The text document from which to get text
 * @param commentRanges Optional ranges in which there are CFML comments
 * @param replaceComments Replace comments before parsing
 * @param _token
 * @returns string
 */
export function getSanitizedDocumentText(document: TextDocument, commentRanges: Range[], replaceComments: boolean = false, _token: CancellationToken | undefined): string {
	if (replaceComments !== true) {
		return document.getText();
	}
	let documentCommentRanges: Range[];
	if (commentRanges) {
		documentCommentRanges = commentRanges;
	}
	else {
		const docIsScript: boolean = (isCfcFile(document, _token) && hasComponent(document.uri, _token) && (getComponent(document.uri, _token))?.isScript) ? true : false;
		documentCommentRanges = getDocumentContextRanges(document, docIsScript, undefined, false, _token).commentRanges;
	}

	return replaceRangeWithSpaces(document, documentCommentRanges);
}

/**
 * Returns a text document's text before given position. Optionally replaces all comment text with whitespace.
 * @param document The text document in which to replace
 * @param position The position that marks the end of the document's text to return
 * @param replaceComments Whether the text should have comments replaced
 * @param _token
 * @returns string
 */
export function getPrefixText(document: TextDocument, position: Position, replaceComments: boolean = false, _token: CancellationToken | undefined): string {
	let documentText: string = document.getText();
	if (replaceComments) {
		documentText = getSanitizedDocumentText(document, [], false, _token);
	}

	return documentText.slice(0, document.offsetAt(position));
}

// RFC 2396, Appendix A: https://www.ietf.org/rfc/rfc2396.txt
const schemePattern = /^[a-zA-Z][a-zA-Z0-9+\-.]+:/;

/**
 * A valid uri starts with a scheme and the scheme has at least 2 characters so that it doesn't look like a drive letter.
 * @param str The candidate URI to check
 * @returns boolean
 */
export function isUri(str: string): boolean {
	return str && schemePattern.test(str) ? true : false;
}
