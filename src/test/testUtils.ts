import assert from "assert/strict";
import { TextDocument, Position } from "vscode";

/**
 * Get a position in the document based on a search text and a cursor
 *
 * This is intended to be easy to read and write than hardcoded positions.
 * @example
 * // Get the position of the "1" in the text "var foo = 123;" in the TextDocument
 * findPosition(doc, "var foo = |123;", "|")
 * @param doc The document to search in
 * @param search The text to search for in the document
 * @param cursor The character representing the cursor in the search text.
 * @throws If the search text does not contain the cursor, or the search text is not found in the document
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
