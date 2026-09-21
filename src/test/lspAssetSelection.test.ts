import * as assert from "assert";

import { assetCandidates } from "../lsp/cfmlLspClient";

describe("LSP asset selection", function () {
	// Extracting the zip shelled out to `unzip`, which stock Windows does not
	// have — so the only platform that was ever handed a zip was the only one
	// that could not open it. Every current release ships a tar.gz as well.
	it("asks for a tar.gz on every platform", function () {
		for (const platform of ["darwin", "linux", "win32"]) {
			assert.ok(
				assetCandidates(platform, "amd64").assetNames[0].endsWith(".tar.gz"),
				`${platform} should prefer a tar.gz`
			);
		}
	});

	// Releases before v0.2.6 ship nothing else for Windows, and `cfml.lsp.version`
	// can still pin one.
	it("keeps the Windows zip as a fallback, and only there", function () {
		assert.deepStrictEqual(assetCandidates("win32", "x64").assetNames, [
			"cfmleditor-lsp-windows-amd64.tar.gz",
			"cfmleditor-lsp-windows-amd64.zip",
		]);
		assert.strictEqual(assetCandidates("linux", "x64").assetNames.length, 1);
	});

	// There has been no windows-arm64 asset since v0.1.12, and Windows on ARM
	// runs the amd64 binary under emulation. Asking for one produced a 404 that
	// read like the release was broken.
	it("sends Windows on ARM to the amd64 binary", function () {
		assert.deepStrictEqual(assetCandidates("win32", "arm64").assetNames, [
			"cfmleditor-lsp-windows-amd64.tar.gz",
			"cfmleditor-lsp-windows-amd64.zip",
		]);
	});

	it("still asks for arm64 where it is published", function () {
		assert.strictEqual(assetCandidates("darwin", "arm64").assetNames[0], "cfmleditor-lsp-darwin-arm64.tar.gz");
		assert.strictEqual(assetCandidates("linux", "arm64").assetNames[0], "cfmleditor-lsp-linux-arm64.tar.gz");
	});

	it("names the binary the archive actually contains", function () {
		assert.strictEqual(assetCandidates("win32", "x64").binaryName, "cfmleditor-lsp.exe");
		assert.strictEqual(assetCandidates("darwin", "arm64").binaryName, "cfmleditor-lsp");
	});
});
