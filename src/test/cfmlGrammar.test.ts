import * as assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type IGrammar, type IOnigLib, parseRawGrammar, Registry, INITIAL } from "vscode-textmate";

// The package's declarations require DOM types. The tests only use its Node-compatible API.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const oniguruma = require("vscode-oniguruma") as IOnigLib & { loadWASM(data: Uint8Array): Promise<void> };

const root = resolve(__dirname, "../..");
const fixtureDirectory = join(root, "src/test/fixtures/grammar");
const scopeName = "embedding.cfml";
const plainText = [scopeName, "text.html.cfml"];

interface ScopeCheck {
	lineNumber: number;
	text: string;
	scope: string | string[];
}

const fixtures: { file: string; checks: ScopeCheck[] }[] = [
	{
		// ColdBox's `singleton` is a bare flag, which must not stop the header being read as script
		file: "bare-component-attributes.cfc",
		checks: [
			{ lineNumber: 1, text: "component", scope: "storage.type.class.cfml" },
			{ lineNumber: 2, text: "function", scope: "storage.type.function.cfml" },
			{ lineNumber: 3, text: "return", scope: "keyword.control.flow.cfml" },
		],
	},
	{
		file: "bare-component-attributes-extra.cfc",
		checks: [
			{ lineNumber: 1, text: "component", scope: "storage.type.class.cfml" },
			{ lineNumber: 2, text: "function", scope: "storage.type.function.cfml" },
		],
	},
	{
		// Prose that merely starts with the word is still plain text
		file: "component-word-prose.cfm",
		checks: [
			{ lineNumber: 1, text: "items", scope: "text.html.cfml" },
			{ lineNumber: 2, text: "p", scope: "entity.name.tag.block.any.html" },
		],
	},
	{
		file: "plain-html.cfm",
		checks: [
			{ lineNumber: 3, text: "span", scope: "entity.name.tag.inline.any.html" },
			{ lineNumber: 3, text: "1", scope: plainText },
			{ lineNumber: 3, text: "Report Details", scope: plainText },
			{ lineNumber: 6, text: "Delivery Details", scope: plainText },
			{ lineNumber: 8, text: "div", scope: "entity.name.tag.block.any.html" },
		],
	},
	{
		file: "import-prose.cfm",
		checks: [
			{ lineNumber: 1, text: "Import your data here", scope: plainText },
			{ lineNumber: 2, text: "cfoutput", scope: "entity.name.tag.cfml" },
			{ lineNumber: 2, text: "message", scope: "meta.embedded.line.cfml" },
		],
	},
	{
		file: "component-prose.cfm",
		checks: [
			{ lineNumber: 1, text: "Component description", scope: plainText },
			{ lineNumber: 2, text: "p", scope: "entity.name.tag.block.any.html" },
		],
	},
	{
		file: "protocol-relative-url.cfm",
		checks: [
			{ lineNumber: 2, text: "cfoutput", scope: "entity.name.tag.cfml" },
			{ lineNumber: 2, text: "message", scope: "meta.embedded.line.cfml" },
		],
	},
	{
		file: "import-before-markup.cfm",
		checks: [
			{ lineNumber: 1, text: "import", scope: "keyword.control.import.cfml" },
			{ lineNumber: 1, text: "*", scope: "constant.language.import-all.cfml" },
			{ lineNumber: 1, text: "Sample import syntax", scope: "comment.line.double-slash.cfml" },
			{ lineNumber: 2, text: "Import your data here", scope: plainText },
			{ lineNumber: 3, text: "cfoutput", scope: "entity.name.tag.cfml" },
		],
	},
	{
		file: "unfinished-import-before-markup.cfm",
		checks: [
			{ lineNumber: 2, text: "cfoutput", scope: "entity.name.tag.cfml" },
			{ lineNumber: 2, text: "message", scope: "meta.embedded.line.cfml" },
		],
	},
	{
		file: "script-block.cfm",
		checks: [
			{ lineNumber: 1, text: "cfscript", scope: "entity.name.tag.cfml" },
			{ lineNumber: 2, text: "message", scope: "source.cfml.script" },
			{ lineNumber: 2, text: "=", scope: "keyword.operator.assignment.cfml" },
			{ lineNumber: 4, text: "cfoutput", scope: "entity.name.tag.cfml" },
		],
	},
	{
		file: "CommentedComponent.cfc",
		checks: [
			{ lineNumber: 1, text: "component", scope: "storage.type.class.cfml" },
			{ lineNumber: 1, text: "comment", scope: "comment.block.cfml" },
			{ lineNumber: 2, text: "hello", scope: "entity.name.function.cfml" },
			{ lineNumber: 3, text: "return", scope: "keyword.control.flow.cfml" },
		],
	},
	{
		file: "CommentedComponentAttribute.cfc",
		checks: [
			{ lineNumber: 1, text: "component", scope: "storage.type.class.cfml" },
			{ lineNumber: 1, text: "parent class", scope: "comment.block.cfml" },
			{ lineNumber: 2, text: "hello", scope: "entity.name.function.cfml" },
			{ lineNumber: 3, text: "return", scope: "keyword.control.flow.cfml" },
		],
	},
	{
		file: "WrappedComponentAttribute.cfc",
		checks: [
			{ lineNumber: 2, text: "=", scope: "keyword.operator.assignment.cfml" },
			{ lineNumber: 2, text: "app.Base", scope: "string.quoted.double.cfml" },
			{ lineNumber: 3, text: "hello", scope: "entity.name.function.cfml" },
		],
	},
	{
		file: "MultilineCommentedAttribute.cfc",
		checks: [
			{ lineNumber: 1, text: "component", scope: "storage.type.class.cfml" },
			{ lineNumber: 2, text: "class", scope: "comment.block.cfml" },
			{ lineNumber: 3, text: "hello", scope: "entity.name.function.cfml" },
		],
	},
	{
		file: "LineCommentedAttribute.cfc",
		checks: [
			{ lineNumber: 1, text: "Parent class", scope: "comment.line.double-slash.cfml" },
			{ lineNumber: 3, text: "hello", scope: "entity.name.function.cfml" },
		],
	},
	{
		file: "ComponentAfterPreambleComment.cfc",
		checks: [
			{ lineNumber: 1, text: "License", scope: "comment.block.cfml" },
			{ lineNumber: 1, text: "component", scope: "storage.type.class.cfml" },
			{ lineNumber: 2, text: "hello", scope: "entity.name.function.cfml" },
		],
	},
	{
		file: "InterfaceAfterDocComment.cfc",
		checks: [
			{ lineNumber: 2, text: "Interface docs", scope: "comment.block.documentation.cfml" },
			{ lineNumber: 3, text: "interface", scope: "storage.type.interface.cfml" },
			{ lineNumber: 4, text: "hello", scope: "entity.name.function.cfml" },
		],
	},
	{
		file: "ScriptWithWrappedImports.cfc",
		checks: [
			{ lineNumber: 1, text: "import", scope: "keyword.control.import.cfml" },
			{ lineNumber: 1, text: "model", scope: "comment.block.cfml" },
			{ lineNumber: 1, text: "app.Model", scope: "variable.other.readwrite.alias.cfml" },
			{ lineNumber: 3, text: "app.Other", scope: "string.quoted.double.cfml" },
			{ lineNumber: 5, text: "component", scope: "storage.type.class.cfml" },
			{ lineNumber: 6, text: "hello", scope: "entity.name.function.cfml" },
		],
	},
	{
		file: "ScriptComponent.cfc",
		checks: [
			{ lineNumber: 2, text: "@hint", scope: "keyword.other.documentation.cfml" },
			{ lineNumber: 4, text: "app.Model", scope: "string.quoted.double.cfml" },
			{ lineNumber: 6, text: "final", scope: "storage.modifier.cfml" },
			{ lineNumber: 6, text: "component", scope: "storage.type.class.cfml" },
			{ lineNumber: 6, text: "app.Base", scope: "entity.other.inherited-class.cfml" },
		],
	},
	{
		file: "ScriptInterface.cfc",
		checks: [
			{ lineNumber: 1, text: "interface", scope: "storage.type.interface.cfml" },
			{ lineNumber: 3, text: "hello", scope: "entity.name.function.cfml" },
		],
	},
	{
		file: "TagComponent.cfc",
		checks: [
			{ lineNumber: 1, text: "tag-based component", scope: "comment.block.cfml" },
			{ lineNumber: 2, text: "cfcomponent", scope: "storage.type.class.cfml" },
			{ lineNumber: 2, text: "extends", scope: "storage.modifier.extends.cfml" },
			{ lineNumber: 2, text: "app.Base", scope: "entity.other.inherited-class.cfml" },
			{ lineNumber: 3, text: "cffunction", scope: "meta.class.body.tag.cfml" },
			{ lineNumber: 4, text: "cfcomponent", scope: "storage.type.class.cfml" },
		],
	},
	{
		file: "TagInterface.cfc",
		checks: [
			{ lineNumber: 1, text: "cfinterface", scope: "storage.type.interface.cfml" },
			{ lineNumber: 1, text: "extends", scope: "storage.modifier.extends.cfml" },
			{ lineNumber: 1, text: "app.Base", scope: "entity.other.inherited-class.cfml" },
			{ lineNumber: 3, text: "cfinterface", scope: "storage.type.interface.cfml" },
		],
	},
	{
		file: "TagIsland.cfc",
		checks: [
			{ lineNumber: 4, text: "cfset", scope: "entity.name.tag.cfml" },
			{ lineNumber: 6, text: "return", scope: "keyword.control.flow.cfml" },
		],
	},
];

