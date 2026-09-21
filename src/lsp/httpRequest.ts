import * as http from "http";
import * as https from "https";
import * as net from "net";
import * as tls from "tls";
import { workspace } from "vscode";

const USER_AGENT = "cfmleditor-vscode";

/**
 * How long a request may sit with nothing moving before it is abandoned.
 *
 * The timer is on the socket, so it measures inactivity rather than total
 * duration: a slow but progressing download resets it with every chunk, and a
 * connection a firewall has silently black-holed never does. Without it the
 * extension waited forever — and it does this work inside `activate()`, ahead
 * of handing the workspace back to its own providers, so a hung request left
 * the editor with no CFML features at all rather than the ones it has offline.
 */
export const IDLE_TIMEOUT_MS = 30_000;

/**
 * How many redirects are followed before giving up. GitHub takes two to reach
 * the object store; a chain longer than this is a loop or a captive portal.
 */
const MAX_REDIRECTS = 5;

/** An HTTP response that was not the success the caller needed. */
export class HttpStatusError extends Error {
	constructor(readonly statusCode: number, message: string) {
		super(message);
		this.name = "HttpStatusError";
	}
}

/**
 * Whether a host is one the proxy is meant to be skipped for.
 *
 * Follows the `no_proxy` convention: a comma separated list of suffixes, where
 * `*` means everything, an entry matches the host itself or anything under it,
 * and a port on the entry is ignored.
 * @param hostname the host being requested
 * @param noProxy the `no_proxy` value, if any
 * @returns true when the request should go direct
 */
export function bypassesProxy(hostname: string, noProxy: string | undefined): boolean {
	if (!noProxy) {
		return false;
	}

	const host = hostname.toLowerCase();

	return noProxy
		.split(",")
		.map(entry => entry.trim().toLowerCase())
		.filter(entry => entry.length > 0)
		.some((entry) => {
			if (entry === "*") {
				return true;
			}

			const bare = entry.split(":")[0].replace(/^\*?\./, "");

			return host === bare || host.endsWith(`.${bare}`);
		});
}

/**
 * The proxy to reach a URL through, if any.
 *
 * VS Code's own `http.proxy` wins over the environment, matching how the editor
 * resolves it for everything else. Separate from the request so the precedence
 * can be tested without a network or a proxy to point at.
 *
 * With `http.proxySupport` at its default of `override`, the extension host
 * replaces the agent on every request with one of its own and this never gets
 * to matter. It matters for the people who have turned that off, which was
 * previously the same as having no proxy support at all.
 * @param target the URL being requested
 * @param settingProxy the `http.proxy` setting
 * @param env the environment to read the proxy variables from
 * @returns the proxy URL, or undefined to go direct
 */
export function proxyForUrl(target: string, settingProxy: string | undefined, env: NodeJS.ProcessEnv): string | undefined {
	if (bypassesProxy(new URL(target).hostname, env.no_proxy ?? env.NO_PROXY)) {
		return undefined;
	}

	const configured = settingProxy?.trim()
		|| env.https_proxy
		|| env.HTTPS_PROXY
		|| env.http_proxy
		|| env.HTTP_PROXY;

	return configured?.trim() || undefined;
}

function resolveProxy(target: URL): URL | undefined {
	const setting = workspace.getConfiguration("http").get<string>("proxy");
	const configured = proxyForUrl(target.href, setting, process.env);
	if (!configured) {
		return undefined;
	}

	try {
		return new URL(configured);
	}
	catch {
		// A proxy nobody can parse is not a reason to fail the request — going
		// direct still works on most networks, and failing here would say
		// nothing useful about a setting the user probably did not just change.
		return undefined;
	}
}

/**
 * Opens a tunnel to `host:port` through an HTTP proxy with CONNECT, and hands
 * back the raw socket for TLS to be spoken over.
 * @param proxy the proxy to tunnel through
 * @param host the host on the far side
 * @param port the port on the far side
 * @param timeoutMs how long the proxy has to answer
 * @returns the tunnelled socket
 */
