import { Uri, Range } from "vscode";
import { assertRangeArrayEqual } from "./testAssertions";
import { getDocumentContextRanges } from "../utils/contextUtil";
import { LSTextDocument } from "../utils/LSTextDocument";
import dedent from "string-dedent";

describe("getDocumentContextRanges", function () {
	describe("accurate", function () {
		generateTests_getDocumentContextRanges(false);
	});
	describe("fast", function () {
		generateTests_getDocumentContextRanges(true);
	});
});

function generateTests_getDocumentContextRanges(fast: boolean) {
	const isScript = true;
	const token = undefined;
	const docRange = undefined;
	const exclDocumentRanges = undefined;
	it("should parse single-line comment", function () {
		const doc = new LSTextDocument(Uri.parse("untitled"), "cfml", 1, dedent`
		// Foo
		a = 1;
		`);
		const contextRanges = getDocumentContextRanges(doc, isScript, docRange, fast, token, exclDocumentRanges);
		const comments = contextRanges.commentRanges;
		assertRangeArrayEqual(comments, [
			new Range(0, 0, 0, 6),
		]);
	});

	it("should parse adjacent single-line comments separately", function () {
		const doc = new LSTextDocument(Uri.parse("untitled"), "cfml", 1, dedent`
		// Foo
		// Floop
		a = 1;
		`);
		const contextRanges = getDocumentContextRanges(doc, isScript, docRange, fast, token, exclDocumentRanges);
		const comments = contextRanges.commentRanges;
		assertRangeArrayEqual(comments, [
			new Range(0, 0, 0, 6),
			new Range(1, 0, 1, 8),
		]);
	});

	it("should parse line comment on last line (no trailing newline)", function () {
		const doc = new LSTextDocument(Uri.parse("untitled"), "cfml", 1, dedent`
		a = 1;
		// Foo
		`);
		const contextRanges = getDocumentContextRanges(doc, isScript, docRange, fast, token, exclDocumentRanges);
		const comments = contextRanges.commentRanges;
		assertRangeArrayEqual(comments, [
			new Range(1, 0, 1, 6),
		]);
	});

	it("should parse line comment on last line (with trailing newline)", function () {
		const doc = new LSTextDocument(Uri.parse("untitled"), "cfml", 1, dedent`
		a = 1;
		// Foo

		`);
		const contextRanges = getDocumentContextRanges(doc, isScript, docRange, fast, token, exclDocumentRanges);
		const comments = contextRanges.commentRanges;
		assertRangeArrayEqual(comments, [
			new Range(1, 0, 1, 6),
		]);
	});

	it("should parse single-line comment block", function () {
		const doc = new LSTextDocument(Uri.parse("untitled"), "cfml", 1, dedent`
		/* foo */
		a = 1;
		`);
		const contextRanges = getDocumentContextRanges(doc, isScript, docRange, fast, token, exclDocumentRanges);
		const comments = contextRanges.commentRanges;
		assertRangeArrayEqual(comments, [
			new Range(0, 0, 0, 9),
		]);
	});

	it("should parse single-line comment block on last line", function () {
		const doc = new LSTextDocument(Uri.parse("untitled"), "cfml", 1, dedent`
		a = 1;
		/* foo */
		`);
		const contextRanges = getDocumentContextRanges(doc, isScript, docRange, fast, token, exclDocumentRanges);
		const comments = contextRanges.commentRanges;
		assertRangeArrayEqual(comments, [
			new Range(1, 0, 1, 9),
		]);
	});

	it("should parse multi-line comment", function () {
		const doc = new LSTextDocument(Uri.parse("untitled"), "cfml", 1, dedent`
		/*
		foo
		*/
		a = 1;
		`);
		const contextRanges = getDocumentContextRanges(doc, isScript, docRange, fast, token, exclDocumentRanges);
		const comments = contextRanges.commentRanges;
		assertRangeArrayEqual(comments, [
			new Range(0, 0, 2, 2),
		]);
	});

	it("should parse multi-line comment on last", function () {
		const doc = new LSTextDocument(Uri.parse("untitled"), "cfml", 1, dedent`
		a = 1;
		/*
		foo
		*/
		`);
		const contextRanges = getDocumentContextRanges(doc, isScript, docRange, fast, token, exclDocumentRanges);
		const comments = contextRanges.commentRanges;
		assertRangeArrayEqual(comments, [
			new Range(1, 0, 3, 2),
		]);
	});

	it("should ignore single-line comment in comment block", function () {
		const doc = new LSTextDocument(Uri.parse("untitled"), "cfml", 1, dedent`
		/*
		// foo
		*/
		a = 1;
		`);
		const contextRanges = getDocumentContextRanges(doc, isScript, docRange, fast, token, exclDocumentRanges);
		const comments = contextRanges.commentRanges;
		assertRangeArrayEqual(comments, [
			new Range(0, 0, 2, 2),
		]);
	});

	it("should ignore multi-line comment start in existing comment", function () {
		const doc = new LSTextDocument(Uri.parse("untitled"), "cfml", 1, dedent`
		/*
		/* foo
		*/
		a = 1;
		`);
		const contextRanges = getDocumentContextRanges(doc, isScript, docRange, fast, token, exclDocumentRanges);
		const comments = contextRanges.commentRanges;
		assertRangeArrayEqual(comments, [
			new Range(0, 0, 2, 2),
		]);
	});

	it("should parse docblock comment", function () {
		const doc = new LSTextDocument(Uri.parse("untitled"), "cfml", 1, dedent`
		/**
		 * Foo
		 */
		a = 1;
		`);
		const contextRanges = getDocumentContextRanges(doc, isScript, docRange, fast, token, exclDocumentRanges);
		const comments = contextRanges.commentRanges;
		assertRangeArrayEqual(comments, [
			new Range(0, 0, 2, 3),
		]);
	});
}
