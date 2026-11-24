import * as assert from "assert";
import * as fs from "fs";
import JSZip from "jszip";
import * as os from "os";
import * as path from "path";
import { pack } from "tar-stream";
import * as zlib from "zlib";

import { extractArchive, extractServerAsset } from "../lsp/extractServer";
import { legacyBinaryName } from "../lsp/serverAsset";

async function makeTarGz(file: string, entries: Record<string, string>): Promise<void> {
	const tar = pack();
	for (const [name, content] of Object.entries(entries)) {
		tar.entry({ name }, content);
	}
	tar.finalize();

	const chunks: Buffer[] = [];
	for await (const chunk of tar.pipe(zlib.createGzip())) {
		chunks.push(chunk as Buffer);
	}
	fs.writeFileSync(file, Buffer.concat(chunks));
}

async function makeZip(file: string, entries: Record<string, string>): Promise<void> {
	const zip = new JSZip();
	for (const [name, content] of Object.entries(entries)) {
		zip.file(name, content);
	}
	fs.writeFileSync(file, await zip.generateAsync({ type: "nodebuffer" }));
}

describe("LSP server extraction", function () {
	let dir: string;

	beforeEach(function () {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "cfml-extract-"));
	});

	afterEach(function () {
		fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
	});

	it("extracts the binary from a tar.gz, ignoring other entries", async function () {
		const archive = path.join(dir, "server.tar.gz");
		await makeTarGz(archive, { "README.md": "docs", "clif": "binary-bytes" });

		await extractArchive(archive, dir, "clif");

		assert.strictEqual(fs.readFileSync(path.join(dir, "clif"), "utf8"), "binary-bytes");
		assert.ok(!fs.existsSync(path.join(dir, "README.md")));
	});

	it("finds the binary inside a directory in a tar.gz", async function () {
		const archive = path.join(dir, "server.tar.gz");
		await makeTarGz(archive, { "release/bin/clif": "nested" });

		await extractArchive(archive, dir, "clif");

		assert.strictEqual(fs.readFileSync(path.join(dir, "clif"), "utf8"), "nested");
	});

	it("extracts the binary from a zip", async function () {
		const archive = path.join(dir, "server.zip");
		await makeZip(archive, { "clif.exe": "zip-bytes", "LICENSE": "x" });

		await extractArchive(archive, dir, "clif.exe");

		assert.strictEqual(fs.readFileSync(path.join(dir, "clif.exe"), "utf8"), "zip-bytes");
	});

	it("leaves nothing behind when the archive lacks the binary", async function () {
		const tarPath = path.join(dir, "server.tar.gz");
		const zipPath = path.join(dir, "server.zip");
		await makeTarGz(tarPath, { other: "x" });
		await makeZip(zipPath, { other: "x" });

		await extractArchive(tarPath, dir, "clif");
		await extractArchive(zipPath, dir, "clif");

		assert.ok(!fs.existsSync(path.join(dir, "clif")));
	});

	it("rejects an archive that is not a gzip", async function () {
		const archive = path.join(dir, "server.tar.gz");
		fs.writeFileSync(archive, "<html>not found</html>");

		await assert.rejects(extractArchive(archive, dir, "clif"));
	});

	it("installs a pre-rename binary under the new name", async function () {
		const archive = path.join(dir, "server.tar.gz");
		await makeTarGz(archive, { "cfmleditor-lsp": "old" });

		await extractServerAsset(archive, dir, "cfmleditor-lsp", "clif");

		assert.strictEqual(fs.readFileSync(path.join(dir, "clif"), "utf8"), "old");
		assert.ok(!fs.existsSync(path.join(dir, "cfmleditor-lsp")));
	});

	it("does not rename when the asset already uses the installed name", async function () {
		const archive = path.join(dir, "server.tar.gz");
		await makeTarGz(archive, { clif: "new" });

		await extractServerAsset(archive, dir, "clif", "clif");

		assert.strictEqual(fs.readFileSync(path.join(dir, "clif"), "utf8"), "new");
	});

	it("names the legacy binary per platform", function () {
		assert.strictEqual(legacyBinaryName("win32"), "cfmleditor-lsp.exe");
		assert.strictEqual(legacyBinaryName("linux"), "cfmleditor-lsp");
		assert.strictEqual(legacyBinaryName("darwin"), "cfmleditor-lsp");
	});
});
