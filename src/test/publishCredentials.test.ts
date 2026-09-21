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
	// The release is checked for credentials before the build, which takes a
	// minute and a half — and before publishing to one registry and then
	// failing on the other, which leaves a release half out the door.
	it("takes the token from the environment", function () {
		const prior = process.env.OVSX_PAT;
		process.env.OVSX_PAT = "a-token";

		try {
			assert.strictEqual(credentialFor(OPEN_VSX, ROOT_DIR), "OVSX_PAT");
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

	// `ovsx` has no login of its own: the token is the only way in, so a
	// machine without one has no credential however it is set up.
	it("has nothing else to offer for Open VSX", function () {
		const prior = process.env.OVSX_PAT;
		delete process.env.OVSX_PAT;

		try {
			assert.strictEqual(credentialFor(OPEN_VSX, ROOT_DIR), undefined);
		}
		finally {
			if (prior !== undefined) {
				process.env.OVSX_PAT = prior;
			}
		}
	});

	// `vsce login <publisher>` puts a token in the OS keychain and `vsce
	// publish` uses it when none is passed, so insisting on the variable
	// turned a machine that was already logged in away at the door. Which of
	// the two this machine has is not the point; that it is one of them is.
	it("accepts either a token or a stored vsce login", function () {
		const source = credentialFor(MARKETPLACE, ROOT_DIR);

		assert.ok(
			source === undefined || source === "VSCE_PAT" || source.startsWith("vsce login "),
			`unexpected credential source ${String(source)}`
		);
	});
});
