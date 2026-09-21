import * as assert from "assert";
import { Disposable } from "vscode";

import { GatedRegistration } from "../lsp/gatedRegistration";

/**
 * A disposable that records having been disposed.
 * @returns the fake, with a `disposed` count
 */
function fakeDisposable(): Disposable & { disposed: number } {
	return {
		disposed: 0,
		dispose(): void {
			this.disposed++;
		},
	};
}

describe("LSP gating", function () {
	// VS Code merges the results of every registered provider, so the extension's
	// own providers and the server both answering is not redundancy — completion
	// comes back doubled and go-to-definition offers two entries for one symbol.
	// The group must therefore be down whenever the server owns the language.
	it("stands the group down while the server owns the language", async function () {
		const gate = new GatedRegistration(() => [fakeDisposable()]);

		await gate.sync(false);
		assert.strictEqual(gate.isLive, true, "should be up with no server");

		await gate.sync(true);
		assert.strictEqual(gate.isLive, false, "should be down with the server up");
	});

	it("disposes what it registered, exactly once", async function () {
		const registered = [fakeDisposable(), fakeDisposable()];
		const gate = new GatedRegistration(() => registered);

		await gate.sync(false);
		await gate.sync(true);

		assert.deepStrictEqual(registered.map(d => d.disposed), [1, 1]);

		// A second stand-down has nothing left to drop. Disposing twice is not
		// harmless for a FileSystemWatcher.
		await gate.sync(true);
		assert.deepStrictEqual(registered.map(d => d.disposed), [1, 1]);
	});

	// The reason `sync` is safe to call repeatedly: it is called at activation
	// and again whenever `cfml.lsp.enabled` changes, which a settings file being
	// saved can report more than once.
	it("does not register a second set when already up", async function () {
		let registrations = 0;
		const gate = new GatedRegistration(() => {
			registrations++;

			return [fakeDisposable()];
		});

		await gate.sync(false);
		await gate.sync(false);
		await gate.sync(false);

		assert.strictEqual(registrations, 1);
	});

	// Turning the server off hands the workspace back. Without this the window
	// has no language features at all until it is reloaded, and no cache for the
	// providers that come back to read.
	it("comes back after the server is turned off", async function () {
		let registrations = 0;
		const gate = new GatedRegistration(() => {
			registrations++;

			return [fakeDisposable()];
		});

		await gate.sync(false);
		await gate.sync(true);
		await gate.sync(false);

		assert.strictEqual(registrations, 2);
		assert.strictEqual(gate.isLive, true);
	});

	// The component cache's watchers only keep current what something filled
	// first, so the bulk scan runs on every take-up, not merely the first.
	it("runs the take-up work on every take-up", async function () {
		let takeUps = 0;
		const gate = new GatedRegistration(
			() => [fakeDisposable()],
			async () => {
				takeUps++;

				return Promise.resolve();
			},
		);

		await gate.sync(false);
		assert.strictEqual(takeUps, 1);

		await gate.sync(false);
		assert.strictEqual(takeUps, 1, "already up, nothing to take up");

		await gate.sync(true);
		await gate.sync(false);
		assert.strictEqual(takeUps, 2);
	});

	// `sync` resolves only once the take-up work has, which is what lets
	// activation wait for the workspace scan as it always has.
	it("waits for the take-up work before resolving", async function () {
		let finished = false;
		const gate = new GatedRegistration(
			() => [fakeDisposable()],
			async () => {
				await new Promise(resolve => setTimeout(resolve, 5));
				finished = true;
			},
		);

		await gate.sync(false);

		assert.strictEqual(finished, true);
	});

	// The server flapping while the scan is in flight: `cfml.restartLspServer`
	// stops and starts it, and the stop arrives while the take-up triggered by a
	// previous stop is still awaiting. The group must end up down, matching the
	// server, rather than believing itself up with nothing registered.
	it("ends up matching the server when it stops mid-take-up", async function () {
		const registered = fakeDisposable();
		const gate = new GatedRegistration(
			() => [registered],
			() => new Promise(resolve => setTimeout(resolve, 10)),
		);

		const takingUp = gate.sync(false);
		await gate.sync(true);
		await takingUp;

		assert.strictEqual(gate.isLive, false, "server is up, so the group must be down");
		assert.strictEqual(registered.disposed, 1);
	});

	// Not `live.length > 0`: a register that returns nothing would read as stood
	// down, and every sync would register again and re-run the take-up — which for
	// the component cache is a scan of every .cfc in the workspace, per call.
	it("counts an empty registration as up", async function () {
		let takeUps = 0;
		const gate = new GatedRegistration(
			() => [],
			async () => {
				takeUps++;

				return Promise.resolve();
			},
		);

		await gate.sync(false);
		await gate.sync(false);

		assert.strictEqual(gate.isLive, true);
		assert.strictEqual(takeUps, 1);
	});

	it("dispose() takes the group down directly, for deactivation", async function () {
		const registered = fakeDisposable();
		const gate = new GatedRegistration(() => [registered]);

		await gate.sync(false);
		gate.dispose();

		assert.strictEqual(gate.isLive, false);
		assert.strictEqual(registered.disposed, 1);
	});
});
