import * as assert from "assert";

import { isStructLiteralBrace } from "../entities/structLiteral";

describe("isStructLiteralBrace", function () {
	const brace = (text: string) => isStructLiteralBrace(text, text.indexOf("{"));

	it("is a struct literal in a value position", function () {
		assert.ok(brace("x = {a = 1}"));
		assert.ok(brace("foo({a = 1})"));
		assert.ok(brace("foo(1, {a = 1})"));
		assert.ok(brace("x = [{a = 1}]"));
		assert.ok(brace("return {a = 1};"));
		assert.ok(brace("x = cond ? {a = 1} : {b = 2};"));
	});

	it("is a block after a statement, condition or declaration", function () {
		assert.ok(!brace("if (x) {a = 1}"));
		assert.ok(!brace("function f() {a = 1}"));
		assert.ok(!brace("x = 1; {a = 1}"));
		assert.ok(!brace("else {a = 1}"));
		assert.ok(!brace("{a = 1}"));
		assert.ok(!brace("switch (x) { case 1: {a = 1} }".slice(11)));
		assert.ok(!brace("default: {a = 1}"));
	});
});
