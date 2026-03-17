import {
	commands,
	debug,
	DebugAdapterDescriptor,
	DebugAdapterDescriptorFactory,
	DebugAdapterServer,
	DebugSession,
	EventEmitter,
	ExtensionContext,
	languages,
	ProviderResult,
	TextDocumentContentProvider,
	Uri,
	window,
	workspace,
	EvaluatableExpression,
	EvaluatableExpressionProvider,
	Position,
	TextDocument,
	CancellationToken,
	WebviewPanel,
	ViewColumn,
} from "vscode";

let currentDebugSession: DebugSession | null = null;

interface DebugPaneContextMenuArgs {
	container: {
		expensive: boolean;
		name: string;
		variablesReference: number;
	};
	sessionId: string;
	variable: {
		name: string;
		value: string;
		variablesReference: number;
	};
}

interface DumpResponse {
	content: string;
}

interface DebugBreakpointBindingsResponse {
	canonicalFilenames: string[];
	breakpoints: [string, string][];
	pathTransforms: string[];
}

interface GetSourcePathResponse {
	path: string | null;
}

class CfmlDebugAdapterDescriptorFactory implements DebugAdapterDescriptorFactory {
	createDebugAdapterDescriptor(session: DebugSession): ProviderResult<DebugAdapterDescriptor> {
		currentDebugSession = session;

		const host = session.configuration.hostName as string;
		const port = parseInt(session.configuration.port);

		return new DebugAdapterServer(port, host);
	}
}

class CfmlDebugTextDocumentProvider implements TextDocumentContentProvider {
	private docs: { [uri: string]: string } = {};
	private onDidChangeEmitter = new EventEmitter<Uri>();
	onDidChange = this.onDidChangeEmitter.event;

	addOrReplaceTextDoc(uri: Uri, text: string): void {
		this.docs[uri.toString()] = text;
		this.onDidChangeEmitter.fire(uri);
	}

	provideTextDocumentContent(uri: Uri): ProviderResult<string> {
		return this.docs[uri.toString()] ?? null;
	}
}

