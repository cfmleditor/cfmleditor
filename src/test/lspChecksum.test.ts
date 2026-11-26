import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { CHECKSUMS_PUBLISHED_FROM, ChecksumError, checksumRequired, parseChecksumFile, sha256OfFile, verifyArchive, verifyChecksum } from "../lsp/checksum";

// SHA-256 of "abc", from FIPS 180-2
const ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

describe("LSP checksums", function () {
	let dir: string;
	let file: string;

	beforeEach(function () {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "cfml-checksum-"));
		file = path.join(dir, "clif-linux-amd64.tar.gz");
		fs.writeFileSync(file, "abc");
	});

	afterEach(function () {
		fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
	});

	describe("which releases need a checksum", function () {
		it("needs one from the first release that publishes them", function () {
			assert.strictEqual(CHECKSUMS_PUBLISHED_FROM, "0.7.6");
			assert.strictEqual(checksumRequired("v0.7.6"), true);
			assert.strictEqual(checksumRequired("v0.7.7"), true);
			assert.strictEqual(checksumRequired("v0.10.0"), true);
			assert.strictEqual(checksumRequired("v1.0.0"), true);
		});

		it("does not need one before that", function () {
			assert.strictEqual(checksumRequired("v0.7.5"), false);
			assert.strictEqual(checksumRequired("v0.7.0"), false);
			assert.strictEqual(checksumRequired("v0.6.99"), false);
		});

		it("compares versions as numbers, not as text", function () {
			assert.strictEqual(checksumRequired("v0.10.0"), true);
			assert.strictEqual(checksumRequired("v0.7.10"), true);
		});

		it("needs one for a tag that is not a version, rather than skipping the check", function () {
			assert.strictEqual(checksumRequired("nightly"), true);
			assert.strictEqual(checksumRequired(""), true);
		});
	});

	describe("reading a checksum file", function () {
		const name = "clif-linux-amd64.tar.gz";

		it("reads sha256sum output", function () {
			assert.strictEqual(parseChecksumFile(`${ABC}  ${name}\n`, name), ABC);
		});

		it("reads a binary-mode line, a single space, and CRLF line endings", function () {
			assert.strictEqual(parseChecksumFile(`${ABC} *${name}\r\n`, name), ABC);
			assert.strictEqual(parseChecksumFile(`${ABC} ${name}\n`, name), ABC);
			assert.strictEqual(parseChecksumFile(`${ABC}  ${name}`, name), ABC);
		});

		it("reads a bare hash", function () {
			assert.strictEqual(parseChecksumFile(`${ABC}\n`, name), ABC);
		});

		it("returns the hash in lower case whatever case it was written in", function () {
			assert.strictEqual(parseChecksumFile(`${ABC.toUpperCase()}  ${name}\n`, name), ABC);
		});

		it("refuses a checksum for another archive", function () {
			assert.throws(() => parseChecksumFile(`${ABC}  clif-darwin-arm64.tar.gz\n`, name), /is for clif-darwin-arm64\.tar\.gz, not clif-linux-amd64\.tar\.gz/);
		});

		it("refuses text that is not a SHA-256", function () {
			for (const text of ["", "\n", "nothing", `${ABC.slice(1)}  ${name}`, `${ABC}0  ${name}`, `${"g".repeat(64)}  ${name}`, "<html>404</html>"]) {
				assert.throws(() => parseChecksumFile(text, name), ChecksumError, JSON.stringify(text));
			}
		});

		it("refuses more than one line, which is checksums for more than one thing", function () {
			assert.throws(() => parseChecksumFile(`${ABC}  ${name}\n${ABC}  other.tar.gz\n`, name), /not a single line/);
		});
	});

	describe("hashing a file", function () {
		it("computes the SHA-256", async function () {
			assert.strictEqual(await sha256OfFile(file), ABC);
		});

		it("hashes a file larger than one read", async function () {
			const big = path.join(dir, "big.bin");
			fs.writeFileSync(big, Buffer.alloc(5_000_000, 1));

			assert.match(await sha256OfFile(big), /^[0-9a-f]{64}$/);
		});

		it("rejects for a file that is not there", async function () {
			await assert.rejects(sha256OfFile(path.join(dir, "missing")), /ENOENT/);
		});
	});

	describe("checking an archive", function () {
		const name = "clif-linux-amd64.tar.gz";

		it("accepts a match", async function () {
			await verifyChecksum(file, `${ABC}  ${name}\n`, name);
		});

		it("refuses a mismatch, naming both hashes", async function () {
			await assert.rejects(verifyChecksum(file, `${"0".repeat(64)}  ${name}\n`, name), (error: unknown) => {
				return error instanceof ChecksumError && error.message.includes(`expected ${"0".repeat(12)}…`) && error.message.includes(`got ${ABC.slice(0, 12)}…`);
			});
		});

		it("refuses an archive that changed by one byte", async function () {
			fs.writeFileSync(file, "abd");

			await assert.rejects(verifyChecksum(file, `${ABC}  ${name}\n`, name), ChecksumError);
		});
	});

	describe("applying the rules", function () {
		const name = "clif-linux-amd64.tar.gz";

		it("checks a checksum that is there, for any release", async function () {
			for (const tag of ["v0.7.7", "v0.7.5"]) {
				const warnings: string[] = [];

				await verifyArchive({ tag, assetName: name, archivePath: file, checksumText: `${ABC}  ${name}\n`, warn: m => warnings.push(m) });
				assert.strictEqual(warnings.length, 0, tag);

				await assert.rejects(
					verifyArchive({ tag, assetName: name, archivePath: file, checksumText: `${"0".repeat(64)}  ${name}\n`, warn: m => warnings.push(m) }),
					(error: unknown) => error instanceof ChecksumError
				);
			}
		});

		it("refuses a missing checksum from the first release that publishes them", async function () {
			await assert.rejects(
				verifyArchive({ tag: "v0.7.6", assetName: name, archivePath: file, checksumText: undefined, warn: () => undefined }),
				/v0\.7\.6 publishes no checksum for clif-linux-amd64\.tar\.gz/
			);
		});

		it("accepts a missing checksum before then, and says so", async function () {
			const warnings: string[] = [];

			await verifyArchive({ tag: "v0.7.5", assetName: name, archivePath: file, checksumText: undefined, warn: m => warnings.push(m) });

			assert.strictEqual(warnings.length, 1);
			assert.match(warnings[0], /v0\.7\.5 is older than 0\.7\.6/);
		});
	});
});
