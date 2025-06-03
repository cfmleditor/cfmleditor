import path from "path";
import fs from "fs";
import JSZip from "jszip";
import assert from "assert";

const rootDir = path.join(__dirname, "..", "..");
const docsFolder = path.join(rootDir, "resources", "docs");

let errorCount = 0;

async function main() {
	/*
	Note:
		We check that the number of documents is within a range, in case of large deviations.
		Update the expectedDocCount param as needed when it naturally changes.
	*/
	await validateZip(path.join(docsFolder, "cfdocs.zip"), 978);
	await validateZip(path.join(docsFolder, "lucee-docs.zip"), 890);
	if (errorCount > 0) {
		console.error(`\nValidation completed with ${errorCount} errors.`);
		process.exit(1);
	}
	else {
		console.log("Validation completed successfully.");
	}
}
void main();

function logZipProblem(zipFilePath: string, message: string): void {
	errorCount++;
	console.error(`ERROR:  ${path.relative(rootDir, zipFilePath)}: ${message}`);
}

function logZipInfo(zipFilePath: string, message: string): void {
	console.info(`INFO:  ${path.relative(rootDir, zipFilePath)}: ${message}`);
}

function logFileProblem(zipFilePath: string, filePath: string, message: string): void {
	errorCount++;
	console.error(`ERROR:  ${path.relative(rootDir, zipFilePath)}/${filePath}: ${message}`);
}

async function validateZip(zipFilePath: string, expectedDocCount: number): Promise<void> {
	assert(zipFilePath.endsWith(".zip"), `Expected zipFilePath to end with ".zip", got "${zipFilePath}"`);
	const zipData = fs.readFileSync(zipFilePath);
	let zip = await JSZip.loadAsync(zipData, { base64: false, checkCRC32: true });

	// If the zip file contains another zip file, extract it
	const innerZipFile = zip.filter(file => file.endsWith(".zip"))[0];
	if (innerZipFile) {
		const innerZipContents = await innerZipFile.async("uint8array");
		const innerZip = new JSZip();
		await innerZip.loadAsync(innerZipContents, { base64: false, checkCRC32: true });
		zip = innerZip;
	}

	const fileCount = zip.filter(Boolean).length;
	const jsonFiles = zip.filter(file => file.endsWith(".json"));
	const otherFiles = zip.filter(file => !file.endsWith(".json"));
	logZipInfo(zipFilePath, `${fileCount} files in zip`);
	if (jsonFiles.length == 0) {
		logZipProblem(zipFilePath, `No JSON files found`);
	}
	const allowedExtensions = ["json"];
	for (const file of otherFiles) {
		const ext = path.extname(file.name);
		if (!allowedExtensions.includes(ext)) {
			logFileProblem(zipFilePath, file.name, `Unexpected file type`);
		}
		logZipProblem(zipFilePath, ``);
	}

	const requiredIndexFiles = ["functions.json", "tags.json"];
	let foundDocCount = 0;
	for (const indexFile of requiredIndexFiles) {
		if (!zip.files[indexFile]) {
			logZipProblem(zipFilePath, `Missing required index file "${indexFile}"`);
			continue;
		}
		// Read the contents of the index file
		const indexContents = await zip.files[indexFile].async("string");
		let rawIndexData: unknown;
		try {
			rawIndexData = JSON.parse(indexContents) as unknown;
		}
		catch (e) {
			logFileProblem(zipFilePath, indexFile, `Invalid JSON: ${(e instanceof Error ? e.message : String(e))}`);
			continue;
		}
		const isObject: boolean = typeof rawIndexData === "object" && !Array.isArray(rawIndexData) && rawIndexData !== null;
		if (!isObject) {
			logFileProblem(zipFilePath, indexFile, `Expected an object`);
			continue;
		}
		const indexData = rawIndexData as object;

		// Validate the index file structure
		if (!("related" in indexData)) {
			logFileProblem(zipFilePath, indexFile, `Missing "related" property`);
			continue;
		}

		if (!Array.isArray(indexData.related)) {
			logFileProblem(zipFilePath, indexFile, `"related" property should be an array`);
			continue;
		}

		if (indexData.related.length === 0) {
			logFileProblem(zipFilePath, indexFile, `"related" property should not be empty`);
			continue;
		}

		logZipInfo(zipFilePath, `Found index file: ${indexFile} with ${indexData.related.length} related items`);

		for (const relatedItem of indexData.related) {
			foundDocCount++;
			if (typeof relatedItem !== "string") {
				logFileProblem(zipFilePath, indexFile, `Related item "${relatedItem}" should be a string`);
				continue;
			}
			const relatedItemPath = `${relatedItem.toLowerCase()}.json`;
			if (!zip.files[relatedItemPath]) {
				logFileProblem(zipFilePath, indexFile, `Related item "${relatedItem}" not found in zip`);
				continue;
			}

			// Read the contents of the docs file
			const contents = await zip.files[relatedItemPath].async("string");
			let rawData: unknown;
			try {
				rawData = JSON.parse(contents) as unknown;
			}
			catch (e) {
				logFileProblem(zipFilePath, indexFile, `Invalid JSON: ${(e instanceof Error ? e.message : String(e))}`);
				continue;
			}
			const isObject: boolean = typeof rawData === "object" && !Array.isArray(rawData) && rawData !== null;
			if (!isObject) {
				logFileProblem(zipFilePath, indexFile, `Expected an object`);
				continue;
			}
			const data = rawData as object;

			// Validate the docs file structure
			if (!("name" in data)) {
				logFileProblem(zipFilePath, relatedItemPath, `Missing "name" property`);
				continue;
			}
			if (typeof data.name !== "string") {
				logFileProblem(zipFilePath, relatedItemPath, `"name" property should be a string`);
				continue;
			}
			if (data.name.toLowerCase() !== relatedItem.toLowerCase()) {
				logFileProblem(zipFilePath, relatedItemPath, `Name "${data.name}" does not match related item "${relatedItem}" (case-insensitive)`);
				continue;
			}
		}
	}

	// Check if foundDocCount is within within the expected range
	// This is to catch large deviations in the number of documents
	// It is expected that the upperbound will be hit over time as more docs are added
	const lowerBound = Math.floor(expectedDocCount * 0.9);
	const upperBound = Math.ceil(expectedDocCount * 1.1);
	if (foundDocCount < lowerBound) {
		logZipProblem(
			zipFilePath,
			`Found only ${foundDocCount} docs, expected at least ${lowerBound} (update script if this is correct)`
		);
	}
	if (foundDocCount > upperBound) {
		logZipProblem(
			zipFilePath,
			`Found ${foundDocCount} docs, expected at most ${upperBound} (update script if this is correct)`
		);
	}
}
