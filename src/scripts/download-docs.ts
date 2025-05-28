import fetch from "isomorphic-fetch";
import path from "path";
import fs from "fs";
import { rimrafSync } from "rimraf";
import JSZip from "jszip";
import assert from "assert";

async function main() {
	const rootDir = path.join(__dirname, "..", "..");

	// Download documentation to a new folder
	const downloadFolder = path.join(rootDir, "resources", ".docs-download");

	// Delete the prevoius download folder if it exists
	if (fs.existsSync(downloadFolder)) {
		console.log("Cleaning up download folder".padEnd(26), "=>", path.relative(rootDir, downloadFolder));
		if (!rimrafSync(downloadFolder)) throw new Error(`Failed to clean download folder: "${downloadFolder}"`);
	}

	// Download documentation from Lucee
	const luceeDocsPath = path.join(downloadFolder, "lucee-docs.zip");
	console.log("Downloading Lucee docs".padEnd(26), "=>", path.relative(rootDir, luceeDocsPath));
	await downloadFile("https://docs.lucee.org/lucee-docs-json-zipped.zip", luceeDocsPath);

	// Download documentation from CFDocs
	const cfDocsPath = path.join(downloadFolder, "cfdocs.zip");
	console.log("Downloading CFDocs".padEnd(26), "=>", path.relative(rootDir, cfDocsPath));
	await downloadDocsWebsite("https://raw.githubusercontent.com/foundeo/cfdocs/master/data/en/", cfDocsPath);

	// Backup the existing docs folder in case we need to restore it
	const docsFolder = path.join(rootDir, "resources", "docs");
	if (fs.existsSync(docsFolder)) {
		// If the documentation is already up to date, skip the rest
		if (await foldersMatch(downloadFolder, docsFolder)) {
			console.log("No changes detected in downloaded docs, documentation is up to date.");
			return;
		}

		const oldDocsPath = path.join(rootDir, "resources", ".docs-old");
		fs.mkdirSync(oldDocsPath, { recursive: true });
		let i = 1;
		let oldDocsDestination: string;
		do {
			oldDocsDestination = path.join(oldDocsPath, `docs-${i.toString().padStart(3, "0")}`); ;
			i++;
		} while (fs.existsSync(oldDocsDestination));

		console.log("Backing up docs folder".padEnd(26), "=>", path.relative(rootDir, oldDocsDestination));
		fs.renameSync(docsFolder, oldDocsDestination);
	}

	// Make the download folder the new docs folder
	console.log("Moving download folder".padEnd(26), "=>", path.relative(rootDir, docsFolder));
	fs.renameSync(downloadFolder, docsFolder);

	console.log("Documentation updated.");
}
void main();

async function downloadFile(url: string, localPath: string) {
	// Download the file
	const response = await fetch(url);
	if (!response.ok) throw new Error(`Failed to download file "${url}": ${response.statusText}`);

	// Create the directory if it doesn't exist
	fs.mkdirSync(path.dirname(localPath), { recursive: true });

	// Write the file to disk
	const arrayBuffer = await response.arrayBuffer();
	const buffer = Buffer.from(arrayBuffer);
	fs.writeFileSync(localPath, buffer);
}

async function downloadDocsWebsite(baseUrl: string, localPath: string) {
	assert(localPath.endsWith(".zip"), `Expected localPath to end with ".zip", got "${localPath}"`);
	const tempFolder = localPath.slice(0, -4); // Remove the ".zip" extension
	fs.mkdirSync(tempFolder, { recursive: true });

	// Download the index files that list the other files for download
	const functionsList = await downloadList(baseUrl + "functions.json", path.join(tempFolder, "functions.json"));
	const tagsList = await downloadList(baseUrl + "tags.json", path.join(tempFolder, "tags.json"));

	const files = functionsList.concat(tagsList).map(file => `${file.toLowerCase()}.json`);
	const promises = files.map(async (file) => {
		const url = baseUrl + file;
		const localFilePath = path.join(tempFolder, file);
		try {
			return await downloadFile(url, localFilePath);
		}
		catch (e) {
			// We're bulk downloading hundreds of files, so we can expect some to fail
			console.error(` - Retrying failed download: ${(e instanceof Error ? e.message : String(e))}`);
			return await downloadFile(url, localFilePath);
		}
	});
	await Promise.all(promises);

	await zipFolder(tempFolder, localPath);
	if (!rimrafSync(tempFolder)) throw new Error(`Failed to clean temp folder: "${tempFolder}"`);
}

