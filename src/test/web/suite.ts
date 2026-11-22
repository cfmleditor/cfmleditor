import { commands, env, extensions, Position, Selection, UIKind, window, workspace } from "vscode";

/**
 * Runs smoke tests in the browser extension host.
 */
export async function run(): Promise<void> {
	if (env.uiKind !== UIKind.Web) {
		throw new Error("The smoke test must run in VS Code for the Web");
	}

	const extension = extensions.getExtension("cfmleditor.cfmleditor");
	if (!extension) {
		throw new Error("CFML Editor is unavailable in the web extension host");
	}
	await extension.activate();

	const document = await workspace.openTextDocument({
		language: "cfml",
		content: "<div>Hello #name#!</div>",
	});
	const editor = await window.showTextDocument(document);
	const cursor = new Position(0, "<div>Hello #na".length);
	editor.selection = new Selection(cursor, cursor);
	for (const expected of ["name", "#name#"]) {
		await commands.executeCommand("editor.action.smartSelect.expand");
		const selected = document.getText(editor.selection);
		if (selected !== expected) {
			throw new Error("Expected CFML selection " + expected + ", got " + selected);
		}
	}
	console.log("CFML web smoke test passed");
}
