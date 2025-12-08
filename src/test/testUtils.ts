import assert from "assert/strict";
import { TextDocument, Position, commands, DefinitionLink, Range } from "vscode";

/**
 * Normalize a path to use forward slashes for cross-platform comparison.
 * @param path The path to normalize
 * @returns The path with all backslashes replaced by forward slashes
 */
export function normalizePath(path: string): string {
	return path.replace(/\\/g, "/");
}

/**
 * Get a position in the document based on a search text and a cursor
 *
 * This is intended to be easy to read and write than hardcoded positions.
 * @example
 * // Get the position of the "1" in the text "var foo = 123;" in the TextDocument
 * findPosition(doc, "var foo = |123;", "|")
 * //                           ^ cursor
 * @param doc The document to search in
 * @param search The text to search for in the document
 * @param cursor The character representing the cursor in the search text.
 * @throws {Error} If the search text does not contain the cursor, or the search text is not found in the document
 * @returns The position of the cursor in the doc.
 */
export function findPosition(doc: TextDocument, search: string, cursor: string = "|"): Position {
	const documentText: string = doc.getText();

	// Assertion
	assert.notStrictEqual(documentText, 0, "Doc must not be empty");
	assert.notStrictEqual(search.length, 0, "Text must not be empty");
	assert.strictEqual(cursor.length, 1, "Cursor must be a single character");
	assert.strictEqual(search.split(cursor).length - 1, 1, "Cursor must appear exactly once in the text");

	// Find the cursor in the text, so we can return it's position relative to found text
	const cursorIndex = search.indexOf(cursor);
	if (cursorIndex === -1) {
		throw new Error(`Cursor "${cursor}" not found in text`);
	}

	// The cursor is not part of the search text, so we need to remove it
	const searchText = search.replace(cursor, "");

	assert.strictEqual(documentText.split(searchText).length - 1, 1, `Text "${searchText}" must appear exactly once in the document`);

	// Find the search text in the document
	const index = documentText.indexOf(searchText);

	// Calculate the position of the cursor relative to the found text
	const endPos = doc.positionAt(index + cursorIndex);
	return endPos;
}

/**
 * Get exactly 1 definition for a cursor position in a document
 * @example
 * // Get the definition for "Widget" in the text "var foo = new Widget;" in the TextDocument
 * findDefinition(doc, "var foo = new |Widget;", "|")
 * //                                 ^ cursor
 * @param doc The document to search in
 * @param search The text to search for in the document
 * @param cursor The character representing the cursor in the search text.
 * @param matches Length of the expected definition array
 * @param posn position of defitions to return
 * @throws {Error} Same as {@link findPosition}, and if no definition is found, or more than one definition is found
 * @returns The position of the cursor in the doc.
 */
export async function findDefinition(doc: TextDocument, search: string, cursor: string = "|", matches: number = 1, posn: number = 0): Promise<DefinitionLink> {
	const position = findPosition(doc, search, cursor);
	const definitions = await commands.executeCommand<DefinitionLink[]>("vscode.executeDefinitionProvider", doc.uri, position);
	assert.ok(definitions.length !== 0, "Did not find a definition");
	assert.strictEqual(definitions.length, matches, "Expected exactly one definition");
	return definitions[posn];
}

/**
 * Converts a Range object to a string representation.
 *
 * Math notation: square brackets [ ] mean inclusive, parentheses ( ) mean exclusive.
 *
 * For example, the "Foo" in "FooBar" is represented as "[0:0 -> 0:3)". Character 0 "F" is included, and character 3 "B" is excluded.
 * @param range The range to convert to a string
 * @returns A string representation of the range in the format "[startLine:startCharacter -> endLine:endCharacter)"
 */
export function rangeToString(range: Range): string {
	return `[${range.start.line}:${range.start.character} -> ${range.end.line}:${range.end.character})`;
};
