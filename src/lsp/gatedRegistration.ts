import { Disposable } from "vscode";

/**
 * A set of registrations that is live only while the language server is not.
 *
 * Two groups in this extension work this way — its own language providers, and
 * its own component cache — and both have to survive the server starting and
 * stopping repeatedly while one window stays open: enabling the setting restarts
 * it, a crash takes it away without one, and `cfml.restartLspServer` does both in
 * quick succession. Standing down permanently on the first start would leave a
 * window with no language features at all after a server failure.
 *
 * It is a class rather than the two near-identical triples of module functions it
 * replaces because the interesting behaviour is the same for both and is easy to
 * get subtly wrong — see the three rules below, each of which has a test.
 */
export class GatedRegistration {
	/** What `register` returned, empty while stood down. */
	private live: Disposable[] = [];

	/**
	 * Whether the group is currently up.
	 *
	 * Deliberately not `live.length > 0`: a `register` that legitimately returns
	 * nothing would then read as stood down, and every `sync` would register again
	 * and re-run `onTakeUp` — which for the component cache is a scan of every
	 * `.cfc` in the workspace, once per call.
	 */
	private up: boolean = false;

	/**
	 * @param register called to bring the group up; returns what to dispose later
	 * @param onTakeUp optional work that has to happen each time the group comes
	 * up, not merely the first — the component cache's watchers only keep current
	 * what something filled first
	 */
	constructor(
		private readonly register: () => Disposable[],
		private readonly onTakeUp?: () => Promise<void>,
	) {}

	/**
	 * Whether the group is currently registered.
	 * @returns true while its registrations are live
	 */
	get isLive(): boolean {
		return this.up;
	}

	/**
	 * Brings the group up or takes it down to match the server.
	 *
	 * Safe to call repeatedly and in either direction. Calling it when nothing
	 * needs to change does nothing at all, which is what keeps a second call from
	 * registering a duplicate set — VS Code merges every registered provider's
	 * results, so a duplicate is not inert, it doubles every answer.
	 * @param serverRunning whether a request would reach the server
	 * @returns once `onTakeUp` has finished, so a caller that needs the group
	 * usable — activation — can wait for it
	 */
	async sync(serverRunning: boolean): Promise<void> {
		if (serverRunning) {
			this.dispose();

			return;
		}

		if (this.up) {
			return;
		}

		this.up = true;
		this.live = this.register();

		if (this.onTakeUp) {
			await this.onTakeUp();
		}
	}

	/** Drops the registrations, if the group is up. */
	dispose(): void {
		for (const disposable of this.live) {
			disposable.dispose();
		}

		this.live = [];
		this.up = false;
	}
}