function connectThroughProxy(proxy: URL, host: string, port: number, timeoutMs: number): Promise<net.Socket> {
	return new Promise((resolve, reject) => {
		const proxyPort = Number(proxy.port) || (proxy.protocol === "https:" ? 443 : 80);
		const socket = net.connect({ host: proxy.hostname, port: proxyPort });

		const fail = (error: Error) => {
			socket.destroy();
			reject(error);
		};

		socket.setTimeout(timeoutMs, () => fail(new Error(`Timed out talking to the proxy at ${proxy.host}`)));
		socket.on("error", fail);

		socket.on("connect", () => {
			const credentials = proxy.username
				? `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`
				: undefined;
			const auth = credentials
				? `Proxy-Authorization: Basic ${Buffer.from(credentials).toString("base64")}\r\n`
				: "";

			socket.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n${auth}\r\n`);
		});

		let banner = "";
		const onData = (chunk: Buffer) => {
			banner += chunk.toString("latin1");
			if (banner.indexOf("\r\n\r\n") === -1) {
				if (banner.length > 8192) {
					fail(new Error(`The proxy at ${proxy.host} sent a response that made no sense`));
				}
				return;
			}

			const statusLine = banner.split("\r\n")[0];
			if (!/^HTTP\/1\.[01] 200/.test(statusLine)) {
				fail(new Error(`The proxy at ${proxy.host} refused the tunnel: ${statusLine || "empty response"}`));
				return;
			}

			// Nothing has been said over the tunnel yet, so there are no bytes
			// after the header to hand on — TLS starts from here.
			socket.removeListener("data", onData);
			socket.removeListener("error", fail);
			socket.setTimeout(0);
			resolve(socket);
		};

		socket.on("data", onData);
	});
}

/**
 * An agent that speaks TLS over a tunnel already opened through a proxy.
 *
 * A `createConnection` option would be less machinery, but Node only consults
 * one when the request carries no agent — and `agent: false` builds a fresh
 * one, which quietly dialled the host direct and left the tunnel unused. An
 * agent is also what VS Code's extension host respects at every
 * `http.proxySupport` setting but `override`, where it substitutes its own.
 */
class TunnelAgent extends https.Agent {
	constructor(private readonly tunnel: net.Socket, private readonly servername: string) {
		super({ keepAlive: false, maxSockets: 1 });
	}

	createConnection(): tls.TLSSocket {
		return tls.connect({ socket: this.tunnel, servername: this.servername });
	}
}

/**
 * Makes one GET request, without following redirects.
 *
 * Everything the extension fetches is HTTPS, so a proxy is reached with CONNECT
 * and TLS spoken through the tunnel. `https.get` on its own honours neither the
 * proxy nor any timeout, which is the pair of things that made this fail behind
 * a corporate network with nothing on screen to say why.
 * @param url the URL to request
 * @param timeoutMs how long the socket may be idle before the request is abandoned
 * @returns the response, with the body still unread
 */
export async function requestOnce(url: string, timeoutMs: number = IDLE_TIMEOUT_MS): Promise<http.IncomingMessage> {
	const target = new URL(url);
	const proxy = resolveProxy(target);
	const tunnel = proxy
		? await connectThroughProxy(proxy, target.hostname, Number(target.port) || 443, timeoutMs)
		: undefined;

	return new Promise((resolve, reject) => {
		const request = https.request(
			target,
			{
				method: "GET",
				headers: { "User-Agent": USER_AGENT },
				...(tunnel ? { agent: new TunnelAgent(tunnel, target.hostname) } : {}),
			},
			resolve
		);

		request.setTimeout(timeoutMs, () => {
			request.destroy(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${target.host}`));
		});
		request.on("error", reject);
		request.end();
	});
}

/**
 * Makes a GET request and follows redirects to the response that carries the body.
 * @param url the URL to request
 * @param timeoutMs how long the socket may be idle before the request is abandoned
 * @returns the final response, with the body still unread
 */
export async function requestFollowingRedirects(url: string, timeoutMs: number = IDLE_TIMEOUT_MS): Promise<http.IncomingMessage> {
	let current = url;

	for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
		const response = await requestOnce(current, timeoutMs);
		const status = response.statusCode ?? 0;

		if (status >= 300 && status < 400 && response.headers.location) {
			response.resume();
			current = new URL(response.headers.location, current).href;
			continue;
		}

		return response;
	}

	throw new Error(`Gave up after ${MAX_REDIRECTS} redirects starting at ${url}`);
}
