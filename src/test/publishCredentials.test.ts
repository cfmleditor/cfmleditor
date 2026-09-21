import * as assert from "assert";
import * as path from "path";

import { credentialFor } from "../scripts/publish-targets";

// The repository root, not `process.cwd()`: the test host runs from wherever
// VS Code was unpacked, which on Windows is the downloaded editor rather than
// this checkout.
const ROOT_DIR = path.join(__dirname, "..", "..");

const MARKETPLACE = { name: "VS Marketplace", command: "vsce", tokenVar: "VSCE_PAT" };
const OPEN_VSX = { name: "Open VSX", command: "ovsx", tokenVar: "OVSX_PAT" };

describe("Publish credentials", function () {
	// The rules are tested with the lookup stubbed rather than by running
	// `vsce ls-publishers`: what is worth pinning is which credential wins, and
	// spawning npx to find out is both slow and an answer that depends on
	// whoever is running the tests.
	const noPublishers = () => [];
	const loggedIn = () => ["cfmleditor"];

	function withoutToken(tokenVar: string, run: () => void): void {
		const prior = process.env[tokenVar];
		delete process.env[tokenVar];

		try {
			run();
		}
		finally {
			if (prior !== undefined) {
				process.env[tokenVar] = prior;
			}
		}
	}

	// `vsce login <publisher>` puts a token in the OS keychain and `vsce
	// publish` uses it when none is passed, so insisting on the variable turned
	// a machine that was already logged in away at the door.
	it("accepts a stored vsce login for the publisher", function () {
		withoutToken("VSCE_PAT", () => {
			assert.strictEqual(credentialFor(MARKETPLACE, ROOT_DIR, loggedIn), "vsce login cfmleditor");
		});
	});

	it("has no credential when nobody is logged in", function () {
		withoutToken("VSCE_PAT", () => {
			assert.strictEqual(credentialFor(MARKETPLACE, ROOT_DIR, noPublishers), undefined);
		});
	});

	// The release is checked for credentials before the build, which takes a
	// minute and a half — and before publishing to one registry and then
	// failing on the other, which leaves a release half out the door.
	it("takes the token from the environment ahead of a login", function () {
		const prior = process.env.VSCE_PAT;
		process.env.VSCE_PAT = "a-token";

		try {
			assert.strictEqual(credentialFor(MARKETPLACE, ROOT_DIR, loggedIn), "VSCE_PAT");
		}
		finally {
			if (prior === undefined) {
				delete process.env.VSCE_PAT;
			}
			else {
				process.env.VSCE_PAT = prior;
			}
		}
	});

	// `ovsx` has no login of its own: the token is the only way in, so a
	// publisher in the keychain means nothing to it.
	it("has nothing but the token to offer for Open VSX", function () {
		withoutToken("OVSX_PAT", () => {
			assert.strictEqual(credentialFor(OPEN_VSX, ROOT_DIR, loggedIn), undefined);
		});

		const prior = process.env.OVSX_PAT;
		process.env.OVSX_PAT = "a-token";

		try {
			assert.strictEqual(credentialFor(OPEN_VSX, ROOT_DIR, noPublishers), "OVSX_PAT");
		}
		finally {
			if (prior === undefined) {
				delete process.env.OVSX_PAT;
			}
			else {
				process.env.OVSX_PAT = prior;
			}
		}
	});
});