class CfmlEvaluatableExpressionProvider implements EvaluatableExpressionProvider {
	provideEvaluatableExpression(document: TextDocument, position: Position, _token: CancellationToken): ProviderResult<EvaluatableExpression> {
		// Match most variable declaration styles:
		// local.varName, varName, local.varName.subKey, local.varName['subKey'],
		// local['varName'].subKey, local['varName'][subKey], local.varName["subKey"]
		const varRange = document.getWordRangeAtPosition(position, /[\w_][\w\[\]"'._-]+[\w\]]/ig)
			?? document.getWordRangeAtPosition(position);

		if (varRange !== undefined) {
			return new EvaluatableExpression(varRange);
		}
		return undefined;
	}
}

const webviewPanelByUri: { [uri: string]: WebviewPanel } = {};

function updateOrCreateWebview(uri: Uri, html: string): void {
	const uriString = uri.toString();
	const panel = webviewPanelByUri[uriString];

	if (panel) {
		panel.webview.html = html;
		panel.reveal(undefined, true);
	}
	else {
		const newPanel = window.createWebviewPanel(
			"cfml-debug",
			uri.path,
			ViewColumn.One,
			{ enableScripts: true }
		);
		newPanel.webview.html = html;
		webviewPanelByUri[uriString] = newPanel;
		newPanel.onDidDispose(() => {
			delete webviewPanelByUri[uriString];
		});
	}
}

function normalizePathFromSession(session: DebugSession, path: string): string {
	const pathSeparator = session.configuration?.pathSeparator ?? "auto";
	if (pathSeparator === "none") return path;

	const platformDefault = process.platform === "win32" ? "\\" : "/";
	const normalizedSeparator = pathSeparator === "posix"
		? "/"
		: pathSeparator === "windows"
			? "\\"
			: platformDefault;

	return path.replace(/[\\/]/g, normalizedSeparator);
}

export function registerDebugAdapter(context: ExtensionContext): void {
	const outputChannel = window.createOutputChannel("CFML Debugger");
	const textDocumentProvider = new CfmlDebugTextDocumentProvider();

	context.subscriptions.push(outputChannel);
	context.subscriptions.push(debug.registerDebugAdapterDescriptorFactory("cfml", new CfmlDebugAdapterDescriptorFactory()));
	context.subscriptions.push(workspace.registerTextDocumentContentProvider("cfml-debug", textDocumentProvider));
	context.subscriptions.push(languages.registerEvaluatableExpressionProvider("cfml", new CfmlEvaluatableExpressionProvider()));
	context.subscriptions.push(languages.registerEvaluatableExpressionProvider("cfs", new CfmlEvaluatableExpressionProvider()));

	// Dump variable as HTML
	context.subscriptions.push(
		commands.registerCommand("cfml.debug.dump", async (args?: Partial<DebugPaneContextMenuArgs>) => {
			if (!currentDebugSession || args?.variable === undefined || args.variable.variablesReference === 0) {
				return;
			}

			const result: DumpResponse = await currentDebugSession.customRequest("dump", {
				variablesReference: args.variable.variablesReference
			});

			const uri = Uri.from({
				scheme: "cfml-debug",
				path: args.variable.name,
				fragment: args.variable.variablesReference.toString()
			});

			updateOrCreateWebview(uri, result.content);
		})
	);

	// Dump variable as JSON
	context.subscriptions.push(
		commands.registerCommand("cfml.debug.dumpAsJSON", async (args?: Partial<DebugPaneContextMenuArgs>) => {
			if (!currentDebugSession || args?.variable === undefined || args.variable.variablesReference === 0) {
				return;
			}

			const result: DumpResponse = await currentDebugSession.customRequest("dumpAsJSON", {
				variablesReference: args.variable.variablesReference
			});

			let obj: unknown;
			try {
				obj = JSON.parse(result.content);
			}
			catch {
				obj = "Failed to parse the following JSON:\n" + result.content;
			}

			const uri = Uri.from({
				scheme: "cfml-debug",
				path: args.variable.name,
				fragment: args.variable.variablesReference.toString()
			});
			const text = JSON.stringify(obj, undefined, 4);

			textDocumentProvider.addOrReplaceTextDoc(uri, text);

			const doc = await workspace.openTextDocument(uri);
			await window.showTextDocument(doc);
		})
	);

	// Get metadata for variable
	context.subscriptions.push(
		commands.registerCommand("cfml.debug.getMetadata", async (args?: Partial<DebugPaneContextMenuArgs>) => {
			if (!currentDebugSession || args?.variable === undefined || args.variable.variablesReference === 0) {
				return;
			}

			const result: DumpResponse = await currentDebugSession.customRequest("getMetadata", {
				variablesReference: args.variable.variablesReference
			});

			let obj: unknown;
			try {
				obj = JSON.parse(result.content);
			}
			catch {
				obj = "Failed to parse the following JSON:\n" + result.content;
			}

			const uri = Uri.from({
				scheme: "cfml-debug",
				path: args.variable.name + ".metadata",
				fragment: args.variable.variablesReference.toString()
			});
			const text = JSON.stringify(obj, undefined, 4);

			textDocumentProvider.addOrReplaceTextDoc(uri, text);

			const doc = await workspace.openTextDocument(uri);
			await window.showTextDocument(doc);
		})
	);

	// Get application settings
	context.subscriptions.push(
		commands.registerCommand("cfml.debug.getApplicationSettings", async (args?: Partial<DebugPaneContextMenuArgs>) => {
			if (!currentDebugSession) {
				return;
			}

			// Only allow for the top-level application scope
			if (!args?.container || args.container.name !== "application") {
				window.showWarningMessage("Get Application Settings is only available for the top-level application scope");
				return;
			}

			const result: DumpResponse = await currentDebugSession.customRequest("getApplicationSettings", {
				variablesReference: args.container.variablesReference
			});

			let obj: unknown;
			try {
				obj = JSON.parse(result.content);
			}
			catch {
				obj = "Failed to parse the following JSON:\n" + result.content;
			}

			const uri = Uri.from({
				scheme: "cfml-debug",
				path: "applicationSettings",
				fragment: Date.now().toString()
			});
			const text = JSON.stringify(obj, undefined, 4);

			textDocumentProvider.addOrReplaceTextDoc(uri, text);

			const doc = await workspace.openTextDocument(uri);
			await window.showTextDocument(doc);
		})
	);

	// Open source file for variable
	context.subscriptions.push(
		commands.registerCommand("cfml.debug.openSourceFile", async (args?: Partial<DebugPaneContextMenuArgs>) => {
			if (!currentDebugSession || !args || args.variable === undefined || args.variable.variablesReference === 0) {
				return;
			}

			const data: GetSourcePathResponse = await currentDebugSession.customRequest("getSourcePath", {
				variablesReference: args.variable.variablesReference
			});

			if (!data.path) {
				return;
			}

			const uri = Uri.from({ scheme: "file", path: data.path });
			const doc = await workspace.openTextDocument(uri);
			await window.showTextDocument(doc);
		})
	);

	// Show breakpoint bindings (debug info)
	context.subscriptions.push(
		commands.registerCommand("cfml.debug.showBreakpointBindings", async () => {
			if (!currentDebugSession) {
				throw Error("CFML debugger is not currently connected, cannot show breakpoint bindings.");
			}

			const data: DebugBreakpointBindingsResponse = await currentDebugSession.customRequest("debugBreakpointBindings");

			const uri = Uri.from({ scheme: "cfml-debug", path: "breakpointBindings" });
			const text = "Breakpoints the debugger has:\n"
				+ data.breakpoints
					.sort(([l_idePath], [r_idePath]) => l_idePath < r_idePath ? -1 : 1)
					.map(([idePath, serverPath]) => `  (ide)    ${idePath}\n  (server) ${serverPath}`)
					.join("\n\n")
				+ "\n\nPath transforms:\n"
				+ (data.pathTransforms.length === 0 ? "  <<none>>" : data.pathTransforms.map(v => `  ${v}`).join("\n"))
				+ "\n\nFiles the debugger knows about (all filenames are as the server sees them, and match against breakpoint 'server' paths):\n"
				+ data.canonicalFilenames.sort().map(s => `  ${s}`).join("\n");

			textDocumentProvider.addOrReplaceTextDoc(uri, text);

			const doc = await workspace.openTextDocument(uri);
			await window.showTextDocument(doc);
		})
	);

	// Debug adapter tracker for logging DAP messages
	context.subscriptions.push(
		debug.registerDebugAdapterTrackerFactory("cfml", {
			createDebugAdapterTracker(session: DebugSession) {
				return {
					onWillReceiveMessage(message: unknown): void {
						outputChannel.appendLine(JSON.stringify(message, null, 4));
					},
					onDidSendMessage(message: unknown): void {
						// Normalize paths in stack trace responses
						const msg = message as { command?: string; type?: string; body?: { stackFrames?: Array<{ source?: { path?: string } }> } };
						if (msg.command === "stackTrace" || (msg.type === "response" && msg.body?.stackFrames)) {
							for (const frame of msg.body?.stackFrames ?? []) {
								if (frame.source?.path) {
									frame.source.path = normalizePathFromSession(session, frame.source.path);
								}
							}
						}
						outputChannel.appendLine(JSON.stringify(message, null, 4));
					}
				};
			}
		})
	);

	// Clear session on debug stop
	context.subscriptions.push(
		debug.onDidTerminateDebugSession((session) => {
			if (session === currentDebugSession) {
				currentDebugSession = null;
			}
		})
	);
}
