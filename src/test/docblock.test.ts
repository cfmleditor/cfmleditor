import { Uri, Range } from "vscode";
import { LSTextDocument } from "../utils/LSTextDocument";
import dedent from "string-dedent";
import { parseDocBlock } from "../entities/docblock";
import { assertDocBlockArrayEqual } from "./testAssertions";
import assert from "assert";
import { DocBlockToString as docBlockToString } from "./testUtils";

/**
 * Helper function to get the internal range of a docblock comment.
 *
 * This range excludes the opening /** and closing &#42;/ of the docblock.
 * @param doc The document to get the docblock range from
 * @returns The internal range of the docblock in the document for use with `parseDocBlock`.
 */
function getDocBlockRange(doc: LSTextDocument): Range {
	const text = doc.getText();
	const startOffset = text.indexOf("/**") + 3;
	const endOffset = text.lastIndexOf("*/");
	assert.notStrictEqual(startOffset, -1, "Docblock start not found");
	assert.notStrictEqual(endOffset, -1, "Docblock end not found");
	assert.ok(endOffset > startOffset, "Docblock end must be after start");
	return new Range(doc.positionAt(startOffset), doc.positionAt(endOffset));
}

/*
 * Tests for the helper function `docBlockToString`
 * These can be removed once the tests are stable.
 */
describe("docBlockToString", function () {
	it("should return lone key if nothing else is set", function () {
		assert.equal(docBlockToString({ key: "Foo", value: "" }), "[Foo]");
	});
	it("should return special value if there is no key", function () {
		assert.equal(docBlockToString({ key: "", value: "" }), "[<NO_KEY>]");
	});
	it("should return key = value", function () {
		assert.equal(docBlockToString({ key: "Foo", value: "Bar" }), "[Foo] = [Bar]");
	});
	it("should return key with subkey", function () {
		assert.equal(docBlockToString({ key: "Foo", subkey: "Bar", value: "" }), "[Foo].[Bar]");
	});
	it("should return key with type", function () {
		assert.equal(docBlockToString({ key: "Foo", type: "bool", value: "" }), "[Foo] : [bool]");
	});
	it("should ignore valueRange", function () {
		assert.equal(docBlockToString({ key: "Foo", valueRange: new Range(0, 1, 2, 3), value: "" }), "[Foo]");
	});
	it("should combine everything", function () {
		assert.equal(docBlockToString({ key: "Foo", subkey: "Bar", type: "bool", value: "Bop" }), "[Foo].[Bar] : [bool] = [Bop]");
	});
});

describe("parseDocBlock", function () {
	it("should parse one liner", function () {
		const doc = new LSTextDocument(Uri.parse("untitled"), "cfml", 1, dedent`
		/** foo */
		`);
		const range = getDocBlockRange(doc);
		const values = parseDocBlock(doc, range);
		assertDocBlockArrayEqual(values, [
			{ key: "hint", value: "foo" },
		]);
	});

	it("should parse description as hint", function () {
		const doc = new LSTextDocument(Uri.parse("untitled"), "cfml", 1, dedent`
		/**
		 * foo
		 */
		`);
		const range = getDocBlockRange(doc);
		const values = parseDocBlock(doc, range);
		assertDocBlockArrayEqual(values, [
			{ key: "hint", value: "foo" },
		]);
	});

	it("should parse multi-line description", function () {
		const doc = new LSTextDocument(Uri.parse("untitled"), "cfml", 1, dedent`
		/**
		 * foo
		 * bar
		 */
		`);
		const range = getDocBlockRange(doc);
		const values = parseDocBlock(doc, range);
		assertDocBlockArrayEqual(values, [
			{ key: "hint", value: "foo\nbar" },
		]);
	});

	it("should use hint instead of description", function () {
		const doc = new LSTextDocument(Uri.parse("untitled"), "cfml", 1, dedent`
		/**
		 * Description
		 * @hint Hint
		 */
		`);
		const range = getDocBlockRange(doc);
		const values = parseDocBlock(doc, range);
		assertDocBlockArrayEqual(values, [
			{ key: "hint", value: "Hint" },
		]);
	});

	it("should include all non-param lines in description", function () {
		const doc = new LSTextDocument(Uri.parse("untitled"), "cfml", 1, dedent`
		/**
		 * foo
		 * @param1 subkey value
		 * bar
		 */
		`);
		const range = getDocBlockRange(doc);
		const values = parseDocBlock(doc, range);
		assertDocBlockArrayEqual(values, [
			{ key: "hint", value: "foo\nbar" },
			{ key: "param1", value: "description" },
		]);
	});

	it("should parse param without description", function () {
		const doc = new LSTextDocument(Uri.parse("untitled"), "cfml", 1, dedent`
		/**
		 * @return foo bar bop
		 */
		`);
		const range = getDocBlockRange(doc);
		const values = parseDocBlock(doc, range);
		assertDocBlockArrayEqual(values, [
			{ key: "return", value: "foo bar bop" },
		]);
	});

	it("should parse lone param", function () {
		const doc = new LSTextDocument(Uri.parse("untitled"), "cfml", 1, dedent`
		/**
		 * Foo
		 * @return
		 */
		`);
		const range = getDocBlockRange(doc);
		const values = parseDocBlock(doc, range);
		assertDocBlockArrayEqual(values, [
			{ key: "hint", value: "Foo" },
			{ key: "return", value: "" },
		]);
	});

	it("should parse param with description", function () {
		const doc = new LSTextDocument(Uri.parse("untitled"), "cfml", 1, dedent`
		/**
		 * Foo
		 * @return Bar
		 */
		`);
		const range = getDocBlockRange(doc);
		const values = parseDocBlock(doc, range);
		assertDocBlockArrayEqual(values, [
			{ key: "hint", value: "Foo" },
			{ key: "return", value: "Bar" },
		]);
	});
});
