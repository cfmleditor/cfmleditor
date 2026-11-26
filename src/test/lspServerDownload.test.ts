import * as assert from "assert";
import * as crypto from "crypto";
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import { PassThrough, Readable } from "stream";
import { pack } from "tar-stream";
import * as zlib from "zlib";

import { HttpStatusError } from "../lsp/httpRequest";
import { ServerAsset } from "../lsp/serverAsset";
import { downloadFile, installServer, resolveLatestTag } from "../lsp/serverDownload";

type Fake = { status: number; body?: Buffer; headers?: http.IncomingHttpHeaders };

/**
 * Builds a response the way the HTTP layer hands one over: a readable body with a status and headers.
 * @param fake what the response should say
 * @returns the response
 */
function respond(fake: Fake): http.IncomingMessage {
	const stream = Readable.from(fake.body ? [fake.body] : []) as unknown as http.IncomingMessage;
	stream.statusCode = fake.status;
	stream.headers = fake.headers ?? {};

	return stream;
}

/**
 * Answers requests from a table of URLs, recording which were asked for.
 * @param table responses by URL; anything else is a 404
 * @returns the request function and the URLs it was asked for, in order
 */
function fakeRequest(table: Record<string, Fake>): { request: (url: string) => Promise<http.IncomingMessage>; asked: string[] } {
	const asked: string[] = [];

	return {
		asked,
		request: (url: string) => {
			asked.push(url);

			return Promise.resolve(respond(table[url] ?? { status: 404 }));
		},
	};
}

async function tarGz(entries: Record<string, string>): Promise<Buffer> {
	const tar = pack();
	for (const [name, content] of Object.entries(entries)) {
		tar.entry({ name }, content);
	}
	tar.finalize();

	const chunks: Buffer[] = [];
	for await (const chunk of tar.pipe(zlib.createGzip())) {
		chunks.push(chunk as Buffer);
	}

	return Buffer.concat(chunks);
}

