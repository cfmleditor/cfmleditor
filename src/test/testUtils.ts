import { TextDocument, Position } from "vscode";

/**
 * Get a position in the document based on a search text and a cursor
 *
 * This is intended to be easy to read and write than hardcoded positions.
 * @example
 * // Get the position of the "1" in the text "var foo = 123;" in the TextDocument
 * findPosition(doc, "var foo = |123;", "|")
 * @param doc The document to search in
 * @param text The text to search for
 * @param cursor The character representing the cursor in the text
 * @throws If the text does not contain the cursor, or the text is not found in the document
 * @returns The position of the cursor in the doc.
 */
export function findPosition(doc: TextDocument, text: string, cursor: string = "|"): Position {
    // Find the cursor in the text, so we can return it's position relative to found text
    const cursorIndex = text.indexOf(cursor);
    if (cursorIndex === -1) {
        throw new Error(`Cursor "${cursor}" not found in text`);
    }

    // The cursor is not part of the search text, so we need to remove it
    const searchText = text.replace(cursor, "");

    // Find the search text in the document
    const index = doc.getText().indexOf(searchText);
    if (index === -1) {
        throw new Error(`Text "${searchText}" not found in document`);
    }

    // Calculate the position of the cursor relative to the found text
    const endPos = doc.positionAt(index + cursorIndex);
    return endPos;
}