async function downloadList(url: string, localPath: string) {
	// Download the file
	await downloadFile(url, localPath);
	const fileContent = fs.readFileSync(localPath, "utf-8");
	const data = JSON.parse(fileContent) as { related: string[] };
	return data.related;
}

async function zipFolder(folderPath: string, zipFilePath: string) {
	assert(fs.statSync(folderPath).isDirectory(), `Expected folderPath to be a directory, got "${folderPath}"`);
	assert(zipFilePath.endsWith(".zip"), `Expected zipFilePath to end with ".zip", got "${zipFilePath}"`);

	// Add all JSON files in the folder to a zip file
	const zip = new JSZip();
	const files = fs.readdirSync(folderPath);
	for (const filename of files) {
		if (!filename.endsWith(".json")) continue;
		const filePath = path.join(folderPath, filename);
		const data = fs.readFileSync(filePath);
		zip.file(filename, data);
	}
	// The zip file created here will be zipped again with high compression when packaged in the VSIX file.
	// By using STORE for 0% compression here, we allow the VSIX compression to operate more efficiently for a smaller final size.
	const zipFile = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
	fs.writeFileSync(zipFilePath, zipFile);
}

/**
 * Compares two folders to see if they contain the same files and content.
 *
 * - Differences in timestamps are ignored.
 * - Zip files are compared by their contents, ignoring timestamp and compression differences.
 * @param folderPathA
 * @param folderPathB
 * @returns
 */
async function foldersMatch(folderPathA: string, folderPathB: string): Promise<boolean> {
	assert(fs.statSync(folderPathA).isDirectory(), `Expected folderPathA to be a directory, got "${folderPathA}"`);
	assert(fs.statSync(folderPathB).isDirectory(), `Expected folderPathB to be a directory, got "${folderPathB}"`);
	assert(folderPathA !== folderPathB, `Expected folderPathA and folderPathB to be different, got "${folderPathA}" and "${folderPathB}"`);

	const filesA = fs.readdirSync(folderPathA);
	const filesB = fs.readdirSync(folderPathB);
	if (filesA.length !== filesB.length) {
		return false;
	}
	for (let i = 0; i < filesA.length; i++) {
		const fileA = filesA[i];
		const fileB = filesB[i];
		if (fileA !== fileB) {
			return false;
		}
		const filePathA = path.join(folderPathA, fileA);
		const filePathB = path.join(folderPathB, fileB);

		if (!await zipsMatch(filePathA, filePathB)) {
			return false;
		}
	}
	return true;
}

/**
 * Compares two zip files to see if they contain the same files and content.
 *
 * - Differences in timestamps are ignored.
 * @param zipFilePathA
 * @param zipFilePathB
 * @returns
 */
async function zipsMatch(zipFilePathA: string, zipFilePathB: string): Promise<boolean> {
	assert(zipFilePathA.endsWith(".zip"), `Expected zipFilePathA to end with ".zip", got "${zipFilePathA}"`);
	assert(zipFilePathB.endsWith(".zip"), `Expected zipFilePathB to end with ".zip", got "${zipFilePathB}"`);

	const zipA = await JSZip.loadAsync(fs.readFileSync(zipFilePathA));
	const zipB = await JSZip.loadAsync(fs.readFileSync(zipFilePathB));

	const filesA = Object.keys(zipA.files);
	const filesB = Object.keys(zipB.files);
	if (filesA.length !== filesB.length) {
		return false;
	}
	for (const file of filesA) {
		if (!filesB.includes(file)) {
			return false;
		}
		const fileA = await zipA.files[file].async("string");
		const fileB = await zipB.files[file].async("string");
		if (fileA !== fileB) {
			return false;
		}
	}
	return true;
}
