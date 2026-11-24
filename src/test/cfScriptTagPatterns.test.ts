import * as assert from "assert";

import { getCfScriptTagAttributePattern, getCfScriptTagPattern, getCfScriptTagPatternIgnoreBody } from "../entities/tag";

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