describe("LSP server download", function () {
	const RELEASES = "https://example.test/releases";
	let dir: string;

	beforeEach(function () {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "cfml-download-"));
	});

	afterEach(function () {
		fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
	});

	describe("downloadFile", function () {
		it("writes the body to the file", async function () {
			const { request } = fakeRequest({ "https://x.test/a": { status: 200, body: Buffer.from("hello") } });
			const dest = path.join(dir, "a.bin");

			await downloadFile("https://x.test/a", dest, request);

			assert.strictEqual(fs.readFileSync(dest, "utf8"), "hello");
		});

		it("rejects with the status for anything but a 200, writing nothing", async function () {
			const { request } = fakeRequest({ "https://x.test/a": { status: 403, body: Buffer.from("denied") } });
			const dest = path.join(dir, "a.bin");

			await assert.rejects(downloadFile("https://x.test/a", dest, request), (error: unknown) => {
				return error instanceof HttpStatusError && error.statusCode === 403;
			});
			assert.ok(!fs.existsSync(dest));
		});

		it("rejects when the transfer fails part way through", async function () {
			const body = new PassThrough();
			const response = body as unknown as http.IncomingMessage;
			response.statusCode = 200;
			response.headers = {};
			const dest = path.join(dir, "a.bin");

			const result = downloadFile("https://x.test/a", dest, () => Promise.resolve(response));
			body.write("partial");
			// What the idle timeout does to a response that goes quiet
			setImmediate(() => body.destroy(new Error("Timed out")));

			await assert.rejects(result, /Timed out/);
		});
	});

	describe("resolveLatestTag", function () {
		const location = (tag: string) => ({ status: 302, headers: { location: `https://github.com/o/r/releases/tag/${tag}` } });

		it("reads the tag from the redirect", async function () {
			const { request, asked } = fakeRequest({ [`${RELEASES}/latest`]: location("v0.7.4") });

			assert.strictEqual(await resolveLatestTag(request, RELEASES), "v0.7.4");
			assert.deepStrictEqual(asked, [`${RELEASES}/latest`]);
		});

		it("follows a renamed repository's redirect to its new name", async function () {
			const { request } = fakeRequest({
				[`${RELEASES}/latest`]: { status: 301, headers: { location: "https://github.com/new/name/releases/latest" } },
				"https://github.com/new/name/releases/latest": location("v1.2.3"),
			});

			assert.strictEqual(await resolveLatestTag(request, RELEASES), "v1.2.3");
		});

		it("rejects when the page answers with something other than a redirect", async function () {
			const { request } = fakeRequest({ [`${RELEASES}/latest`]: { status: 503 } });

			await assert.rejects(resolveLatestTag(request, RELEASES), /HTTP 503 resolving the latest release/);
		});

		it("rejects a redirect it cannot read a tag from", async function () {
			const { request } = fakeRequest({ [`${RELEASES}/latest`]: { status: 302, headers: { location: "https://login.test/portal" } } });

			await assert.rejects(resolveLatestTag(request, RELEASES), /Could not read a release tag/);
		});

		it("gives up on a redirect loop", async function () {
			const loop = { status: 302, headers: { location: "https://github.com/o/r/releases/latest" } };
			const { request, asked } = fakeRequest({ [`${RELEASES}/latest`]: loop, "https://github.com/o/r/releases/latest": loop });

			await assert.rejects(resolveLatestTag(request, RELEASES), /Too many redirects/);
			assert.strictEqual(asked.length, 3);
		});
	});

	describe("installServer", function () {
		const clif: ServerAsset = { name: "clif-linux-amd64.tar.gz", binary: "clif" };
		const legacy: ServerAsset = { name: "cfmleditor-lsp-linux-amd64.tar.gz", binary: "cfmleditor-lsp" };
		const url = (asset: ServerAsset, tag = "v1.0.0") => `${RELEASES}/download/${tag}/${asset.name}`;
		const sumUrl = (asset: ServerAsset, tag = "v1.0.0") => `${url(asset, tag)}.sha256`;
		const sha256 = (body: Buffer) => crypto.createHash("sha256").update(body).digest("hex");
		const options = (versionDir: string, request: (url: string) => Promise<http.IncomingMessage>, assets: ServerAsset[], tag = "v1.0.0") => ({
			tag, assets, versionDir, binaryName: "clif", request, releasesUrl: RELEASES, platform: "linux",
		});

		/**
		 * What a release serves for one archive: the archive, and the `.sha256` beside it, in `sha256sum` format.
		 * @param asset the archive
		 * @param body the archive's bytes
		 * @param tag the release
		 * @returns the responses to serve
		 */
		const publish = (asset: ServerAsset, body: Buffer, tag = "v1.0.0"): Record<string, Fake> => ({
			[url(asset, tag)]: { status: 200, body },
			[sumUrl(asset, tag)]: { status: 200, body: Buffer.from(`${sha256(body)}  ${asset.name}\n`) },
		});

		it("installs the binary from the first asset and removes the archive", async function () {
			const { request, asked } = fakeRequest(publish(clif, await tarGz({ clif: "server" })));
			const versionDir = path.join(dir, "v1.0.0");

			await installServer(options(versionDir, request, [clif, legacy]));

			assert.strictEqual(fs.readFileSync(path.join(versionDir, "clif"), "utf8"), "server");
			assert.deepStrictEqual(fs.readdirSync(versionDir), ["clif"]);
			assert.deepStrictEqual(asked, [url(clif), sumUrl(clif)]);
			if (os.platform() !== "win32") {
				assert.strictEqual(fs.statSync(path.join(versionDir, "clif")).mode & 0o111, 0o111);
			}
		});

		it("falls back to the next asset when one is missing, installing it under the new name", async function () {
			const { request, asked } = fakeRequest(publish(legacy, await tarGz({ "cfmleditor-lsp": "old server" })));
			const versionDir = path.join(dir, "v1.0.0");

			await installServer(options(versionDir, request, [clif, legacy]));

			assert.strictEqual(fs.readFileSync(path.join(versionDir, "clif"), "utf8"), "old server");
			// The first archive is missing, so no checksum is asked for; the second is checked.
			assert.deepStrictEqual(asked, [url(clif), url(legacy), sumUrl(legacy)]);
		});

		it("does not try the next asset after an error that is not a 404", async function () {
			const { request, asked } = fakeRequest({ [url(clif)]: { status: 500 } });

			await assert.rejects(installServer(options(path.join(dir, "v"), request, [clif, legacy])), (error: unknown) => {
				return error instanceof HttpStatusError && error.statusCode === 500;
			});
			assert.deepStrictEqual(asked, [url(clif)]);
		});

		it("reports the 404 when every asset is missing", async function () {
			const { request, asked } = fakeRequest({});

			await assert.rejects(installServer(options(path.join(dir, "v"), request, [clif, legacy])), (error: unknown) => {
				return error instanceof HttpStatusError && error.statusCode === 404;
			});
			assert.deepStrictEqual(asked, [url(clif), url(legacy)]);
		});

		it("names the asset when the archive does not hold the binary, and cleans up", async function () {
			const { request } = fakeRequest(publish(clif, await tarGz({ README: "docs" })));
			const versionDir = path.join(dir, "v1.0.0");

			await assert.rejects(installServer(options(versionDir, request, [clif])), /clif-linux-amd64\.tar\.gz did not contain clif/);
			assert.ok(!fs.existsSync(path.join(versionDir, clif.name)));
		});

		it("rejects an archive that is not an archive, and cleans up", async function () {
			// Its checksum is right, so it gets as far as being unpacked.
			const { request } = fakeRequest(publish(clif, Buffer.from("<html>captive portal</html>")));
			const versionDir = path.join(dir, "v1.0.0");

			await assert.rejects(installServer(options(versionDir, request, [clif])));
			assert.ok(!fs.existsSync(path.join(versionDir, clif.name)));
		});

		it("says what it is doing", async function () {
			const { request } = fakeRequest(publish(clif, await tarGz({ clif: "server" })));
			const messages: string[] = [];

			await installServer({ ...options(path.join(dir, "v"), request, [clif]), onProgress: message => messages.push(message) });

			assert.deepStrictEqual(messages, ["Downloading v1.0.0...", "Verifying...", "Extracting..."]);
		});

		it("rejects when there are no assets to try", async function () {
			const { request } = fakeRequest({});

			await assert.rejects(installServer(options(path.join(dir, "v"), request, [])), /No server asset for this platform in v1\.0\.0/);
		});

		describe("checksums", function () {
			it("refuses an archive that does not match its checksum, and unpacks nothing", async function () {
				const archive = await tarGz({ clif: "tampered server" });
				const { request } = fakeRequest({
					[url(clif)]: { status: 200, body: archive },
					[sumUrl(clif)]: { status: 200, body: Buffer.from(`${sha256(Buffer.from("something else"))}  ${clif.name}\n`) },
				});
				const versionDir = path.join(dir, "v1.0.0");

				await assert.rejects(installServer(options(versionDir, request, [clif])), /does not match its published checksum/);
				assert.deepStrictEqual(fs.readdirSync(versionDir), []);
			});

			it("does not fall back to the next asset after a mismatch", async function () {
				const { request, asked } = fakeRequest({
					[url(clif)]: { status: 200, body: await tarGz({ clif: "tampered" }) },
					[sumUrl(clif)]: { status: 200, body: Buffer.from(`${"0".repeat(64)}  ${clif.name}\n`) },
					...publish(legacy, await tarGz({ "cfmleditor-lsp": "old server" })),
				});

				await assert.rejects(installServer(options(path.join(dir, "v"), request, [clif, legacy])), /does not match/);
				assert.ok(!asked.includes(url(legacy)), `went on to ${url(legacy)}`);
			});

			it("refuses a release that should publish a checksum and does not", async function () {
				const { request, asked } = fakeRequest({ [url(clif)]: { status: 200, body: await tarGz({ clif: "server" }) } });
				const versionDir = path.join(dir, "v1.0.0");

				await assert.rejects(installServer(options(versionDir, request, [clif, legacy])), /publishes no checksum for clif-linux-amd64\.tar\.gz/);
				assert.deepStrictEqual(fs.readdirSync(versionDir), []);
				// A missing checksum is not a missing archive: it must not send the install on to the next one.
				assert.deepStrictEqual(asked, [url(clif), sumUrl(clif)]);
			});

			it("installs a release from before checksums existed, and says it was not verified", async function () {
				const tag = "v0.7.5";
				const { request } = fakeRequest({ [url(clif, tag)]: { status: 200, body: await tarGz({ clif: "old server" }) } });
				const versionDir = path.join(dir, tag);
				const warnings: string[] = [];

				await installServer({ ...options(versionDir, request, [clif], tag), onWarning: message => warnings.push(message) });

				assert.strictEqual(fs.readFileSync(path.join(versionDir, "clif"), "utf8"), "old server");
				assert.strictEqual(warnings.length, 1);
				assert.match(warnings[0], /was not verified/);
			});

			it("still checks a checksum that an old release does publish", async function () {
				const tag = "v0.7.5";
				const { request } = fakeRequest({
					[url(clif, tag)]: { status: 200, body: await tarGz({ clif: "tampered" }) },
					[sumUrl(clif, tag)]: { status: 200, body: Buffer.from(`${"0".repeat(64)}  ${clif.name}\n`) },
				});

				await assert.rejects(installServer(options(path.join(dir, tag), request, [clif], tag)), /does not match/);
			});

			it("does not warn when it did verify", async function () {
				const { request } = fakeRequest(publish(clif, await tarGz({ clif: "server" })));
				const warnings: string[] = [];

				await installServer({ ...options(path.join(dir, "v"), request, [clif]), onWarning: message => warnings.push(message) });

				assert.deepStrictEqual(warnings, []);
			});

			it("refuses a checksum that is for another archive", async function () {
				const archive = await tarGz({ clif: "server" });
				const { request } = fakeRequest({
					[url(clif)]: { status: 200, body: archive },
					[sumUrl(clif)]: { status: 200, body: Buffer.from(`${sha256(archive)}  clif-darwin-arm64.tar.gz\n`) },
				});

				await assert.rejects(installServer(options(path.join(dir, "v"), request, [clif])), /is for clif-darwin-arm64\.tar\.gz, not clif-linux-amd64\.tar\.gz/);
			});

			it("stops on a server error fetching the checksum, and cleans up", async function () {
				const { request } = fakeRequest({
					[url(clif)]: { status: 200, body: await tarGz({ clif: "server" }) },
					[sumUrl(clif)]: { status: 503 },
				});
				const versionDir = path.join(dir, "v1.0.0");

				await assert.rejects(installServer(options(versionDir, request, [clif])), (error: unknown) => {
					return error instanceof HttpStatusError && error.statusCode === 503;
				});
				assert.deepStrictEqual(fs.readdirSync(versionDir), []);
			});

			it("refuses a checksum file that is far larger than a checksum", async function () {
				const { request } = fakeRequest({
					[url(clif)]: { status: 200, body: await tarGz({ clif: "server" }) },
					[sumUrl(clif)]: { status: 200, body: Buffer.alloc(1_000_000, "a") },
				});

				await assert.rejects(installServer(options(path.join(dir, "v"), request, [clif])), /larger than a checksum file can be/);
			});
		});
	});
});