describe("CFML TextMate grammar", function () {
	let registry: Registry | undefined;
	let grammar: IGrammar;

	before(async function () {
		await oniguruma.loadWASM(await readFile(require.resolve("vscode-oniguruma/release/onig.wasm")));
		const grammarPath = join(root, "syntaxes/cfml.tmLanguage.json");
		const rawGrammar = parseRawGrammar(await readFile(grammarPath, "utf8"), grammarPath);
		registry = new Registry({
			onigLib: Promise.resolve(oniguruma),
			loadGrammar: name => Promise.resolve(name === scopeName ? rawGrammar : null),
		});
		const loadedGrammar = await registry.loadGrammar(scopeName);
		assert.ok(loadedGrammar, `Could not load ${scopeName}`);
		grammar = loadedGrammar;
	});

	after(function () {
		registry?.dispose();
	});

	for (const { file, checks } of fixtures) {
		it(`highlights ${file}`, async function () {
			const lines = (await readFile(join(fixtureDirectory, file), "utf8")).split(/\r?\n/);
			let ruleStack = INITIAL;
			const tokenizedLines = lines.map((line) => {
				const result = grammar.tokenizeLine(line, ruleStack);
				ruleStack = result.ruleStack;
				return result.tokens;
			});

			for (const { lineNumber, text, scope } of checks) {
				const context = `${file}:${lineNumber} "${text}"`;
				const start = lines[lineNumber - 1]?.indexOf(text) ?? -1;
				assert.ok(start >= 0, `Missing fixture text at ${context}`);
				const end = start + text.length;
				const tokens = tokenizedLines[lineNumber - 1].filter(token => token.startIndex < end && token.endIndex > start);
				assert.ok(tokens.length > 0, `No tokens at ${context}`);
				for (const token of tokens) {
					if (typeof scope === "string") {
						assert.ok(token.scopes.includes(scope), `${context} expected ${scope}, got ${token.scopes.join(" ")}`);
					}
					else {
						assert.deepEqual(token.scopes, scope, context);
					}
				}
			}
		});
	}
});
