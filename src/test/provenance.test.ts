import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { sha256OfFile } from "../lsp/checksum";
import { GhResult, PROVENANCE_ATTESTED_FROM, RunGh, expectedSigner, ghArguments, provenanceRequired, verifyProvenance } from "../scripts/provenance";

type Result = { verificationResult: { signature: { certificate: Record<string, unknown> }; statement: { predicateType: string; subject: { name: string; digest: { sha256: string } }[] } } };

const NAME = "clif-linux-amd64.tar.gz";
const TAG = "v0.7.7";

// What `gh attestation verify --format json` really printed for the v0.7.7 release, less the signature bundle
const REAL: Result[] = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../src/test/fixtures/provenance/gh-verify-v0.7.7.json"), "utf8")) as Result[];

describe("build provenance", function () {
	let dir: string;
	let archive: string;
	let digest: string;

	beforeEach(async function () {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "cfml-provenance-"));
		archive = path.join(dir, NAME);
		fs.writeFileSync(archive, "the server archive");
		digest = await sha256OfFile(archive);
	});

	afterEach(function () {
		fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
	});

	/**
	 * The real result, with the archive's entry given the digest of the test's archive.
	 * @param change what to change in the result before it is printed
	 * @returns the JSON `gh` would print
	 */
	const printed = (change?: (result: Result) => void): string => {
		const result = structuredClone(REAL[0]);
		result.verificationResult.statement.subject.find(subject => subject.name === NAME)!.digest.sha256 = digest;
		change?.(result);

		return JSON.stringify([result]);
	};

	const ghReturns = (stdout: string, code: number | null = 0, stderr = ""): { run: RunGh; calls: string[][] } => {
		const calls: string[][] = [];
		const run: RunGh = (args) => {
			calls.push(args);

			return Promise.resolve({ code, stdout, stderr, missing: false });
		};

		return { run, calls };
	};

	const verify = (run: RunGh, overrides: { tag?: string; env?: NodeJS.ProcessEnv } = {}) => {
		const warnings: string[] = [];
		const promise = verifyProvenance({ tag: overrides.tag ?? TAG, assetName: NAME, archivePath: archive, warn: m => warnings.push(m), run, env: overrides.env ?? { CI: "true" } });

		return { promise, warnings };
	};

	describe("which releases need an attestation", function () {
		it("needs one from 0.7.6, the first that has one", function () {
			assert.strictEqual(PROVENANCE_ATTESTED_FROM, "0.7.6");
			assert.strictEqual(provenanceRequired("v0.7.6"), true);
			assert.strictEqual(provenanceRequired("v0.7.7"), true);
			assert.strictEqual(provenanceRequired("v0.10.0"), true);
		});

		it("does not need one before then", function () {
			assert.strictEqual(provenanceRequired("v0.7.5"), false);
			assert.strictEqual(provenanceRequired("v0.6.9"), false);
		});

		it("needs one for a tag that is not a version", function () {
			assert.strictEqual(provenanceRequired("nightly"), true);
		});
	});

	describe("what gh is asked", function () {
		it("pins the signer, the tag, the runner and the output format", function () {
			const args = ghArguments(archive, TAG);

			assert.deepStrictEqual(args.slice(0, 3), ["attestation", "verify", archive]);
			const value = (flag: string) => args[args.indexOf(flag) + 1];
			assert.strictEqual(value("--repo"), "cfmleditor/clif");
			assert.strictEqual(value("--cert-identity"), "https://github.com/cfmleditor/clif/.github/workflows/release.yml@refs/tags/v0.7.7");
			assert.strictEqual(value("--source-ref"), "refs/tags/v0.7.7");
			assert.strictEqual(value("--cert-oidc-issuer"), "https://token.actions.githubusercontent.com");
			assert.strictEqual(value("--predicate-type"), "https://slsa.dev/provenance/v1");
			assert.strictEqual(value("--format"), "json");
			assert.ok(args.includes("--deny-self-hosted-runners"));
		});

		it("expects the release workflow at the tag", function () {
			assert.strictEqual(expectedSigner("v0.7.6"), "https://github.com/cfmleditor/clif/.github/workflows/release.yml@refs/tags/v0.7.6");
		});

		it("is what verifyProvenance runs", async function () {
			const { run, calls } = ghReturns(printed());

			await verify(run).promise;

			assert.deepStrictEqual(calls, [ghArguments(archive, TAG)]);
		});
	});

	describe("accepting an attested archive", function () {
		it("accepts what the real v0.7.7 verification printed, and names the signer", async function () {
			const { run } = ghReturns(printed());
			const { promise, warnings } = verify(run);

			assert.strictEqual(await promise, expectedSigner(TAG));
			assert.deepStrictEqual(warnings.length, 0);
		});

		it("accepts when one of several results matches", async function () {
			const wrong = structuredClone(REAL[0]);
			wrong.verificationResult.signature.certificate.subjectAlternativeName = "https://github.com/someone/else/.github/workflows/x.yml@refs/heads/main";

			const { run } = ghReturns(JSON.stringify([wrong, (JSON.parse(printed()) as Result[])[0]]));

			assert.strictEqual(await verify(run).promise, expectedSigner(TAG));
		});
	});

	describe("refusing", function () {
		const refuses = async (stdout: string, pattern: RegExp, options: { code?: number | null; stderr?: string; tag?: string } = {}) => {
			const { run } = ghReturns(stdout, options.code ?? 0, options.stderr ?? "");

			await assert.rejects(verify(run, { tag: options.tag }).promise, pattern);
		};

		it("refuses when gh says the verification failed, with its first line", async function () {
			await refuses("", /could not verify the provenance of clif-linux-amd64\.tar\.gz: Error: no attestations found/, { code: 1, stderr: "\nError: no attestations found\nmore detail\n" });
		});

		it("refuses when gh exits 0 and prints nothing, which it has done", async function () {
			await refuses("", /produced no result to read/);
		});

		it("refuses output that is not a list of results", async function () {
			await refuses("[]", /produced no result to read/);
			await refuses("not json", /produced no result to read/);
			await refuses("{}", /produced no result to read/);
		});

		it("refuses an attestation for another release's tag", async function () {
			await refuses(printed(), /subjectAlternativeName is ".*@refs\/tags\/v0\.7\.7", not .*@refs\/tags\/v0\.7\.6/, { tag: "v0.7.6" });
		});

		it("refuses another workflow, another repository, another issuer and another ref", async function () {
			const certificate = (field: string, value: unknown) => printed((result) => {
				result.verificationResult.signature.certificate[field] = value;
			});

			await refuses(certificate("subjectAlternativeName", "https://github.com/cfmleditor/clif/.github/workflows/ci.yml@refs/tags/v0.7.7"), /subjectAlternativeName is/);
			await refuses(certificate("sourceRepositoryURI", "https://github.com/someone/clif"), /sourceRepositoryURI is/);
			await refuses(certificate("issuer", "https://accounts.example.com"), /issuer is/);
			await refuses(certificate("sourceRepositoryRef", "refs/heads/main"), /sourceRepositoryRef is/);
		});

		it("refuses a self-hosted runner", async function () {
			await refuses(printed((result) => {
				result.verificationResult.signature.certificate.runnerEnvironment = "self-hosted";
			}), /runnerEnvironment is "self-hosted", not github-hosted/);
		});

		it("refuses another kind of statement", async function () {
			await refuses(printed((result) => {
				result.verificationResult.statement.predicateType = "https://example.com/other/v1";
			}), /predicate type is/);
		});

		it("refuses an archive whose digest is not among the attested files", async function () {
			await refuses(printed((result) => {
				result.verificationResult.statement.subject.find(subject => subject.name === NAME)!.digest.sha256 = "0".repeat(64);
			}), /with this digest is not among the attested files/);
		});

		it("refuses a digest that is attested under another name", async function () {
			await refuses(printed((result) => {
				result.verificationResult.statement.subject.find(subject => subject.name === NAME)!.name = "clif-darwin-arm64.tar.gz";
			}), /not among the attested files/);
		});

		it("refuses when none of several results match, naming the last reason", async function () {
			const a = structuredClone(REAL[0]);
			a.verificationResult.signature.certificate.issuer = "https://accounts.example.com";
			const b = structuredClone(REAL[0]);
			b.verificationResult.signature.certificate.runnerEnvironment = "self-hosted";

			await refuses(JSON.stringify([a, b]), /runnerEnvironment is "self-hosted"/);
		});
	});

	describe("when the check cannot be made", function () {
		const missing: RunGh = () => Promise.resolve<GhResult>({ code: null, stdout: "", stderr: "", missing: true });

		it("is an error in CI, where a release is built", async function () {
			await assert.rejects(verify(missing, { env: { CI: "true" } }).promise, /the GitHub CLI \(gh\) is needed/);
			await assert.rejects(verify(missing, { env: { GITHUB_ACTIONS: "true" } }).promise, /the GitHub CLI \(gh\) is needed/);
		});

		it("is a warning on a developer's machine", async function () {
			const { promise, warnings } = verify(missing, { env: {} });

			assert.strictEqual(await promise, undefined);
			assert.strictEqual(warnings.length, 1);
			assert.match(warnings[0], /the GitHub CLI \(gh\) is not installed/);
		});

		it("is skipped by CFML_SKIP_PROVENANCE on a developer's machine, without running gh", async function () {
			const { run, calls } = ghReturns("");
			const { promise, warnings } = verify(run, { env: { CFML_SKIP_PROVENANCE: "1" } });

			assert.strictEqual(await promise, undefined);
			assert.deepStrictEqual(calls, []);
			assert.match(warnings[0], /CFML_SKIP_PROVENANCE is set/);
		});

		it("is not skipped by CFML_SKIP_PROVENANCE in CI", async function () {
			const { run, calls } = ghReturns(printed());
			const { promise } = verify(run, { env: { CI: "true", CFML_SKIP_PROVENANCE: "1" } });

			assert.strictEqual(await promise, expectedSigner(TAG));
			assert.strictEqual(calls.length, 1);
		});

		it("still refuses a definite failure on a developer's machine", async function () {
			const { run } = ghReturns("", 1, "Error: no attestations found");

			await assert.rejects(verify(run, { env: {} }).promise, /no attestations found/);
		});

		it("does not look for an attestation on a release that predates them, and says so", async function () {
			const { run, calls } = ghReturns("");
			const { promise, warnings } = verify(run, { tag: "v0.7.5" });

			assert.strictEqual(await promise, undefined);
			assert.deepStrictEqual(calls, []);
			assert.match(warnings[0], /v0\.7\.5 is older than 0\.7\.6/);
		});
	});
});
