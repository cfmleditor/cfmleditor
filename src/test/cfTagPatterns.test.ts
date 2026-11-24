import * as assert from "assert";

import { getCfScriptTagAttributePattern, getCfScriptTagPattern, getCfScriptTagPatternIgnoreBody, getCfStartTagPattern, getCfTagPattern } from "../entities/tag";

describe("CFScript tag patterns", function () {
	describe("attribute pattern (unclosed tag before the cursor)", function () {
		const attributesBefore = (text: string) => getCfScriptTagAttributePattern().exec(text)?.[3];

		it("captures the attributes typed so far", function () {
			assert.strictEqual(attributesBefore("cfquery(name=\"a\", dat"), "name=\"a\", dat");
		});

		// A ) inside a quoted value used to end the match, so attributes
		// after it got no completion or hover.
		it("is not ended by a ) inside a quoted value", function () {
			assert.strictEqual(attributesBefore("cfquery(name=\"a\", sql=\"f(x)\", dat"), "name=\"a\", sql=\"f(x)\", dat");
			assert.strictEqual(attributesBefore("cfquery(sql='a)b', dat"), "sql='a)b', dat");
		});

		it("still matches while the cursor is inside an unfinished value", function () {
			assert.strictEqual(attributesBefore("cfquery(name=\"a"), "name=\"a");
		});

		it("does not match once the tag has closed", function () {
			assert.strictEqual(attributesBefore("cfquery(name=\"a\") foo "), undefined);
		});
	});

	describe("whole-tag patterns", function () {
		it("keeps a ) inside a quoted value in the attributes", function () {
			const text = "cfquery(name=\"a)b\", datasource=\"d\") { x }";

			const full = new RegExp(getCfScriptTagPattern().source, "i").exec(text);
			assert.strictEqual(full?.[3], "name=\"a)b\", datasource=\"d\"");
			assert.strictEqual(full?.[4]?.trim(), "x");

			const ignoreBody = new RegExp(getCfScriptTagPatternIgnoreBody().source, "i").exec(text);
			assert.strictEqual(ignoreBody?.[3], "name=\"a)b\", datasource=\"d\"");
		});
	});
});

describe("CFML tag patterns", function () {
	// A > inside a quoted value used to end the tag, so the attributes were cut
	// short and the rest of the tag was read as body text.
	it("keeps a > inside a quoted value in the attributes of a start tag", function () {
		const match = new RegExp(getCfStartTagPattern().source, "i").exec("<cfif a gt \"b>c\" and d>x</cfif>");
		assert.strictEqual(match?.[3], "a gt \"b>c\" and d");
	});

	it("keeps a > inside a quoted value for a tag with a body", function () {
		const match = new RegExp(getCfTagPattern().source, "i").exec("<cfquery name='q' sql=\"a > b\">body</cfquery>");
		assert.strictEqual(match?.[3], "name='q' sql=\"a > b\"");
		assert.strictEqual(match?.[4], "body");
	});

	it("still matches self-closing tags and plain attributes", function () {
		const match = new RegExp(getCfTagPattern().source, "i").exec("<cfset x = 1 />");
		assert.strictEqual(match?.[2], "cfset");
		assert.strictEqual(match?.[3], "x = 1 ");
		assert.strictEqual(new RegExp(getCfStartTagPattern().source, "i").exec("<cfoutput>")?.[3], "");
	});
});
