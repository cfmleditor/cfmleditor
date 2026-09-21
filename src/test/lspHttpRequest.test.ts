import * as assert from "assert";
import * as net from "net";
import { ConfigurationTarget, workspace } from "vscode";

import { bypassesProxy, proxyForUrl, requestOnce } from "../lsp/httpRequest";

/**
 * Turns VS Code's own proxy support off for a test.
 *
 * With the default `override`, the extension host replaces the agent on every
 * request with one of its own, which is the editor doing this job for us — and
 * which would send these tests at the real github.com. `off` is the setting
 * this code exists for, so it is the setting these tests run under.
 * @returns a function that puts the setting back
 */
async function withoutVSCodeProxySupport(): Promise<() => Promise<void>> {
	const config = workspace.getConfiguration("http");
	const prior = config.inspect<string>("proxySupport")?.globalValue;
	await config.update("proxySupport", "off", ConfigurationTarget.Global);

	return async () => {
		await workspace.getConfiguration("http").update("proxySupport", prior, ConfigurationTarget.Global);
	};
}

/**
 * Sets environment variables for one test and puts them back afterwards.
 * `no_proxy` is always set explicitly rather than deleted, so whatever the
 * machine running the tests has configured cannot reach the code under test.
 * @param vars the variables to set for the duration of the test
 * @returns a function that puts the environment back
 */
function withEnv(vars: Record<string, string>): () => void {
	const prior = new Map<string, string | undefined>();

	for (const [name, value] of Object.entries(vars)) {
		prior.set(name, process.env[name]);
		process.env[name] = value;
	}

	return () => {
		for (const [name, value] of prior) {
			if (value === undefined) {
				delete process.env[name];
			}
			else {
				process.env[name] = value;
			}
		}
	};
}

/**
 * A server that accepts a connection and then says nothing at all.
 * @param onConnection called with each accepted socket
 * @returns the port it is listening on, and a way to shut it down
 */
function silentServer(onConnection?: (socket: net.Socket) => void): Promise<{ port: number; close: () => void }> {
	const sockets: net.Socket[] = [];
	const server = net.createServer((socket) => {
		sockets.push(socket);
		onConnection?.(socket);
	});

	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			resolve({
				port: (server.address() as net.AddressInfo).port,
				close: () => {
					for (const socket of sockets) {
						socket.destroy();
					}
					server.close();
				},
			});
		});
	});
}

