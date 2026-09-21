import { coerce, gt } from "semver";

/** The repository the language server is released from. */
export const GITHUB_REPO = "cfmleditor/cfmleditor-lsp";

/** The server executable's name, without the Windows extension. */
export const BINARY_NAME = "cfmleditor-lsp";

/**
 * Everything here is deliberately free of `vscode`, because the packaging
 * script picks the same asset the extension would and must run under plain
 * node. Two copies of these rules would drift, and the symptom would be a
 * shipped extension carrying a binary it then refuses to use.
 */

/**
 * The release assets that could carry the server for a platform, best first.
 *
 * `.tar.gz` everywhere, because it is the one format that extracts with a
 * reader bundled into the extension on every platform. The zip was only ever
 * chosen for Windows, and extracting it shelled out to `unzip` — which stock
 * Windows does not have, so the single platform that took that branch was the
 * one platform that could not follow it. The zip stays as a fallback for pinned
 * versions older than v0.2.6, which ship nothing else.
 * @param platform an `os.platform()` value
 * @param arch an `os.arch()` value
 * @returns the asset names to try in order, and the binary they contain
 */
export function assetCandidates(platform: string, arch: string): { assetNames: string[]; binaryName: string } {
	const osStr = platform === "win32" ? "windows" : platform === "darwin" ? "darwin" : "linux";

	// Windows releases are amd64 only, and Windows on ARM runs an amd64 binary
	// under emulation. Asking for a windows-arm64 asset only ever produced a 404
	// that read like the release itself was broken.
	const archStr = arch === "arm64" && platform !== "win32" ? "arm64" : "amd64";
	const binaryName = platform === "win32" ? `${BINARY_NAME}.exe` : BINARY_NAME;
	const base = `${BINARY_NAME}-${osStr}-${archStr}`;

	return {
		assetNames: platform === "win32" ? [`${base}.tar.gz`, `${base}.zip`] : [`${base}.tar.gz`],
		binaryName,
	};
}

/** CFLint's executable name, without the Windows extension. */
export const CFLINT_BINARY_NAME = "cflint";

/** The repository CFLint's native binaries are released from. */
export const CFLINT_REPO = "cfmleditor/CFLint";

/**
 * The CFLint assets that could carry the linter for a platform, best first.
 *
 * The language server runs CFLint itself and looks for `cflint` on PATH before
 * anything else, so a copy shipped beside the server is found with no
 * arrangement between them. It is a GraalVM native image: no JRE, and about
 * 90 MB raw against 28 MB compressed, which is why the compressed asset is
 * preferred and the raw binary is only the fallback for releases that predate
 * it.
 *
 * CFLint names its platforms differently from the server — `macos` rather than
 * `darwin`, `aarch64` rather than `arm64` — so this is its own mapping rather
 * than a tweak of the server's.
 * @param platform an `os.platform()` value
 * @param arch an `os.arch()` value
 * @returns the asset names to try in order, and the binary they contain
 */
export function cflintAssetCandidates(platform: string, arch: string): { assetNames: string[]; binaryName: string } {
	const osStr = platform === "win32" ? "windows" : platform === "darwin" ? "macos" : "linux";

	// Only an amd64 build is published for Windows, and Windows on ARM runs it
	// under emulation.
	const archStr = arch === "arm64" && platform !== "win32" ? "aarch64" : "amd64";
	const binaryName = platform === "win32" ? `${CFLINT_BINARY_NAME}.exe` : CFLINT_BINARY_NAME;
	const base = `${CFLINT_BINARY_NAME}-${osStr}-${archStr}`;

	return {
		assetNames: platform === "win32"
			? [`${base}.zip`, `${base}.exe`]
			: [`${base}.tar.gz`, base],
		binaryName,
	};
}

