import { execFile } from "child_process";
import { coerce, gte } from "semver";

import { sha256OfFile } from "../lsp/checksum";
import { GITHUB_REPO } from "../lsp/serverAsset";

/**
 * Checking that a server archive was built by clif's own release workflow.
 *
 * A checksum published beside an archive proves the download is the one the release
 * holds, but anyone who can edit a release can replace both. Each clif release also
 * carries a build attestation: a signed SLSA provenance statement that binds every
 * asset's digest to the workflow run, tag and commit that built it. Forging one takes
 * a workflow run in the repository, which the world can see.
 *
 * This runs where the server is bundled into the extension, through the GitHub CLI,
 * which does the Sigstore verification. It is not shipped: it uses `gh`, which a build
 * has and a user's machine does not.
 */

/**
 * The first release with a build attestation. Earlier releases have none to check.
 */
export const PROVENANCE_ATTESTED_FROM = "0.7.6";

/** The workflow that builds and attests a release, relative to the repository root. */
export const RELEASE_WORKFLOW = ".github/workflows/release.yml";

/** Who issues the signing certificate of a GitHub Actions run. */
const OIDC_ISSUER = "https://token.actions.githubusercontent.com";

/** The predicate type of a SLSA v1 provenance statement. */
const SLSA_PROVENANCE_V1 = "https://slsa.dev/provenance/v1";

/** Why an archive's provenance could not be established. */
export class ProvenanceError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ProvenanceError";
	}
}

/** What running the GitHub CLI produced. */
export interface GhResult {
	/** The exit status, or null when it was killed. */
	code: number | null;
	/** Everything it wrote to standard output. */
	stdout: string;
	/** Everything it wrote to standard error. */
	stderr: string;
	/** Whether the GitHub CLI is not installed. */
	missing: boolean;
}

/** Runs the GitHub CLI with the given arguments. Tests replace it. */
export type RunGh = (args: string[]) => Promise<GhResult>;

/**
 * Runs `gh`, never rejecting: what went wrong is part of the result.
 * @param args the arguments to give it
 * @returns what it produced
 */
export const runGh: RunGh = args => new Promise((resolve) => {
	execFile("gh", args, { maxBuffer: 32 * 1024 * 1024, timeout: 120_000 }, (error, stdout, stderr) => {
		if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
			resolve({ code: null, stdout: "", stderr: "", missing: true });

			return;
		}

		const code = error ? (typeof error.code === "number" ? error.code : null) : 0;
		resolve({ code, stdout, stderr, missing: false });
	});
});

/**
 * Whether a release must have a build attestation to be bundled.
 *
 * A tag that is not a version is treated as one that must have one, as for checksums.
 * @param tag the release tag, e.g. `v0.7.7`
 * @returns true when the archive cannot be bundled without a verified attestation
 */
export function provenanceRequired(tag: string): boolean {
	const version = coerce(tag);

	return version === null || gte(version, PROVENANCE_ATTESTED_FROM);
}

/**
 * The identity a release's attestation must be signed by: clif's release workflow, at
 * the tag being bundled. Anything else, including the same workflow at another ref or a
 * workflow in another repository, is not this release.
 * @param tag the release tag
 * @returns the certificate's subject alternative name
 */
export function expectedSigner(tag: string): string {
	return `https://github.com/${GITHUB_REPO}/${RELEASE_WORKFLOW}@refs/tags/${tag}`;
}

/**
 * The arguments that make `gh` check an archive against the release's attestation.
 *
 * The identity is matched exactly, the ref is pinned to the tag, and a self-hosted
 * runner is refused, so that a signature by anything but that workflow on GitHub's own
 * runners does not pass. The output is JSON so that the result can be read again here.
 * @param archivePath the downloaded archive
 * @param tag the release tag
 * @returns the arguments
 */
export function ghArguments(archivePath: string, tag: string): string[] {
	return [
		"attestation", "verify", archivePath,
		"--repo", GITHUB_REPO,
		"--cert-identity", expectedSigner(tag),
		"--cert-oidc-issuer", OIDC_ISSUER,
		"--source-ref", `refs/tags/${tag}`,
		"--predicate-type", SLSA_PROVENANCE_V1,
		"--deny-self-hosted-runners",
		"--format", "json",
	];
}

/** The parts of `gh attestation verify --format json` that are read here. */
interface GhVerification {
	verificationResult?: {
		signature?: {
			certificate?: Record<string, unknown>;
		};
		statement?: {
			predicateType?: string;
			subject?: { name?: string; digest?: { sha256?: string } }[];
		};
	};
}

