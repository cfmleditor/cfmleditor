import * as assert from "assert/strict";
import { DefinitionLink, Range, workspace } from "vscode";
import { rangeToString } from "./testUtils";

/**
 * Assert that the target of a DefinitionLink matches a given text string and surrounding context
 * @example
 * // Assert the text of the definition is "render", preceded by "function " and followed by "()"
 * assertDefinitionLinkTarget(definition, "function |render|()", "|")
 * //                                               ^      ^ cursors
 * @param definition The DefinitionLink to check
 * @param expected The expected text of the target, surrounded by the cursor character along with additional context
 * @param cursor The character representing the cursors in the search text.
 */
export async function assertDefinitionLinkTarget(definition: DefinitionLink, expected: string, cursor: string = "|") {
	assert.notStrictEqual(expected.length, 0, "expected must not be empty");
	assert.strictEqual(cursor.length, 1, "cursor must be a single character");
	const expectedParts = expected.split(cursor);
	assert.strictEqual(expectedParts.length - 1, 2, "cursor must appear exactly twice in the expected text");
	const [expectedBefore, , expectedAfter] = expectedParts;

	const doc = await workspace.openTextDocument(definition.targetUri);

	let actualBefore = "";
	if (expectedBefore.length > 0) {
		const newStartIndex = doc.offsetAt(definition.targetRange.start) - expectedBefore.length;
		const newStartPosition = doc.positionAt(newStartIndex);
		const beforeRange = new Range(newStartPosition, definition.targetRange.start);
		actualBefore = doc.getText(beforeRange);
	}

	const actualValue = doc.getText(definition.targetRange);

	let actualAfter = "";
	if (expectedAfter.length > 0) {
		const newEndIndex = doc.offsetAt(definition.targetRange.end) + expectedAfter.length;
		const newEndPosition = doc.positionAt(newEndIndex);
		const afterRange = new Range(definition.targetRange.end, newEndPosition);
		actualAfter = doc.getText(afterRange);
	}

	const actual = `${actualBefore}${cursor}${actualValue}${cursor}${actualAfter}`;
	assert.strictEqual(actual, expected);
}

/**
 * Asserts that two Range objects are equal by comparing their string representations.
 * @param actual The actual Range object to compare.
 * @param expected The expected Range object to compare against.
 */
export function assertRangeEqual(actual: Range, expected: Range) {
	assert.strictEqual(rangeToString(actual), rangeToString(expected), `Expected range ${rangeToString(expected)} but got ${rangeToString(actual)}`);
}

/**
 * Asserts that two arrays of Range objects are equal by comparing their string representations.
 * @param actual The actual array of Range objects to compare.
 * @param expected The expected array of Range objects to compare against.
 */
export function assertRangeArrayEqual(actual: Range[], expected: Range[]) {
	assert.deepEqual(actual.map(rangeToString), expected.map(rangeToString), `Expected ranges do not match.`);
}
