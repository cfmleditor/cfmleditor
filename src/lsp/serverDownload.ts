import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import { extractServerAsset } from "./extractServer";
import { HttpStatusError, requestFollowingRedirects, requestOnce } from "./httpRequest";
import { GITHUB_REPO, ServerAsset, nextReleaseRedirect } from "./serverAsset";

/**
 * Everything here is free of `vscode` so the network and file handling can be
 * tested with fake responses, and without a language client running.
 */

// Makes one GET request, following redirects, and hands back the response.
export type RequestFollowingRedirects = (url: string) => Promise<http.IncomingMessage>;

// Makes one GET request without following redirects, and hands back the response.
export type RequestOnce = (url: string) => Promise<http.IncomingMessage>;

/** Where releases are fetched from. */
export const RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`;

/**
 * Downloads a URL to a file.
 * @param url the URL to fetch
 * @param dest the file to write
 * @param request how to make the request, which tests replace
 * @returns once the file is written and closed
 * @throws {HttpStatusError} when the response is not a 200
 */
export async function downloadFile(url: string, dest: string, request: RequestFollowingRedirects = requestFollowingRedirects): Promise<void> {
	const response = await request(url);

	if (response.statusCode !== 200) {
		response.resume();
		throw new HttpStatusError(response.statusCode ?? 0, `HTTP ${response.statusCode} downloading ${url}`);
	}

	return new Promise((resolve, reject) => {
		const file = fs.createWriteStream(dest);

		// The idle timeout arrives as an error on the response, so a transfer
		// that stalls part way through ends here rather than hanging forever.
		const fail = (error: Error) => {
			response.destroy();
			file.destroy();
			reject(error);
		};
		response.on("error", fail);
		file.on("error", fail);
		// `close` rather than `finish`, so the file is on disk and readable by
		// the time the archive is opened.
		file.on("close", resolve);
		response.pipe(file);
	});
}

/**
 * Reads the tag `latest` currently points at, from GitHub's own redirect.
 *
 * Deliberately not the releases API. That endpoint is rate limited to 60
 * requests an hour *per IP* for unauthenticated callers, which is shared by
 * everyone behind one NAT — a single office hits it in an afternoon, and the
 * extension asked on every server start. The failure is an HTTP 403 that reads
 * like a permissions problem and tells a first-time user nothing.
 *
 * `/releases/latest` redirects to `/releases/tag/<tag>` with no API involved and
 * no rate limit, which is the same route the IntelliJ plugin takes.
 * @param request how to make the request, which tests replace
 * @param releasesUrl the releases page to ask, which tests replace
 * @returns the tag name, e.g. `v0.3.1`
 */
export async function resolveLatestTag(request: RequestOnce = requestOnce, releasesUrl: string = RELEASES_URL): Promise<string> {
	let url = `${releasesUrl}/latest`;

	// The redirect is the answer here, so it is read rather than followed. A
	// renamed repository adds one to its new name first, so a few are read.
	for (let hop = 0; hop < 3; hop++) {
		const response = await request(url);
		response.resume();

		const status = response.statusCode ?? 0;
		if (status < 300 || status >= 400) {
			throw new Error(`HTTP ${status} resolving the latest release`);
		}

		const location = response.headers.location ?? "";
		const next = nextReleaseRedirect(location);
		if (next.tag !== undefined) {
			return next.tag;
		}

		if (next.follow === undefined) {
			throw new Error(`Could not read a release tag from ${location || "an empty redirect"}`);
		}

		url = next.follow;
	}

	throw new Error("Too many redirects resolving the latest release");
}

/** What `installServer` needs to know. */
export interface InstallServerOptions {
	/** The release tag to install. */
	tag: string;
	/** The release assets that could carry the server, best first. */
	assets: ServerAsset[];
	/** Where the binary should land. */
	versionDir: string;
	/** The name to install it as. */
	binaryName: string;
	/** Told what is happening, for display. */
	onProgress?: (message: string) => void;
	/** How to make requests, which tests replace. */
	request?: RequestFollowingRedirects;
	/** Where release assets are downloaded from, which tests replace. */
	releasesUrl?: string;
	/** The platform the binary is for, which decides whether it is made executable. */
	platform?: string;
}

/**
 * Downloads the first release asset that exists and unpacks the server from it.
 * @param options what to fetch and where to put it
 * @throws {Error} when no candidate asset exists, a download fails, or the archive lacks the binary
 */
export async function installServer(options: InstallServerOptions): Promise<void> {
	const { tag, assets, versionDir, binaryName } = options;
	const report = options.onProgress ?? (() => undefined);
	const releasesUrl = options.releasesUrl ?? RELEASES_URL;
	const platform = options.platform ?? os.platform();

	fs.mkdirSync(versionDir, { recursive: true });
	const binaryPath = path.join(versionDir, binaryName);

	let notFound: Error | undefined;
	for (const asset of assets) {
		const assetName = asset.name;
		const archivePath = path.join(versionDir, assetName);

		try {
			report(`Downloading ${tag}...`);
			await downloadFile(`${releasesUrl}/download/${tag}/${assetName}`, archivePath, options.request);

			report("Extracting...");
			await extractServerAsset(archivePath, versionDir, asset.binary, binaryName);
		}
		catch (e) {
			fs.rmSync(archivePath, { force: true });

			// Only a missing asset is worth trying the next candidate
			// for. A timeout or a refused connection would fail the same
			// way twice, and asking again just doubles the wait.
			if (e instanceof HttpStatusError && e.statusCode === 404) {
				notFound = e;
				continue;
			}

			throw e;
		}

		fs.rmSync(archivePath, { force: true });

		// An archive that unpacked without producing the binary is not a
		// success. Left unchecked it reached `chmod` as an ENOENT that
		// said nothing about which asset was wrong.
		if (!fs.existsSync(binaryPath)) {
			throw new Error(`${assetName} did not contain ${binaryName}`);
		}

		if (platform !== "win32") {
			fs.chmodSync(binaryPath, 0o755);
		}

		return;
	}

	throw notFound ?? new Error(`No server asset for this platform in ${tag}`);
}