/**
 * Reads the output of `gh attestation verify` back and checks what it says.
 *
 * `gh` has already refused anything that does not match its arguments, but its exit
 * status is all that said so, and it has exited 0 with nothing at all on standard
 * output. So the identity, ref, repository and runner are checked again here, along
 * with the archive's own digest among the statement's subjects.
 * @param stdout what `gh` wrote
 * @param tag the release tag
 * @param assetName the archive's name on the release
 * @param digest the SHA-256 of the archive, as computed here
 * @returns the signer that was verified
 * @throws {ProvenanceError} when the output is not a verification of this archive at this tag
 */
export function checkVerification(stdout: string, tag: string, assetName: string, digest: string): string {
	let results: GhVerification[];

	try {
		const parsed: unknown = JSON.parse(stdout);
		results = Array.isArray(parsed) ? parsed as GhVerification[] : [];
	}
	catch {
		throw new ProvenanceError(`the verification of ${assetName} produced no result to read`);
	}

	if (results.length === 0) {
		throw new ProvenanceError(`the verification of ${assetName} produced no result to read`);
	}

	let reason = "no attestation matched";

	for (const result of results) {
		const certificate = result.verificationResult?.signature?.certificate ?? {};
		const statement = result.verificationResult?.statement;

		const wrong = (field: string, want: string) => certificate[field] !== want ? `${field} is ${JSON.stringify(certificate[field])}, not ${want}` : undefined;
		const attested = statement?.subject?.some(subject => subject.name === assetName && subject.digest?.sha256?.toLowerCase() === digest);

		const problem = [
			wrong("subjectAlternativeName", expectedSigner(tag)),
			wrong("issuer", OIDC_ISSUER),
			wrong("sourceRepositoryURI", `https://github.com/${GITHUB_REPO}`),
			wrong("sourceRepositoryRef", `refs/tags/${tag}`),
			wrong("runnerEnvironment", "github-hosted"),
			statement?.predicateType === SLSA_PROVENANCE_V1 ? undefined : `predicate type is ${JSON.stringify(statement?.predicateType)}`,
			attested ? undefined : `${assetName} with this digest is not among the attested files`,
		].find(found => found !== undefined);

		if (problem === undefined) {
			return expectedSigner(tag);
		}

		reason = problem;
	}

	throw new ProvenanceError(`${assetName} is not attested by the ${tag} release workflow: ${reason}`);
}

/** What `verifyProvenance` needs to know. */
export interface VerifyProvenanceOptions {
	/** The release tag the archive came from. */
	tag: string;
	/** The archive's name on the release. */
	assetName: string;
	/** The downloaded archive. */
	archivePath: string;
	/** Told when the check could not be made and the archive is accepted anyway. */
	warn: (message: string) => void;
	/** How to run the GitHub CLI, which tests replace. */
	run?: RunGh;
	/** The environment to read `CI` and `CFML_SKIP_PROVENANCE` from. */
	env?: NodeJS.ProcessEnv;
}

/**
 * Checks that an archive was built and attested by clif's release workflow.
 *
 * What does not pass: a definite failure, anywhere, and a check that could not be made
 * in CI, where a release is built. On a developer's machine a missing `gh` is a warning,
 * and `CFML_SKIP_PROVENANCE=1` skips the check, so packaging works offline. It is
 * ignored in CI: a build that publishes is the one that has to be checked.
 * @param options the archive and how to check it
 * @returns the signer that was verified, or undefined when the check was not made
 * @throws {ProvenanceError} when the archive is not attested by the release workflow
 */
export async function verifyProvenance(options: VerifyProvenanceOptions): Promise<string | undefined> {
	const { tag, assetName, archivePath, warn } = options;
	const run = options.run ?? runGh;
	const env = options.env ?? process.env;
	const inCI = env.CI === "true" || env.GITHUB_ACTIONS === "true";

	if (!provenanceRequired(tag)) {
		warn(`${assetName} was not checked for provenance: ${tag} is older than ${PROVENANCE_ATTESTED_FROM}, the first release with a build attestation`);

		return undefined;
	}

	if (!inCI && env.CFML_SKIP_PROVENANCE) {
		warn(`${assetName} was not checked for provenance: CFML_SKIP_PROVENANCE is set`);

		return undefined;
	}

	const result = await run(ghArguments(archivePath, tag));

	if (result.missing) {
		if (inCI) {
			throw new ProvenanceError(`the GitHub CLI (gh) is needed to check the provenance of ${assetName}, and is not installed`);
		}

		warn(`${assetName} was not checked for provenance: the GitHub CLI (gh) is not installed. Install it, or set CFML_SKIP_PROVENANCE=1 to stop this warning`);

		return undefined;
	}

	if (result.code !== 0) {
		const detail = (result.stderr || result.stdout).trim().split(/\r?\n/).find(line => line.trim() !== "") ?? `exit status ${result.code}`;

		throw new ProvenanceError(`could not verify the provenance of ${assetName}: ${detail}`);
	}

	return checkVerification(result.stdout, tag, assetName, await sha256OfFile(archivePath));
}