describe("LSP HTTP requests", function () {
	describe("proxy resolution", function () {
		it("prefers VS Code's own proxy setting over the environment", function () {
			const env = { https_proxy: "http://from-env:3128" } as NodeJS.ProcessEnv;
			assert.strictEqual(proxyForUrl("https://github.com/x", "http://from-settings:8080", env), "http://from-settings:8080");
		});

		it("falls back through the proxy variables in the usual order", function () {
			assert.strictEqual(proxyForUrl("https://github.com/x", undefined, { https_proxy: "http://a:1" }), "http://a:1");
			assert.strictEqual(proxyForUrl("https://github.com/x", undefined, { HTTP_PROXY: "http://b:2" }), "http://b:2");
			assert.strictEqual(proxyForUrl("https://github.com/x", "   ", { HTTPS_PROXY: "http://c:3" }), "http://c:3");
		});

		it("goes direct when nothing is configured", function () {
			assert.strictEqual(proxyForUrl("https://github.com/x", undefined, {}), undefined);
		});

		it("honours no_proxy for the host being fetched", function () {
			const env = { https_proxy: "http://p:1", no_proxy: "github.com" } as NodeJS.ProcessEnv;
			assert.strictEqual(proxyForUrl("https://github.com/x", "http://p:1", env), undefined);
			assert.strictEqual(proxyForUrl("https://objects.githubusercontent.com/x", "http://p:1", env), "http://p:1");
		});
	});

	describe("no_proxy matching", function () {
		it("matches the host itself and anything under it", function () {
			assert.strictEqual(bypassesProxy("github.com", "github.com"), true);
			assert.strictEqual(bypassesProxy("objects.github.com", ".github.com"), true);
			assert.strictEqual(bypassesProxy("objects.github.com", "*.github.com"), true);
			assert.strictEqual(bypassesProxy("notgithub.com", "github.com"), false);
		});

		it("reads a list, a port and a wildcard the way curl does", function () {
			assert.strictEqual(bypassesProxy("github.com", "example.com, github.com:443"), true);
			assert.strictEqual(bypassesProxy("anything.at.all", "*"), true);
			assert.strictEqual(bypassesProxy("github.com", ""), false);
		});
	});

	// The extension fetches the server inside `activate()`, ahead of handing the
	// workspace back to its own providers. A connection a firewall black-holes
	// rather than refuses used to hang there forever, leaving the editor with no
	// CFML features at all and nothing on screen to explain it.
	describe("timeouts", function () {
		let restoreProxySupport: () => Promise<void>;

		before(async function () {
			restoreProxySupport = await withoutVSCodeProxySupport();
		});

		after(async function () {
			await restoreProxySupport();
		});

		it("gives up on a connection that never answers", async function () {
			const server = await silentServer();
			// Whatever proxy the machine running the tests has configured is not
			// part of what is being tested here.
			const restoreEnv = withEnv({ no_proxy: "127.0.0.1" });

			try {
				await assert.rejects(
					requestOnce(`https://127.0.0.1:${server.port}/`, 250),
					/Timed out after/
				);
			}
			finally {
				restoreEnv();
				server.close();
			}
		});

		it("gives up on a proxy that never answers", async function () {
			const server = await silentServer();
			const restoreEnv = withEnv({ https_proxy: `http://127.0.0.1:${server.port}`, no_proxy: "" });

			try {
				await assert.rejects(
					requestOnce("https://github.com/cfmleditor/cfmleditor-lsp/releases/latest", 250),
					/Timed out talking to the proxy/
				);
			}
			finally {
				restoreEnv();
				server.close();
			}
		});
	});

	// Without this the proxy is simply not used: `https.get` knows nothing about
	// `http.proxy` or the environment, so every request went direct and failed
	// on a network that only routes through one.
	describe("tunnelling", function () {
		let restoreProxySupport: () => Promise<void>;

		before(async function () {
			restoreProxySupport = await withoutVSCodeProxySupport();
		});

		after(async function () {
			await restoreProxySupport();
		});

		it("asks the proxy to connect to the host it wants", async function () {
			let connectLine = "";
			const server = await silentServer((socket) => {
				socket.once("data", (chunk: Buffer) => {
					connectLine = chunk.toString("latin1").split("\r\n")[0];
					// Accepted, then silence — enough to prove the tunnel was
					// requested without needing a certificate to finish TLS.
					socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
				});
			});
			const restoreEnv = withEnv({ https_proxy: `http://127.0.0.1:${server.port}`, no_proxy: "" });

			try {
				await assert.rejects(requestOnce("https://github.com/cfmleditor/cfmleditor-lsp/releases/latest", 250));
				assert.strictEqual(connectLine, "CONNECT github.com:443 HTTP/1.1");
			}
			finally {
				restoreEnv();
				server.close();
			}
		});

		it("reports a proxy that refuses the tunnel", async function () {
			const server = await silentServer((socket) => {
				socket.once("data", () => {
					socket.write("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n");
				});
			});
			const restoreEnv = withEnv({ https_proxy: `http://127.0.0.1:${server.port}`, no_proxy: "" });

			try {
				await assert.rejects(
					requestOnce("https://github.com/cfmleditor/cfmleditor-lsp/releases/latest", 1000),
					/refused the tunnel: HTTP\/1.1 407/
				);
			}
			finally {
				restoreEnv();
				server.close();
			}
		});
	});
});
