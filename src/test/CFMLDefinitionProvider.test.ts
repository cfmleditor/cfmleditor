import * as assert from "assert";
import { DefinitionLink, CancellationTokenSource, workspace } from "vscode";
import CFMLDefinitionProvider from "../features/definitionProvider";
import { suiteSetup } from "mocha";
import { waitForBulkCaching } from "../cfmlMain";
import { findPosition } from "./testUtils";

suite("provideDefinition", () => {

    /** Workspace root, does not end with a "/" */
    const root = workspace.workspaceFolders[0].uri.fsPath;

    /** We need to pass a token around. This is used to signal a cancellation request from the user.  */
    const token = new CancellationTokenSource().token;

    /** The class under test */
    let definitionProvider: CFMLDefinitionProvider;

    suiteSetup(async () => {
        // Set up objects common to all tests
        definitionProvider = new CFMLDefinitionProvider()

        // Ensure all the components are cached before starting the tests
        await waitForBulkCaching();
    });

    test("get definition of return type", async function() {
        const doc = await workspace.openTextDocument(`${root}/cfml/WidgetFactory.cfc`);
        const position = findPosition(doc, 'returntype="|cfml.Widget"');
        const definitions: DefinitionLink[] = await definitionProvider.provideDefinition(doc, position, token);
        assert.strictEqual(definitions.length, 1, "Expected 1 definition");
        assert.strictEqual(definitions[0].targetUri.fsPath, `${root}/cfml/Widget.cfc`);
    });

    test("get definition for new keyword", async function() {
        const doc = await workspace.openTextDocument(`${root}/cfml/WidgetFactory.cfc`);
        const position = findPosition(doc, 'var widget = new |cfml.Widget()');
        const definitions: DefinitionLink[] = await definitionProvider.provideDefinition(doc, position, token);
        assert.strictEqual(definitions.length, 1, "Expected 1 definition");
        assert.strictEqual(definitions[0].targetUri.fsPath, `${root}/cfml/Widget.cfc`);
    });
});
