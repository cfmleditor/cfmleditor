import * as assert from "assert/strict";
import { workspace, extensions, TextDocument } from "vscode";
import { findDefinition } from "./testUtils";
import { assertDefinitionLinkTarget } from "./testAssertions";

// Tweak the linter rules for better test readability
/* eslint @stylistic/quotes: ["error", "double", { "avoidEscape": true }] */

describe("provideDefinition", function () {
	/** Workspace root, does not end with a "/" */
	const root = workspace && workspace.workspaceFolders ? workspace.workspaceFolders[0].uri.fsPath : undefined;

	if (!root) {
		throw new Error("No workspace folder found.");
	}

	before(async function () {
		// Wait for the extension to activate
		this.timeout(10_000);
		const extension = extensions.getExtension("cfmleditor.cfmleditor");
		if (extension) {
			await extension.activate();
		}
		else {
			throw new Error("Extension 'cfmleditor.cfmleditor' is not found.");
		}
	});

	describe("component definitions (CFML)", function () {
		let widgetDoc: TextDocument;
		let widgetFactoryDoc: TextDocument;

		this.beforeAll(async function () {
			widgetDoc = await workspace.openTextDocument(`${root}/cfml/Widget.cfc`);
			widgetFactoryDoc = await workspace.openTextDocument(`${root}/cfml/WidgetFactory.cfc`);
		});

		it("should get definition for return type", async function () {
			const definition = await findDefinition(widgetFactoryDoc, 'name="create_with_new" returntype="|cfml.Widget"');
			assert.strictEqual(definition.targetUri.fsPath, `${root}/cfml/Widget.cfc`);
		});

		it("should get definition for new keyword", async function () {
			const definition = await findDefinition(widgetFactoryDoc, "var widget = new |cfml.Widget()");
			assert.strictEqual(definition.targetUri.fsPath, `${root}/cfml/Widget.cfc`);
		});

		it('should get definition for createObject("component")', async function () {
			const definition = await findDefinition(widgetFactoryDoc, 'createObject("component", "|cfml.Widget")');
			assert.strictEqual(definition.targetUri.fsPath, `${root}/cfml/Widget.cfc`);
		});

		it.skip("should get definition for createObject() with default type component", async function () {
			const definition = await findDefinition(widgetFactoryDoc, 'createObject("|cfml.Widget")');
			assert.strictEqual(definition.targetUri.fsPath, `${root}/cfml/Widget.cfc`);
		});

		it.skip("should get definition for cfparam type", async function () {
			const definition = await findDefinition(widgetDoc, 'cfparam type="|cfml.WidgetFactory"');
			assert.strictEqual(definition.targetUri.fsPath, `${root}/cfml/WidgetFactory.cfc`);
		});

		it("should get definition for cfargument type", async function () {
			const definition = await findDefinition(widgetFactoryDoc, 'cfargument type="|cfml.Widget"');
			assert.strictEqual(definition.targetUri.fsPath, `${root}/cfml/Widget.cfc`);
		});

		it.skip("should get definition for component as part of static method call", async function () {
			const definition = await findDefinition(widgetDoc, "|WidgetFactory::");
			assert.strictEqual(definition.targetUri.fsPath, `${root}/cfml/WidgetFactory.cfc`);
		});

		it("component name is case insensitive", async function () {
			const definition = await findDefinition(widgetFactoryDoc, "new |cFML.wIDGET");
			assert.strictEqual(definition.targetUri.fsPath, `${root}/cfml/Widget.cfc`);
		});

		it("should get definition for cfinvoke", async function () {
			const definition = await findDefinition(widgetFactoryDoc, '<cfinvoke component="|cfml.Widget"');
			assert.strictEqual(definition.targetUri.fsPath, `${root}/cfml/Widget.cfc`);
		});

		it.skip("should get definition for cfimport", async function () {
			const definition = await findDefinition(widgetFactoryDoc, '<cfimport path="|cfml.Widget">');
			assert.strictEqual(definition.targetUri.fsPath, `${root}/cfml/Widget.cfc`);
		});

		it("should get definition for isInstanceOf", async function () {
			const definition = await findDefinition(widgetFactoryDoc, 'isInstanceOf(widget, "|cfml.Widget")');
			assert.strictEqual(definition.targetUri.fsPath, `${root}/cfml/Widget.cfc`);
		});

		it("should get definition for extends", async function () {
			const definition = await findDefinition(widgetDoc, 'extends="|cfml.Base"');
			assert.strictEqual(definition.targetUri.fsPath, `${root}/cfml/Base.cfc`);
		});

		it("should get definition for implements", async function () {
			const definition = await findDefinition(widgetFactoryDoc, 'implements="|cfml.IFactory"');
			assert.strictEqual(definition.targetUri.fsPath, `${root}/cfml/IFactory.cfc`);
		});
	});

	describe("component definitions (CFSCRIPT)", function () {
		let gizmoDoc: TextDocument;
		let gizmoFactoryDoc: TextDocument;

		this.beforeAll(async function () {
			gizmoDoc = await workspace.openTextDocument(`${root}/cfscript/Gizmo.cfc`);
			gizmoFactoryDoc = await workspace.openTextDocument(`${root}/cfscript/GizmoFactory.cfc`);
		});

		it("should get definition for return type", async function () {
			const definition = await findDefinition(gizmoFactoryDoc, "|cfscript.Gizmo function create_with_new");
			assert.strictEqual(definition.targetUri.fsPath, `${root}/cfscript/Gizmo.cfc`);
		});

		it("should get definition for new keyword", async function () {
			const definition = await findDefinition(gizmoFactoryDoc, "var gizmo = new |cfscript.Gizmo();");
			assert.strictEqual(definition.targetUri.fsPath, `${root}/cfscript/Gizmo.cfc`);
		});

		it('should get definition for createObject("component")', async function () {
			const definition = await findDefinition(gizmoFactoryDoc, 'createObject("component", "|cfscript.Gizmo")');
			assert.strictEqual(definition.targetUri.fsPath, `${root}/cfscript/Gizmo.cfc`);
		});

		it.skip("should get definition for createObject() with default type component", async function () {
			const definition = await findDefinition(gizmoFactoryDoc, 'createObject("|cfscript.Gizmo")');
			assert.strictEqual(definition.targetUri.fsPath, `${root}/cfscript/Gizmo.cfc`);
		});

		it.skip("should get definition for cfparam type", async function () {
			const definition = await findDefinition(gizmoDoc, 'cfparam type="|cfscript.GizmoFactory"');
			assert.strictEqual(definition.targetUri.fsPath, `${root}/cfscript/GizmoFactory.cfc`);
		});

		it("should get definition for cfargument type", async function () {
			const definition = await findDefinition(gizmoFactoryDoc, "create_from(|cfscript.Gizmo source)");
			assert.strictEqual(definition.targetUri.fsPath, `${root}/cfscript/Gizmo.cfc`);
		});

		it.skip("should get definition for component as part of static method call", async function () {
			const definition = await findDefinition(gizmoDoc, "|GizmoFactory::");
			assert.strictEqual(definition.targetUri.fsPath, `${root}/cfscript/GizmoFactory.cfc`);
		});

		it("should get definition for component as part of method returntype (cfscript)", async function () {
			const definition = await findDefinition(gizmoDoc, "|cfscript.Gizmo function");
			assert.strictEqual(definition.targetUri.fsPath, `${root}/cfscript/Gizmo.cfc`);
		});

		it.skip("should get definition for component as part of method argument (cfscript)", async function () {
			const definition = await findDefinition(gizmoDoc, "(|cfscript.Gizmo gizmo)");
			assert.strictEqual(definition.targetUri.fsPath, `${root}/cfscript/Gizmo.cfc`);
		});

		// Works in CFML but not in CFScript
		it.skip("component name is case insensitive", async function () {
			const definition = await findDefinition(gizmoFactoryDoc, "new |cfSCRIPT.gizMO");
			assert.strictEqual(definition.targetUri.fsPath, `${root}/cfscript/Gizmo.cfc`);
		});

		it.skip("should get definition for cfinvoke", async function () {
			const definition = await findDefinition(gizmoFactoryDoc, 'return invoke("|cfscript.Gizmo"');
			assert.strictEqual(definition.targetUri.fsPath, `${root}/cfscript/Gizmo.cfc`);
		});

		it("should get definition for import", async function () {
			const definition = await findDefinition(gizmoFactoryDoc, 'import "|cfscript.Gizmo";');
			assert.strictEqual(definition.targetUri.fsPath, `${root}/cfscript/Gizmo.cfc`);
		});

		it("should get definition for isInstanceOf", async function () {
			const definition = await findDefinition(gizmoFactoryDoc, 'isInstanceOf(other, "|cfscript.Gizmo")');
			assert.strictEqual(definition.targetUri.fsPath, `${root}/cfscript/Gizmo.cfc`);
		});

		it("should get definition for extends", async function () {
			const definition = await findDefinition(gizmoDoc, 'extends="|cfscript.Base"');
			assert.strictEqual(definition.targetUri.fsPath, `${root}/cfscript/Base.cfc`);
		});

		it("should get definition for implements", async function () {
			const definition = await findDefinition(gizmoFactoryDoc, 'implements="|cfscript.IFactory"');
			assert.strictEqual(definition.targetUri.fsPath, `${root}/cfscript/IFactory.cfc`);
		});
	});

	describe("method definitions (CFML)", function () {
		let callMethodsDoc: TextDocument;

		this.beforeAll(async function () {
			callMethodsDoc = await workspace.openTextDocument(`${root}/cfml/WidgetCallMethods.cfc`);
		});

		it("should get definition for method of component variable", async function () {
			const definition = await findDefinition(callMethodsDoc, "widget.|render()");
			await assertDefinitionLinkTarget(definition, '<cffunction name="|render|"');
		});

		it("should get definition for method within component", async function () {
			const definition = await findDefinition(callMethodsDoc, "id = |generateID()");
			await assertDefinitionLinkTarget(definition, '<cffunction name="|generateID|">');
		});

		it.skip("should get definition for method as part of static method call", async function () {
			const definition = await findDefinition(callMethodsDoc, "Widget::|staticGenerateID()");
			await assertDefinitionLinkTarget(definition, '<cffunction name="|staticGenerateID|" modifier="static">');
		});

		it.skip("should get definition for cfinvoke", async function () {
			const definition = await findDefinition(callMethodsDoc, '<invoke component="cfml.Widget" method="|staticGenerateID">');
			await assertDefinitionLinkTarget(definition, '<cffunction name="|staticGenerateID|" modifier="static">');
		});
	});

	describe("method definitions (CFSCRIPT)", function () {
		let callMethodsDoc: TextDocument;

		this.beforeAll(async function () {
			callMethodsDoc = await workspace.openTextDocument(`${root}/cfscript/GizmoCallMethods.cfc`);
		});

		it("should get definition for method of component variable", async function () {
			const definition = await findDefinition(callMethodsDoc, "gizmo.|render()");
			await assertDefinitionLinkTarget(definition, "function |render|()");
		});

		it("should get definition for method within component", async function () {
			const definition = await findDefinition(callMethodsDoc, "id = |generateID()");
			await assertDefinitionLinkTarget(definition, "function |generateID|()");
		});

		it.skip("should get definition for method as part of static method call", async function () {
			const definition = await findDefinition(callMethodsDoc, "Gizmo::|staticGenerateID");
			await assertDefinitionLinkTarget(definition, "static function |staticGenerateID|()");
		});

		it.skip("should get definition for cfinvoke", async function () {
			const definition = await findDefinition(callMethodsDoc, 'return invoke("cfscript.Gizmo", "|staticGenerateID")');
			await assertDefinitionLinkTarget(definition, "static function |staticGenerateID|()");
		});
	});
});
