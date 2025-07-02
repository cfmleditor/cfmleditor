import * as assert from "assert/strict";
import { Uri } from "vscode";

/**
 * NOTE: This `convertPathToPackageName` doesn't run in the context of the active extension,
 *       and cannot use the workspace API.
 */
import { convertPathToPackageName } from "../utils/cfcPackages";

describe("convertPathToPackageName", function () {
	it("should convert path relative to workspace folder", function () {
		const packageName = convertPathToPackageName(
			Uri.parse("/Users/foo.bar/example/src/components/MyComponent.cfc"),
			Uri.parse("/Users/foo.bar/example"),
			[]
		);
		assert.strictEqual(packageName, "src.components.MyComponent");
	});
	it("should convert path relative to mapping", function () {
		const packageName = convertPathToPackageName(
			Uri.parse("/Users/foo.bar/example/src/components/MyComponent.cfc"),
			Uri.parse("/Users/foo.bar/example"),
			[
				{ logicalPath: "/com", directoryPath: "src/components", isPhysicalDirectoryPath: false },
			]
		);
		assert.strictEqual(packageName, "com.MyComponent");
	});
	it("should convert path relative to mapping and webroot", function () {
		const packageName = convertPathToPackageName(
			Uri.parse("/Users/foo.bar/example/src/components/MyComponent.cfc"),
			Uri.parse("/Users/foo.bar/example/src"),
			[
				{ logicalPath: "/com", directoryPath: "components", isPhysicalDirectoryPath: false },
			]
		);
		assert.strictEqual(packageName, "com.MyComponent");
	});
	it("should convert path relative to physical mapping", function () {
		const packageName = convertPathToPackageName(
			Uri.parse("/Users/foo.bar/example/src/components/MyComponent.cfc"),
			Uri.parse("/Users/foo.bar/example"),
			[
				{ logicalPath: "/com", directoryPath: "/Users/foo.bar/example/src/components", isPhysicalDirectoryPath: true },
			]
		);
		assert.strictEqual(packageName, "com.MyComponent");
	});
});
