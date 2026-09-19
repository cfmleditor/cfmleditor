import * as assert from "assert";

import { pinnedTag, tagFromReleaseRedirect } from "../lsp/cfmlLspClient";

describe("LSP release resolution", function () {
	// The releases API is rate limited to 60 requests an hour per IP for
	// unauthenticated callers, shared by everyone behind one NAT, and the
	// extension asked on every server start. `/releases/latest` redirects with no
	// API involved and no limit, so the tag is read from the redirect instead.
	it("reads the tag from the redirect GitHub actually sends", function () {
		assert.strictEqual(
			tagFromReleaseRedirect("https://github.com/cfmleditor/cfmleditor-lsp/releases/tag/v0.3.1"),
			"v0.3.1"
		);
	});

	it("ignores a query string or fragment on the redirect", function () {
		assert.strictEqual(tagFromReleaseRedirect("https://github.com/o/r/releases/tag/v1.2.3?x=1"), "v1.2.3");
		assert.strictEqual(tagFromReleaseRedirect("https://github.com/o/r/releases/tag/v1.2.3#notes"), "v1.2.3");
	});

	it("decodes a tag that needed escaping", function () {
		assert.strictEqual(tagFromReleaseRedirect("https://github.com/o/r/releases/tag/v1.0%2Bbuild"), "v1.0+build");
	});

	// An empty Location, or one pointing somewhere else, must fail loudly rather
	// than produce a tag that builds a download URL for nothing.
	it("refuses a redirect it cannot read a tag from", function () {
		for (const location of ["", "https://github.com/o/r/releases", "https://example.com/"]) {
			assert.throws(() => tagFromReleaseRedirect(location), /Could not read a release tag/);
		}
	});

	// A pinned version needs no network at all, so it must not be sent looking
	// for one — and it is written both with and without the leading v.
	it("maps a configured version onto its tag", function () {
		assert.strictEqual(pinnedTag("0.3.1"), "v0.3.1");
		assert.strictEqual(pinnedTag("v0.3.1"), "v0.3.1");
		assert.strictEqual(pinnedTag("latest"), undefined);
		assert.strictEqual(pinnedTag(""), undefined);
	});
});
