import fetch from "isomorphic-fetch";
import path from "path";
import fs from "fs";
import { rimrafSync } from "rimraf";
import JSZip from "jszip";
import assert from "assert";

const rootDir = path.join(__dirname, "..", "..");

async function main() {
	// Remove the existing docs folder if it exists
	const docsFolder = path.join(rootDir, "resources", "docs");
	if (fs.existsSync(docsFolder)) {
		if (!rimrafSync(docsFolder)) throw new Error(`Failed to clean docs folder: "${docsFolder}"`);
		console.log("Cleaned docs folder".padEnd(21), "=>", path.relative(rootDir, docsFolder));
	}

	const luceeDocsPath = path.join(docsFolder, "lucee-docs.zip");
	await downloadFile("https://docs.lucee.org/lucee-docs-json-zipped.zip", luceeDocsPath);
	console.log("Downloaded Lucee docs".padEnd(21), "=>", path.relative(rootDir, luceeDocsPath));

	const cfDocsPath = path.join(docsFolder, "cfdocs.zip");
	await downloadDocsWebsite("https://raw.githubusercontent.com/foundeo/cfdocs/master/data/en/", cfDocsPath);
	console.log("Downloaded CFDocs".padEnd(21), "=>", path.relative(rootDir, cfDocsPath));
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