/**
 * Turns a VS Code packaging target into the platform pair `assetCandidates`
 * reads, so `vsce package --target win32-arm64` and a user running Windows on
 * ARM end up at the same asset.
 * @param target a `vsce --target` value, e.g. `darwin-arm64`
 * @returns the `os.platform()` and `os.arch()` values it stands for
 */
export function platformForTarget(target: string): { platform: string; arch: string } {
	const [targetOs, targetArch] = target.split("-");
	const platform = targetOs === "win32" ? "win32" : targetOs === "darwin" ? "darwin" : "linux";
	const arch = targetArch === "arm64" ? "arm64" : "x64";

	return { platform, arch };
}

/**
 * Pulls the tag out of the URL `/releases/latest` redirects to.
 *
 * Separate from the request so it can be tested without one — the shapes that
 * matter (an empty Location, a redirect somewhere unexpected) are exactly the
 * ones a live call will not produce on demand.
 * @param location the redirect target
 * @returns the tag name
 */
export function tagFromReleaseRedirect(location: string): string {
	const tag = /\/releases\/tag\/([^/?#]+)/.exec(location)?.[1];
	if (!tag) {
		throw new Error(`Could not read a release tag from ${location || "an empty redirect"}`);
	}

	return decodeURIComponent(tag);
}

/**
 * The tag a configured version means, without asking anything.
 * @param version the `cfml.lsp.version` setting
 * @returns the tag, or undefined for `latest`, which has to be resolved
 */
export function pinnedTag(version: string): string | undefined {
	if (!version || version === "latest") {
		return undefined;
	}

	return version.startsWith("v") ? version : `v${version}`;
}

/**
 * The newer of two tags, tolerating anything semver cannot read.
 * @param a a release tag
 * @param b a release tag
 * @returns whichever is newer, or the one that parses when only one does
 */
export function newerTag(a: string | undefined, b: string | undefined): string | undefined {
	const versionA = a ? coerce(a) : null;
	const versionB = b ? coerce(b) : null;

	if (!versionA) {
		return versionB ? b : a ?? b;
	}
	if (!versionB) {
		return a;
	}

	return gt(versionA, versionB) ? a : b;
}

/** Where a server the extension is about to start comes from. */
export interface ServerChoice {
	/** `bundled` ships in the extension, `cached` was downloaded before, `download` has to be fetched. */
	source: "bundled" | "cached" | "download";
	/** The release tag that choice refers to. */
	tag: string;
}

/**
 * Decides which copy of the server to run.
 *
 * The extension ships one, so a first run needs no network and a blocked GitHub
 * is a version behind rather than no language server at all. A download is only
 * worth making when it would be an upgrade, and when nothing can be resolved —
 * offline, proxied, rate limited — the newest copy already on this machine
 * answers instead.
 * @param requested the tag that was asked for, or undefined when GitHub could not be reached
 * @param bundled the tag of the server shipped with the extension, if there is one
 * @param cached the tags of servers already downloaded
 * @returns what to run, or undefined when there is nothing to run and nothing to fetch
 */
export function chooseServer(requested: string | undefined, bundled: string | undefined, cached: string[]): ServerChoice | undefined {
	if (requested) {
		if (cached.includes(requested)) {
			return { source: "cached", tag: requested };
		}
		if (bundled === requested) {
			return { source: "bundled", tag: requested };
		}

		return { source: "download", tag: requested };
	}

	const newestCached = cached.reduce<string | undefined>((best, tag) => newerTag(best, tag), undefined);

	// The same version in both places goes to the bundled copy: it arrived with
	// the extension rather than through a download that may have been cut short.
	if (bundled !== undefined && (bundled === newestCached || newestCached === undefined)) {
		return { source: "bundled", tag: bundled };
	}

	if (newestCached === undefined) {
		return undefined;
	}

	if (bundled === undefined) {
		return { source: "cached", tag: newestCached };
	}

	return newerTag(newestCached, bundled) === newestCached
		? { source: "cached", tag: newestCached }
		: { source: "bundled", tag: bundled };
}
