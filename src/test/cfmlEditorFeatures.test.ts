import * as assert from "node:assert/strict";
import { commands, CompletionItemKind, CompletionList, ConfigurationTarget, DefinitionLink, Disposable, DocumentSymbol, extensions, Hover, InlayHint, InlayHintKind, MarkdownString, Position, Range, Selection, SignatureHelp, Uri, window, workspace } from "vscode";
import { parseDocBlock } from "../entities/docblock";
import { matchAutoCloseTag } from "../features/autoCloseTagMatch";
import { detectUntitledLanguage } from "../features/untitledLanguageDetection";
import { LSTextDocument } from "../utils/LSTextDocument";
import { findDefinition, findPosition } from "./testUtils";

describe("CFML editor features", function () {
	const folder = workspace.workspaceFolders?.[0];
	if (!folder) {
		throw new Error("No workspace folder found");
	}
	const fixture = (name: string) => workspace.openTextDocument(Uri.joinPath(folder.uri, "cfml", name));

	it("finds the final opening tag for auto-close", function () {
		const attributes = Array.from({ length: 100 }, (_, index) => `data-field-${index}="field ${index}"`).join(" ");
		assert.deepStrictEqual(matchAutoCloseTag(`<div>text<span ${attributes}>`)?.slice(1), ["span", ">"]);
		assert.deepStrictEqual(matchAutoCloseTag("prefix <cf_custom item='a b' /")?.slice(1), ["cf_custom", "/"]);
		assert.equal(matchAutoCloseTag("</div>"), null);
		assert.equal(matchAutoCloseTag(`<div ${attributes} class=>`), null);
	});

	before(async function () {
		this.timeout(10_000);
		const extension = extensions.getExtension("cfmleditor.cfmleditor");
		assert.ok(extension);
		await extension.activate();
	});

	for (const [content, language] of [
		["<h1>Hello World</h1>\n<cf", "cfml"],
		["// Hello World\ncomponent {", "cfs"],
	]) {
		it("detects " + language + " after editing an untitled document", async function () {
			this.timeout(10_000);
			const document = await workspace.openTextDocument({ language: "plaintext" });
			const editor = await window.showTextDocument(document);
			let subscription: Disposable | undefined;
			const replacement = new Promise<string>((resolve) => {
				subscription = workspace.onDidOpenTextDocument((opened) => {
					if (opened.uri.toString() === document.uri.toString() && opened.languageId === language) {
						resolve(opened.languageId);
					}
				});
			});
			try {
				assert.ok(await editor.edit(edit => edit.insert(new Position(0, 0), content)));
				assert.strictEqual(await replacement, language);
			}
			finally {
				subscription?.dispose();
				await commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
			}
		});
	}

	it("preserves a language already set on an untitled document", async function () {
		const document = await workspace.openTextDocument({ language: "html", content: "<cfoutput>hello</cfoutput>" });
		await detectUntitledLanguage(document);
		assert.strictEqual(document.languageId, "html");
	});

	it("parses undelimited prose, independent annotations, and CRLF value ranges", function () {
		const source = [
			"/** Inline prose",
			"    continuation",
			"    @wirebox The Injector",
			"    @wirebox.inject wirebox",
			"         @return MyComponent",
			"    @flag",
			"    @param first First parameter.",
			"    @param second Second parameter.",
			"*/",
		].join("\r\n");
		const document = new LSTextDocument(Uri.parse("untitled:docblock-test"), "cfml", 1, source);
		const range = new Range(document.positionAt(3), document.positionAt(source.length - 2));
		const entries = parseDocBlock(document, range);
		assert.deepStrictEqual(entries.map(({ key, subkey, value }) => [key, subkey, value]), [
			["hint", undefined, "Inline prose\ncontinuation"],
			["wirebox", undefined, "The Injector"],
			["wirebox", "inject", "wirebox"],
			["return", undefined, "MyComponent"],
			["flag", undefined, ""],
			["param", undefined, "first First parameter."],
			["param", undefined, "second Second parameter."],
		]);
		const typeRange = entries[3].valueRange;
		assert.ok(typeRange);
		assert.strictEqual(document.getText(typeRange), "MyComponent");
		assert.strictEqual(entries[4].valueRange, undefined);
	});

	describe("signature help with strings in the arguments", function () {
		const signatureAt = async (marker: string) => {
			const document = await fixture("SignatureStrings.cfc");
			const result = await commands.executeCommand<SignatureHelp | undefined>(
				"vscode.executeSignatureHelpProvider", document.uri, findPosition(document, marker),
			);
			return result;
		};

		it("finds the call from inside a string argument containing a (", async function () {
			const result = await signatureAt("this.pair(\"a(b|\", 42)");
			assert.match(result?.signatures[0]?.label ?? "", /pair\(/);
			assert.equal(result?.activeParameter, 0);
		});

		it("finds the call from inside a string argument containing a comma", async function () {
			const result = await signatureAt("this.pair(\"a,b|\", 42)");
			assert.match(result?.signatures[0]?.label ?? "", /pair\(/);
			assert.equal(result?.activeParameter, 0);
		});

		it("counts arguments after a string that contains a (", async function () {
			const result = await signatureAt("this.pair(\"a(b\", |42)");
			assert.match(result?.signatures[0]?.label ?? "", /pair\(/);
			assert.equal(result?.activeParameter, 1);
		});

		it("finds the call from inside a single-quoted string with a doubled quote and a (", async function () {
			const result = await signatureAt("this.pair('it''s (|odd', 42)");
			assert.match(result?.signatures[0]?.label ?? "", /pair\(/);
			assert.equal(result?.activeParameter, 0);
		});
	});

	it("renders multiline docblocks with parameter and return descriptions in signature help", async function () {
		const document = await fixture("DocBlockExamples.cfc");
		const result = await commands.executeCommand<SignatureHelp>(
			"vscode.executeSignatureHelpProvider", document.uri, findPosition(document, "this.buildDocumentedGizmo(|\"template.cfm\", 42)"),
		);
		const signature = result.signatures[0];
		assert.match(signature.label, /: Gizmo$/);
		const documentation = (signature.documentation as MarkdownString).value;
		assert.match(documentation, /\n- Template[ \t]*\n- Line number/);
		assert.match(documentation, /\n {4}if \(example/);
		assert.match(documentation, /\n {8}\/\/ Do something/);
		assert.match(documentation, /\n {4}writeOutput\("example"\);[ \t]*\n@example inside the fence/);
		assert.match(documentation, /\*\*Returns\*\* The new gizmo\./);
		assert.match((signature.parameters[0].documentation as MarkdownString).value, /\[required\][ \t]*\nThe template string to be used\./);
		assert.strictEqual((signature.parameters[1].documentation as MarkdownString).value, "The line number.");
	});

	it("shows returns in hover and preserves declared types and CF-style hints", async function () {
		const document = await fixture("DocBlockExamples.cfc");
		const hoverText = async (marker: string) => {
			const results = await commands.executeCommand<Hover[]>("vscode.executeHoverProvider", document.uri, findPosition(document, marker));
			return results.flatMap(result => result.contents).map(value => typeof value === "string" ? value : value.value).join("\n");
		};
		const boolean = await hoverText("this.|isDocumentedGizmoEnabled()");
		assert.match(boolean, /```cfs\nboolean function isDocumentedGizmoEnabled\(\)/);
		assert.match(boolean, /\*\*Returns\*\* True when enabled\./);
		const text = await hoverText("this.|describeDocumentedLabel(\"label\")");
		assert.match(text, /```cfs\nstring function describeDocumentedLabel\(string label\)/);
		assert.match(text, /Preferred hint\./);
		assert.match(text, /Legacy name-based argument hint\./);
		assert.match(text, /\*\*Returns\*\* An example documented return\./);
		assert.doesNotMatch(text, /Additional prose|Fallback parameter text/);
		const component = await hoverText("this.|buildDocumentedGizmo(\"template.cfm\", 42)");
		assert.match(component, /```cfs\ncfscript\.Gizmo function buildDocumentedGizmo\(required string template, numeric line\)/);
	});

	it("preserves documented call order and renders each overload", async function () {
		const { functionHoverSyntax } = await import("../entities/function");
		const { DataType } = await import("../entities/dataType");
		const prefix = { name: "prefix", dataType: DataType.String, required: true, description: "" };
		const dir = { ...prefix, name: "dir", required: false };
		const extension = { ...dir, name: "extension" };
		const parameters = [dir, prefix, extension];
		const func = {
			name: "getTempFile", returntype: DataType.String, description: "",
			signatures: [{ parameters }],
		};
		assert.strictEqual(
			functionHoverSyntax(func, "getTempFile( string prefix, [string dir], [string extension] )"),
			"string function getTempFile(required string prefix, string dir, string extension)",
		);
		assert.deepStrictEqual(parameters.map(param => param.name), ["dir", "prefix", "extension"]);
		assert.deepStrictEqual(functionHoverSyntax({
			...func,
			signatures: [{ parameters: [prefix] }, { parameters: [prefix, dir] }],
		}).split("\n"), [
			"string function getTempFile(required string prefix)",
			"string function getTempFile(required string prefix, string dir)",
		]);
	});

	it("displays tag attributes with types and false or zero defaults", async function () {
		const { tagAttributeDetails } = await import("../entities/parameter");
		const { DataType } = await import("../entities/dataType");
		const details = tagAttributeDetails([
			{ name: "expand", dataType: DataType.Boolean, required: false, description: "Expand the view.", default: false as unknown as string },
			{ name: "top", dataType: DataType.Numeric, required: true, description: "", default: 0 as unknown as string },
		]).value;
		assert.match(details, /- \*\*expand\*\* `boolean` \(default false\) — Expand the view\./);
		assert.match(details, /- \*\*top\*\* `numeric` \*\(required\)\* \(default 0\)/);
	});

	it("uses member names and receiver types from CFDocs and Lucee", async function () {
		const { CFDocsDefinitionInfo } = await import("../utils/cfdocs/definitionInfo");
		const { DataType } = await import("../entities/dataType");
		const cfdocs = new CFDocsDefinitionInfo("arrayAppend", "function", "arrayAppend(array, value)", "someArray.append(value)", "", "boolean", [],
			"Append a value.", "", [{ name: "array", type: "array", required: true }, { name: "value", type: "any", required: true }], {}, [], []);
		const legacyMember = cfdocs.toGlobalMemberFunction(cfdocs.toGlobalFunction());
		assert.strictEqual(legacyMember?.name, "append");
		assert.strictEqual(legacyMember.receiverType, DataType.Array);
		assert.strictEqual(legacyMember.syntax, "someArray.append(value)");
		assert.deepStrictEqual(legacyMember.signatures[0].parameters.map(param => param.name), ["value"]);

		const lucee = new CFDocsDefinitionInfo("dateAdd", "function", "dateAdd(part, amount, value)", "", "", "date", [],
			"Add time.", "", [
				{ name: "part", type: "string", required: true },
				{ name: "amount", type: "number", required: true },
				{ name: "value", type: "datetime", required: true },
			], {}, [], [], { name: "add", type: "datetime", returns: "datetime" });
		const luceeMember = lucee.toGlobalMemberFunction(lucee.toGlobalFunction());
		assert.strictEqual(luceeMember?.name, "add");
		assert.strictEqual(luceeMember.receiverType, DataType.Date);
		assert.strictEqual(luceeMember.returntype, DataType.Date);
		assert.strictEqual(luceeMember.syntax, "date.add(part, amount)");
	});

	it("keeps same-name members for different receiver types and deduplicates unknown receivers", async function () {
		const { getGlobalMemberFunctions, setGlobalMemberFunction, clearAllGlobalMemberFunctions } = await import("../features/cachedEntities");
		const { DataType } = await import("../entities/dataType");
		const entry = { name: "append", syntax: "array.append(value)", description: "", signatures: [], returntype: DataType.Array, receiverType: DataType.Array };
		clearAllGlobalMemberFunctions();
		try {
			setGlobalMemberFunction(entry);
			setGlobalMemberFunction({ ...entry, syntax: "struct.append(value)", receiverType: DataType.Struct });
			setGlobalMemberFunction({ ...entry, name: "listAppend", syntax: "string.listAppend(value)", receiverType: DataType.String });
			assert.deepStrictEqual(getGlobalMemberFunctions(DataType.Array).map(member => member.syntax), ["array.append(value)"]);
			assert.deepStrictEqual(getGlobalMemberFunctions(DataType.Struct).map(member => member.syntax), ["struct.append(value)"]);
			assert.deepStrictEqual(getGlobalMemberFunctions(DataType.String).map(member => member.name), ["listAppend"]);
			assert.deepStrictEqual(getGlobalMemberFunctions(DataType.Any).map(member => member.name), ["append", "listAppend"]);
		}
		finally {
			clearAllGlobalMemberFunctions();
		}
	});

	it("labels positional arguments in nested calls and skips names, declarations, strings, and comments", async function () {
		const document = await fixture("ParameterHints.cfc");
		const range = new Range(new Position(0, 0), document.positionAt(document.getText().length));
		const hints = await commands.executeCommand<InlayHint[]>("vscode.executeInlayHintProvider", document.uri, range);
		const expected = [
			["|\"hello, world\"", "first:"],
			["|this.combine(\"inner\", \"value\")", "second:"],
			["this.combine(|\"inner\", \"value\")", "first:"],
			["\"inner\", |\"value\"", "second:"],
		];
		assert.deepStrictEqual(hints.map(hint => [document.offsetAt(hint.position), hint.label, hint.kind]), expected.map(([marker, name]) =>
			[document.offsetAt(findPosition(document, marker)), name, InlayHintKind.Parameter]));

		const visibleRange = document.lineAt(findPosition(document, "|\"hello, world\"").line).range;
		const visibleHints = await commands.executeCommand<InlayHint[]>("vscode.executeInlayHintProvider", document.uri, visibleRange);
		assert.deepStrictEqual(visibleHints.map(hint => hint.label), ["first:"]);
	});

	it("labels arguments in a cfset expression and honors the inlay hint setting", async function () {
		this.timeout(10_000);
		const document = await fixture("ParameterHints.cfm");
		const range = new Range(new Position(0, 0), document.positionAt(document.getText().length));
		const settings = workspace.getConfiguration("cfml.inlayHints", document.uri);
		const key = "parameterNames";
		const previous = settings.inspect<boolean>(key)?.globalValue;
		const labels = async () => (await commands.executeCommand<InlayHint[]>("vscode.executeInlayHintProvider", document.uri, range)).map(hint => hint.label);
		assert.deepStrictEqual(await labels(), ["person:"]);
		try {
			await settings.update(key, false, ConfigurationTarget.Global);
			assert.deepStrictEqual(await labels(), []);
		}
		finally {
			await settings.update(key, previous, ConfigurationTarget.Global);
		}
	});

	it("labels a standalone CFScript call that omits an optional argument", async function () {
		const document = await fixture("ParameterHints.cfs");
		const range = new Range(new Position(0, 0), document.positionAt(document.getText().length));
		const hints = await commands.executeCommand<InlayHint[]>("vscode.executeInlayHintProvider", document.uri, range);
		assert.deepStrictEqual(hints.map(hint => hint.label), ["person:"]);
	});

	const completions = [
		["ScriptCompletions.cfm", "writeOutput(scriptW|);", "scriptWidget"],
		["ScriptCompletions.cfm", "scriptWidget.ren|;", "render"],
		["ScriptCompletions.cfm", "writeOutput(tagW|);", "tagWidget"],
		["UnclosedScriptCompletions.cfm", "writeOutput(pendingW|);", "pendingWidget"],
		["UnclosedScriptCompletions.cfm", "pendingWidget.ren|", "render"],
		["ScriptCompletions.cfs", "writeOutput(scriptW|);", "scriptWidget"],
		["ScriptCompletions.cfs", "scriptWidget.ren|;", "render"],
	];

	for (const [file, cursor, expected] of completions) {
		it(`completes ${expected} at ${cursor} in ${file}`, async function () {
			const document = await fixture(file);
			const result = await commands.executeCommand<CompletionList>("vscode.executeCompletionItemProvider", document.uri, findPosition(document, cursor));
			assert.ok(result.items.some(item => (typeof item.label === "string" ? item.label : item.label.label) === expected));
		});
	}

	it("completes built-in members using the receiver type", async function () {
		const document = await fixture("BuiltinMemberCompletions.cfc");
		await fixture("Widget.cfc");
		const complete = async (cursor: string) => {
			const { items } = await commands.executeCommand<CompletionList>("vscode.executeCompletionItemProvider", document.uri, findPosition(document, cursor), ".");
			return items.filter(item => item.kind === CompletionItemKind.Function).map(item => ({
				name: typeof item.label === "string" ? item.label : item.label.label,
				detail: item.detail,
			}));
		};

		const strings = await complete("textValue.|;");
		assert.ok(strings.some(item => item.name === "listAppend"));
		assert.ok(!strings.some(item => item.name === "append"));
		for (const [cursor, receiver] of [["arrayValue.|;", /array/i], ["structValue.|;", /struct/i]] as const) {
			const items = await complete(cursor);
			assert.match(items.find(item => item.name === "append")?.detail ?? "", receiver);
			assert.ok(!items.some(item => item.name === "listAppend"));
		}

		const unknown = await complete("unknownValue.|;");
		assert.equal(unknown.filter(item => item.name === "append").length, 1);
		assert.ok(unknown.some(item => item.name === "listAppend"));
		const widget = await complete("widget.|;");
		assert.ok(widget.some(item => item.name === "render"));
		assert.ok(!widget.some(item => item.name === "listAppend"));
	});

	it("uses the most recent component variable assignment before the cursor", async function () {
		const document = await fixture("ReassignedMemberType.cfc");
		for (const [cursor, expected] of [
			["variables.later.ren|;", false],
			["variables.mapper.re|;", false],
			["variables.mapper.ren|;", true],
			["variables.mapper.rend|;", false],
		] as const) {
			const result = await commands.executeCommand<CompletionList>("vscode.executeCompletionItemProvider", document.uri, findPosition(document, cursor));
			const hasRender = result.items.some(item => item.kind === CompletionItemKind.Function
				&& (typeof item.label === "string" ? item.label : item.label.label) === "render");
			assert.strictEqual(hasRender, expected, cursor);
		}
	});

	it("expands a word to its interpolation, tag contents, and full tag", async function () {
		const document = await fixture("SelectionRanges.cfm");
		const editor = await window.showTextDocument(document);
		const position = findPosition(document, "Hello #na|me#!");
		editor.selection = new Selection(position, position);
		const selections: string[] = [];
		for (let step = 0; step < 4; step++) {
			await commands.executeCommand("editor.action.smartSelect.expand");
			selections.push(document.getText(editor.selection));
		}
		assert.deepEqual(selections, ["name", "#name#", "Hello #name#!", "<div>Hello #name#!</div>"]);
	});

	it("skips the interpolation step for escaped hashes", async function () {
		const document = await fixture("SelectionRanges.cfm");
		const editor = await window.showTextDocument(document);
		const position = findPosition(document, "##lit|eral##");
		editor.selection = new Selection(position, position);
		await commands.executeCommand("editor.action.smartSelect.expand");
		assert.strictEqual(document.getText(editor.selection), "literal");
		await commands.executeCommand("editor.action.smartSelect.expand");
		assert.strictEqual(document.getText(editor.selection), "Hello ##literal##! #name#");
	});

	it("resolves this-scoped definitions in the current component and its accessible base methods", async function () {
		const document = await fixture("ComponentFeatures.cfc");
		const definitionSettings = workspace.getConfiguration("cfml.definition", document.uri);
		const key = "userFunctions.search.enable";
		const previous = definitionSettings.inspect<boolean>(key)?.globalValue;
		try {
			await definitionSettings.update(key, true, ConfigurationTarget.Global);
			const ownDefinition = await findDefinition(document, "this.|privateLabel()");
			assert.strictEqual(ownDefinition.targetUri.toString(), document.uri.toString());
			assert.strictEqual(document.getText(ownDefinition.targetSelectionRange), "privateLabel");

			const inherited = await findDefinition(document, "this.|parentPublic()");
			const base = await fixture("ComponentFeaturesBase.cfc");
			assert.strictEqual(inherited.targetUri.toString(), base.uri.toString());

			for (const cursor of ["this.|peerOnly()", "this.|parentPrivate()"]) {
				const definitions = await commands.executeCommand<DefinitionLink[]>("vscode.executeDefinitionProvider", document.uri, findPosition(document, cursor));
				assert.deepEqual(definitions, []);
			}
		}
		finally {
			await definitionSettings.update(key, previous, ConfigurationTarget.Global);
		}
	});

	it("only completes private methods declared on the component itself through this", async function () {
		const document = await fixture("ComponentFeatures.cfc");
		for (const [cursor, expected, offered] of [
			["this.privateL|;", "privateLabel", true],
			["this.parentPriv|;", "parentPrivate", false],
		] as const) {
			const result = await commands.executeCommand<CompletionList>("vscode.executeCompletionItemProvider", document.uri, findPosition(document, cursor));
			const matchingItems = result.items.filter(item => item.kind === CompletionItemKind.Function
				&& (typeof item.label === "string" ? item.label : item.label.label) === expected);
			assert.strictEqual(matchingItems.length > 0, offered, JSON.stringify(matchingItems));
		}
	});

	it("hides implicit accessors from Outline while keeping their definitions", async function () {
		const document = await fixture("ComponentFeatures.cfc");
		const outline = workspace.getConfiguration("cfml.outline", document.uri);
		const key = "showImplicitFunctions";
		const previous = outline.inspect<boolean>(key)?.globalValue;
		const names = async () => {
			const symbols = await commands.executeCommand<DocumentSymbol[]>("vscode.executeDocumentSymbolProvider", document.uri);
			return symbols.find(symbol => symbol.name === "ComponentFeatures")?.children.map(symbol => symbol.name);
		};
		try {
			await outline.update(key, undefined, ConfigurationTarget.Global);
			assert.deepEqual(await names(), ["label", "privateLabel", "explicitMethod", "getDisplayName", "getLabel", "setLabel"]);
			await outline.update(key, false, ConfigurationTarget.Global);
			assert.deepEqual(await names(), ["label", "privateLabel", "explicitMethod", "getDisplayName"]);

			const definition = await findDefinition(document, "this.|getLabel()");
			assert.strictEqual(definition.targetUri.toString(), document.uri.toString());
			assert.strictEqual(document.getText(definition.targetSelectionRange), "label");
		}
		finally {
			await outline.update(key, previous, ConfigurationTarget.Global);
		}
	});
});
