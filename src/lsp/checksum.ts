import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { coerce, gte } from "semver";

/**
 * Checking a downloaded server against the SHA-256 its release publishes.
 *
 * Free of `vscode`, like `serverAsset.ts`, because the packaging script checks the
 * archive it bundles by the same rules the extension checks one it downloads. Two
 * copies of the rules would drift, and the symptom would be a build that ships a
 * binary the running extension would have refused.
 */

/**
 * The first release that publishes a `<archive>.sha256` beside every archive.
 * Nothing earlier has one to check against.
 */
export const CHECKSUMS_PUBLISHED_FROM = "0.7.6";

/** Why a downloaded archive could not be trusted. */
export class ChecksumError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ChecksumError";
	}
}

/**
 * Whether a release must have a published checksum to be installed.
 *
 * A release from before they were published has none to check, and `cfml.lsp.version`
 * can still pin one, so it installs with a warning. From the first that publishes
 * them on, a missing checksum is an error: skipping the check quietly there would
 * let anyone who can remove the file make the check disappear. A tag that is not a
 * version at all is treated as one that must have one.
 * @param tag the release tag, e.g. `v0.7.7`
 * @returns true when the archive cannot be installed without a published checksum
 */
export function checksumRequired(tag: string): boolean {
	const version = coerce(tag);

	return version === null || gte(version, CHECKSUMS_PUBLISHED_FROM);
}

/**
 * Reads the hash out of a `.sha256` file.
 *
 * The files are `sha256sum` output, `<hex>  <file name>`, so that
 * `sha256sum -c` accepts them. A bare hash, and the `*` that marks a binary read,
 * are taken too. The file name is checked when there is one: a checksum for another
 * archive is not this archive's.
 * @param text the contents of the `.sha256` file
 * @param assetName the archive the checksum is meant for
 * @returns the hash, in lower case
 * @throws {ChecksumError} when the text is not a single checksum, or names another file
 */
export function parseChecksumFile(text: string, assetName: string): string {
	const lines = text.split(/\r?\n/).filter(line => line.trim() !== "");
	if (lines.length !== 1) {
		throw new ChecksumError(`the checksum for ${assetName} is not a single line (${lines.length} lines)`);
	}

	const match = /^([0-9a-f]{64})(?:[ \t]+\*?(\S.*?))?[ \t]*$/i.exec(lines[0].trim());
	if (!match) {
		throw new ChecksumError(`the checksum for ${assetName} is not a SHA-256`);
	}

	const named = match[2];
	if (named !== undefined && path.posix.basename(named) !== assetName) {
		throw new ChecksumError(`the checksum is for ${named}, not ${assetName}`);
	}

	return match[1].toLowerCase();
}

/**
 * Hashes a file without reading it all into memory.
 * @param file the file to hash
 * @returns the SHA-256, in lower case hex
 */
export function sha256OfFile(file: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const hash = crypto.createHash("sha256");
		const input = fs.createReadStream(file);

		input.on("error", reject);
		input.on("data", chunk => hash.update(chunk));
		input.on("end", () => resolve(hash.digest("hex")));
	});
}

/**
 * Checks an archive against the text of its `.sha256` file.
 * @param archivePath the downloaded archive
 * @param checksumText the contents of its `.sha256` file
 * @param assetName the archive's name on the release
 * @throws {ChecksumError} when the archive does not match
 */
export async function verifyChecksum(archivePath: string, checksumText: string, assetName: string): Promise<void> {
	const expected = parseChecksumFile(checksumText, assetName);
	const actual = await sha256OfFile(archivePath);

	if (actual !== expected) {
		throw new ChecksumError(`${assetName} does not match its published checksum (expected ${expected.slice(0, 12)}…, got ${actual.slice(0, 12)}…)`);
	}
}

/** What `verifyArchive` needs to know. */
export interface VerifyArchiveOptions {
	/** The release tag the archive came from. */
	tag: string;
	/** The archive's name on the release. */
	assetName: string;
	/** The downloaded archive. */
	archivePath: string;
	/** The contents of the archive's `.sha256` file, or undefined when the release has none. */
	checksumText: string | undefined;
	/** Told when an archive is accepted without a checksum. */
	warn: (message: string) => void;
}

/**
 * Applies the rules: a checksum that is there must match, and one that is not there
 * is an error unless the release predates them.
 * @param options the archive and what its release published
 * @throws {ChecksumError} on a mismatch, or on a missing checksum the release should have
 */
export async function verifyArchive(options: VerifyArchiveOptions): Promise<void> {
	const { tag, assetName, archivePath, checksumText, warn } = options;

	if (checksumText === undefined) {
		if (checksumRequired(tag)) {
			throw new ChecksumError(`${tag} publishes no checksum for ${assetName}, so it cannot be verified`);
		}

		warn(`${assetName} was not verified: ${tag} is older than ${CHECKSUMS_PUBLISHED_FROM}, the first release to publish checksums`);

		return;
	}

	await verifyChecksum(archivePath, checksumText, assetName);
}
