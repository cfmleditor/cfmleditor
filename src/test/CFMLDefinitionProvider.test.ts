import * as assert from "assert/strict";
import { DefinitionLink, workspace, commands, extensions } from "vscode";
import { findPosition } from "./testUtils";

describe("provideDefinition", function () {
	/** Workspace root, does not end with a "/" */
	const root = workspace.workspaceFolders[0].uri.fsPath;

	before(async function () {
		// Wait for the extension to activate
		this.timeout(10_000);
		const extension = extensions.getExtension("cfmleditor.cfmleditor");
		await extension.activate();
	});

	describe("component definitions", function () {
		it("should get definition for return type", async function () {
			const doc = await workspace.openTextDocument(`${root}/cfml/WidgetFactory.cfc`);
			const position = findPosition(doc, "name=\"create_with_new\" returntype=\"|cfml.Widget\"");
			const definitions: DefinitionLink[] = await commands.executeCommand<DefinitionLink[]>("vscode.executeDefinitionProvider", doc.uri, position);
			assert.strictEqual(definitions.length, 1, "Expected 1 definition");
			assert.strictEqual(definitions[0].targetUri.fsPath, `${root}/cfml/Widget.cfc`);
		});

		it("should get definition for new keyword", async function () {
			const doc = await workspace.openTextDocument(`${root}/cfml/WidgetFactory.cfc`);
			const position = findPosition(doc, "var widget = new |cfml.Widget()");
			const definitions: DefinitionLink[] = await commands.executeCommand<DefinitionLink[]>("vscode.executeDefinitionProvider", doc.uri, position);
			assert.strictEqual(definitions.length, 1, "Expected 1 definition");
			assert.strictEqual(definitions[0].targetUri.fsPath, `${root}/cfml/Widget.cfc`);
		});
	});
});
