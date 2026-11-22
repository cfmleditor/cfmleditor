import * as assert from "node:assert/strict";
import { commands, CompletionList, extensions, Selection, Uri, window, workspace } from "vscode";
import { findPosition } from "./testUtils";

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
});
