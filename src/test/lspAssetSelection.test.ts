import * as assert from "assert";

import { assetCandidates } from "../lsp/cfmlLspClient";

describe("LSP asset selection", function () {
	const names = (platform: string, arch: string) => assetCandidates(platform, arch).assets.map(a => a.name);

	// Extracting the zip shelled out to `unzip`, which stock Windows does not
	// have — so the only platform that was ever handed a zip was the only one
	// that could not open it. Every current release ships a tar.gz as well.
	it("asks for a tar.gz on every platform", function () {
		for (const platform of ["darwin", "linux", "win32"]) {
			assert.ok(names(platform, "amd64")[0].endsWith(".tar.gz"), `${platform} should prefer a tar.gz`);
		}
	});

	// Releases before v0.2.6 ship nothing else for Windows, and `cfml.lsp.version`
	// can still pin one. Releases before the rename ship only cfmleditor-lsp
	// assets, so those follow the clif ones.
	it("keeps the Windows zip as a fallback, and only there", function () {
		assert.deepStrictEqual(names("win32", "x64"), [
			"clif-windows-amd64.tar.gz",
			"clif-windows-amd64.zip",
			"cfmleditor-lsp-windows-amd64.tar.gz",
			"cfmleditor-lsp-windows-amd64.zip",
		]);
		assert.deepStrictEqual(names("linux", "x64"), ["clif-linux-amd64.tar.gz", "cfmleditor-lsp-linux-amd64.tar.gz"]);
	});

	// There has been no windows-arm64 asset since v0.1.12, and Windows on ARM
	// runs the amd64 binary under emulation. Asking for one produced a 404 that
	// read like the release was broken.
	it("sends Windows on ARM to the amd64 binary", function () {
		assert.ok(names("win32", "arm64").every(n => n.includes("windows-amd64")));
	});

	it("still asks for arm64 where it is published", function () {
		assert.strictEqual(names("darwin", "arm64")[0], "clif-darwin-arm64.tar.gz");
		assert.strictEqual(names("linux", "arm64")[0], "clif-linux-arm64.tar.gz");
	});

	// Each archive holds a binary of its own name, and whichever is found is
	// installed as clif, so nothing else has to know which one was downloaded.
	it("names the binary each archive contains, and installs it as clif", function () {
		const win = assetCandidates("win32", "x64");
		assert.strictEqual(win.binaryName, "clif.exe");
		assert.deepStrictEqual(win.assets.map(a => a.binary), ["clif.exe", "clif.exe", "cfmleditor-lsp.exe", "cfmleditor-lsp.exe"]);

		const mac = assetCandidates("darwin", "arm64");
		assert.strictEqual(mac.binaryName, "clif");
		assert.deepStrictEqual(mac.assets.map(a => a.binary), ["clif", "cfmleditor-lsp"]);
	});
});
