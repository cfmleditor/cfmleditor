import * as fs from "fs";
import JSZip from "jszip";
import * as path from "path";
import * as zlib from "zlib";

/**
 * Unpacks the server binary out of a release archive.
 *
 * Shared with the packaging script, which puts the same binary in the same
 * shape into the extension — a second implementation there would be a second
 * set of assumptions about what the archives contain.
 * @param archivePath the downloaded archive
 * @param destDir where the binary should land
 * @param binaryName the file to pull out of the archive
 */
export async function extractArchive(archivePath: string, destDir: string, binaryName: string): Promise<void> {
	if (archivePath.endsWith(".zip")) {
		await extractZip(archivePath, destDir, binaryName);
		return;
	}

	await extractTarGz(archivePath, destDir, binaryName);
}

async function extractZip(archivePath: string, destDir: string, binaryName: string): Promise<void> {
	const zip = await JSZip.loadAsync(fs.readFileSync(archivePath));
	const entry = Object.values(zip.files).find(file => !file.dir && path.basename(file.name) === binaryName);

	if (!entry) {
		// Left to the caller's check for the binary, which can name the asset.
		return;
	}

	fs.writeFileSync(path.join(destDir, binaryName), await entry.async("nodebuffer"), { mode: 0o755 });
}

async function extractTarGz(archivePath: string, destDir: string, binaryName: string): Promise<void> {
	// Simple tar.gz extraction for a single binary file
	const { extract } = await import("tar-stream");
	const extractStream = extract();
	const input = fs.createReadStream(archivePath).pipe(zlib.createGunzip());

	return new Promise((resolve, reject) => {
		extractStream.on("entry", (header, stream, next) => {
			const name = path.basename(header.name);
			if (name === binaryName) {
				const outPath = path.join(destDir, binaryName);
				const out = fs.createWriteStream(outPath, { mode: 0o755 });
				stream.pipe(out);
				out.on("finish", next);
				out.on("error", reject);
			}
			else {
				stream.resume();
				next();
			}
		});
		extractStream.on("finish", resolve);
		extractStream.on("error", reject);
		input.pipe(extractStream);
		input.on("error", reject);
	});
}
