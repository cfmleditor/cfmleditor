import * as assert from "assert";

import { chooseServer, newerTag, platformForTarget } from "../lsp/serverAsset";

describe("LSP server choice", function () {
	// The extension ships a server for its platform, so the question at startup
	// is no longer "can we download one" but "is the one we have the one that
	// was asked for".
	describe("when GitHub answered", function () {
		it("runs a download it already has", function () {
			assert.deepStrictEqual(chooseServer("v0.3.2", "v0.3.1", ["v0.3.2"]), { source: "cached", tag: "v0.3.2" });
		});

		it("runs the bundled server rather than downloading the same version", function () {
			assert.deepStrictEqual(chooseServer("v0.3.2", "v0.3.2", []), { source: "bundled", tag: "v0.3.2" });
		});

		it("downloads when what was asked for is newer than anything here", function () {
			assert.deepStrictEqual(chooseServer("v0.4.0", "v0.3.2", ["v0.3.1"]), { source: "download", tag: "v0.4.0" });
		});
	});

	// Offline, proxied, rate limited, or simply a GitHub nobody at this site can
	// reach: the version that shipped is still a working language server, which
	// is the whole point of bundling one.
	describe("when GitHub could not be reached", function () {
		it("falls back to the bundled server", function () {
			assert.deepStrictEqual(chooseServer(undefined, "v0.3.2", []), { source: "bundled", tag: "v0.3.2" });
		});

		it("prefers a newer download over the bundled server", function () {
			assert.deepStrictEqual(chooseServer(undefined, "v0.3.2", ["v0.4.0", "v0.1.0"]), { source: "cached", tag: "v0.4.0" });
		});

		it("keeps the bundled server when it is the newer one", function () {
			assert.deepStrictEqual(chooseServer(undefined, "v0.5.0", ["v0.4.0"]), { source: "bundled", tag: "v0.5.0" });
		});

		// Same version either way, so the copy that came with the extension wins:
		// a download can have been cut short, the packaged one cannot.
		it("prefers the bundled copy of the same version", function () {
			assert.deepStrictEqual(chooseServer(undefined, "v0.3.2", ["v0.3.2"]), { source: "bundled", tag: "v0.3.2" });
		});

		it("has nothing to offer a universal build with an empty cache", function () {
			assert.strictEqual(chooseServer(undefined, undefined, []), undefined);
		});

		it("downloads for a universal build that knows what it wants", function () {
			assert.deepStrictEqual(chooseServer("v0.3.2", undefined, []), { source: "download", tag: "v0.3.2" });
		});
	});

	// The cache used to be picked by sorting directory names, which puts v0.9.0
	// after v0.10.0 and would pin an install to an old server the day the minor
	// version reaches double digits.
	describe("version comparison", function () {
		it("compares versions as numbers, not as text", function () {
			assert.strictEqual(newerTag("v0.9.0", "v0.10.0"), "v0.10.0");
			assert.deepStrictEqual(chooseServer(undefined, "v0.9.0", ["v0.10.0"]), { source: "cached", tag: "v0.10.0" });
		});

		it("keeps whichever side it can read when the other makes no sense", function () {
			assert.strictEqual(newerTag("nightly", "v0.3.2"), "v0.3.2");
			assert.strictEqual(newerTag("v0.3.2", "nightly"), "v0.3.2");
		});
	});

	// `vsce package --target win32-arm64` and a user running Windows on ARM have
	// to land on the same asset, or the extension ships a binary it then ignores.
	describe("packaging targets", function () {
		it("maps a packaging target onto the platform the extension sees", function () {
			assert.deepStrictEqual(platformForTarget("darwin-arm64"), { platform: "darwin", arch: "arm64" });
			assert.deepStrictEqual(platformForTarget("win32-x64"), { platform: "win32", arch: "x64" });
			assert.deepStrictEqual(platformForTarget("alpine-x64"), { platform: "linux", arch: "x64" });
			assert.deepStrictEqual(platformForTarget("linux-armhf"), { platform: "linux", arch: "x64" });
		});
	});
});
