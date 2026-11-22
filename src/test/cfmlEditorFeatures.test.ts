import * as assert from "node:assert/strict";
import { commands, CompletionItemKind, CompletionList, ConfigurationTarget, DefinitionLink, DocumentSymbol, extensions, Selection, Uri, window, workspace } from "vscode";
import { findDefinition, findPosition } from "./testUtils";

describe("CFML editor features", function () {
	const folder = workspace.workspaceFolders?.[0];
	if (!folder) {
		throw new Error("No workspace folder found");
	}
	const fixture = (name: string) => workspace.openTextDocument(Uri.joinPath(folder.uri, "cfml", name));

	before(async function () {
		this.timeout(10_000);
		const extension = extensions.getExtension("cfmleditor.cfmleditor");
		assert.ok(extension);
		await extension.activate();
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
