import * as assert from "assert";
import * as path from "path";

import { assetCandidates, pathWithBundledTools } from "../lsp/cfmlLspClient";
import { cflintAssetCandidates } from "../lsp/serverAsset";

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

describe("CFLint asset selection", function () {
	// CFLint spells its platforms differently from the server: `macos` rather
	// than `darwin`, `aarch64` rather than `arm64`. Getting this wrong ships an
	// extension that silently has no linter.
	it("uses CFLint's own platform spelling", function () {
		assert.strictEqual(cflintAssetCandidates("darwin", "arm64").assetNames[0], "cflint-macos-aarch64.tar.gz");
		assert.strictEqual(cflintAssetCandidates("linux", "arm64").assetNames[0], "cflint-linux-aarch64.tar.gz");
		assert.strictEqual(cflintAssetCandidates("linux", "x64").assetNames[0], "cflint-linux-amd64.tar.gz");
	});

	// The macOS Intel build is not published yet. Asking for it by the right
	// name is what makes the packages pick it up the day it is, without another
	// change here.
	it("asks for the macOS Intel build by the name it will have", function () {
		assert.strictEqual(cflintAssetCandidates("darwin", "x64").assetNames[0], "cflint-macos-amd64.tar.gz");
	});

	// A GraalVM image is ~90 MB raw and ~28 MB compressed, so the compressed
	// asset is worth preferring — but it only exists in newer releases, and a
	// pinned older one still has to resolve to something.
	it("prefers the compressed asset and falls back to the raw binary", function () {
		assert.deepStrictEqual(cflintAssetCandidates("linux", "x64").assetNames, [
			"cflint-linux-amd64.tar.gz",
			"cflint-linux-amd64",
		]);
		assert.deepStrictEqual(cflintAssetCandidates("win32", "x64").assetNames, [
			"cflint-windows-amd64.zip",
			"cflint-windows-amd64.exe",
		]);
	});

	// The server looks for `cflint` on PATH, so that is the name it has to land
	// under whichever asset it came from.
	it("lands under the name the server looks for", function () {
		assert.strictEqual(cflintAssetCandidates("linux", "x64").binaryName, "cflint");
		assert.strictEqual(cflintAssetCandidates("win32", "arm64").binaryName, "cflint.exe");
	});
});

describe("Bundled tools on the server's PATH", function () {
	// The server looks for `cflint` on PATH before its own cache, so this is the
	// entire handshake between the extension and the linter it ships.
	it("adds the bundled directory to PATH", function () {
		assert.deepStrictEqual(
			pathWithBundledTools({ PATH: `/usr/bin${path.delimiter}/bin` }, "/ext/server"),
			{ PATH: `/usr/bin${path.delimiter}/bin${path.delimiter}/ext/server` }
		);
	});

	// Appended, not prepended: a `cflint` the user installed themselves still
	// wins, which is the order the server already prefers.
	it("puts it last, behind anything the user installed", function () {
		const result = pathWithBundledTools({ PATH: "/usr/local/bin" }, "/ext/server");
		assert.ok(result.PATH.indexOf("/usr/local/bin") < result.PATH.indexOf("/ext/server"));
	});

	// Windows calls it `Path`, and the client merges these over a copy of the
	// environment — so writing `PATH` there would leave the server with two path
	// variables and no say in which one it gets.
	it("keeps the name the environment already uses", function () {
		assert.deepStrictEqual(
			pathWithBundledTools({ Path: "C:\\Windows" }, "C:\\ext\\server"),
			{ Path: `C:\\Windows${path.delimiter}C:\\ext\\server` }
		);
	});

	it("copes with an environment that has no PATH at all", function () {
		assert.deepStrictEqual(pathWithBundledTools({}, "/ext/server"), { PATH: "/ext/server" });
	});
});
