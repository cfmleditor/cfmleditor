import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { ConfigurationTarget, workspace } from "vscode";

import { FORMAT_KEYS, buildInitializationOptions } from "../lsp/cfmlLspClient";

/**
 * Reads the `cfml.format.*` settings the extension declares.
 * @returns the setting names, without their `cfml.format.` prefix
 */
function declaredFormatSettings(): string[] {
	const pkgPath = path.resolve(__dirname, "..", "..", "package.json");
	const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
		contributes: { configuration: { properties: Record<string, unknown> } };
	};

	return Object.keys(pkg.contributes.configuration.properties)
		.filter(k => k.startsWith("cfml.format."))
		.map(k => k.slice("cfml.format.".length))
		.sort();
}

describe("LSP initializationOptions", function () {
	// The key list and the declared settings are two hand-maintained lists of
	// the same thing. A setting declared but not listed is one the user can set
	// and the server never hears about; a key listed but not declared is one
	// nobody can set. Neither fails at runtime — the payload is just quietly
	// missing a value — so it is checked here.
	it("sends every declared cfml.format setting, and vice versa", function () {
		assert.deepStrictEqual([...FORMAT_KEYS].sort(), declaredFormatSettings());
	});

	// The property the whole design rests on. VS Code reads back a value for
	// every setting whether or not anyone chose it, so building the payload
	// from values alone would have an untouched install assert twenty defaults
	// over any a project's .cfmleditor.json did not name.
	it("sends nothing for an untouched configuration", function () {
		assert.strictEqual(buildInitializationOptions(), undefined);
	});

	it("sends an explicitly set value", async function () {
		const config = workspace.getConfiguration("cfml.format");
		await config.update("braceStyle", "next-line", ConfigurationTarget.Global);

		try {
			assert.deepStrictEqual(buildInitializationOptions(), {
				formatting: { braceStyle: "next-line" },
			});
		}
		finally {
			await config.update("braceStyle", undefined, ConfigurationTarget.Global);
		}

		assert.strictEqual(buildInitializationOptions(), undefined);
	});
});
