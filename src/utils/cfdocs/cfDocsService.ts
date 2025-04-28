/* eslint-disable jsdoc/require-param */
/* eslint-disable jsdoc/check-tag-names */
import fetch from "isomorphic-fetch";
import { commands, Position, Range, TextDocument, TextLine, Uri, window, workspace, WorkspaceConfiguration, TextEditor, env, CancellationToken, TextEditorEdit, ProgressLocation } from "vscode";
import { getFunctionSuffixPattern } from "../../entities/function";
import { GlobalEntity } from "../../entities/globals";
import { getTagPrefixPattern } from "../../entities/tag";
import * as cachedEntity from "../../features/cachedEntities";
import { DocumentPositionStateContext, getDocumentPositionStateContext } from "../documentUtil";
import { CFMLEngine, CFMLEngineName } from "./cfmlEngine";
import { extensionContext } from "../../cfmlMain";
import { CFDocsDefinitionInfo, EngineCompatibilityDetail } from "./definitionInfo";
import JSZip from "jszip";

enum CFDocsSource {
	remote = "remote",
	local = "local",
	extension = "extension",
	lucee = "lucee",
}

export default class CFDocsService {
	private static cfDocsRepoLinkPrefix: string = "https://raw.githubusercontent.com/foundeo/cfdocs/master/data/en/";
	private static cfDocsLinkPrefix: string = "https://cfdocs.org/";

	/**
	 * Gets definition information for global identifiers based on a local resources directory
	 * @param docsRoot The root directory of the local resources (may be a user path, or within the extension)
	 * @param identifier The global identifier for which to get definition info
	 * @returns
	 */
	private static async getLocalDefinitionInfo(docsRoot: Uri, identifier: string): Promise<CFDocsDefinitionInfo> {
		try {
			const pathUri: Uri = Uri.joinPath(docsRoot, CFDocsService.getJsonFileName(identifier));
			const readData = await workspace.fs.readFile(pathUri);
			const readStr = Buffer.from(readData).toString("utf8");
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
			const readJson = JSON.parse(readStr);
			return CFDocsService.constructDefinitionFromJsonDoc(readJson);
		}
		catch (e) {
			console.log(`Error with the JSON doc for ${identifier}:`, (<Error>e).message);
			throw e;
		}
	}

	/**
	 * Gets definition information for global identifiers based on a remote CFDocs repository
	 * @param identifier The global identifier for which to get definition info
	 * @returns
	 */
	private static async getRemoteDefinitionInfo(identifier: string): Promise<CFDocsDefinitionInfo> {
		const cfDocsLink: string = CFDocsService.cfDocsRepoLinkPrefix + CFDocsService.getJsonFileName(identifier);

		try {
			const response = await fetch(cfDocsLink);
			const data = await response.json() as CFDocsDefinitionInfo;
			return CFDocsService.constructDefinitionFromJsonDoc(data);
		}
		catch (ex) {
			console.log(`Error with the JSON doc for ${identifier}:`, (<Error>ex).message);
			throw ex;
		}
	}

	/**
	 * Constructs a CFDocsDefinitionInfo object from the respective JSON string
	 * @param jsonDoc A JSON string conforming to the CFDocs definition structure
	 * @returns
	 */
	private static constructDefinitionFromJsonDoc(jsonDoc): CFDocsDefinitionInfo {
		// const jsonDoc = JSON.parse(jsonTextDoc);

		return new CFDocsDefinitionInfo(
			// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
			jsonDoc.name,
			// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
			jsonDoc.type,
			// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
			jsonDoc.syntax,
			// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
			jsonDoc.member,
			// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
			jsonDoc.script,
			// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
			jsonDoc.returns,
			// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
			jsonDoc.related,
			// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
			jsonDoc.description,
			// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
			jsonDoc.discouraged,
			// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
			jsonDoc.params,
			// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
			jsonDoc.engines,
			// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
			jsonDoc.links,
			// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
			jsonDoc.examples
		);
	}

	/**
	 * Generates the respective JSON file name from the global identifier
	 * @param identifier The global identifier for which to the file name will be generated
	 * @returns
	 */
	private static getJsonFileName(identifier: string): string {
		return `${identifier.toLowerCase()}.json`;
	}

	/**
	 * Returns a list of all global CFML functions documented on CFDocs
	 * @param source Indicates whether the data will be retrieved locally or remotely
	 * @returns
	 */
	public static async getAllFunctionNames(source = CFDocsSource.remote): Promise<string[]> {
		const getDefinitionInfo = await this.resolveGetDefinitionInfo(source);
		return (await getDefinitionInfo("functions")).related || [];
	}

	/**
	 * Returns a list of all global CFML tags documented on CFDocs
	 * @param source Indicates whether the data will be retrieved locally or remotely
	 * @returns
	 */
	public static async getAllTagNames(source = CFDocsSource.remote): Promise<string[]> {
		const getDefinitionInfo = await this.resolveGetDefinitionInfo(source);
		return (await getDefinitionInfo("tags")).related || [];
	}

	/**
	 * Sets the given definition as a global function in the cached entities
	 * @param definition The definition object to cache
	 * @returns
	 */
	public static setGlobalFunction(definition: CFDocsDefinitionInfo): boolean {
		const cfmlEngineSettings: WorkspaceConfiguration = workspace.getConfiguration("cfml.engine");
		const userEngineName: CFMLEngineName = CFMLEngineName.valueOf(cfmlEngineSettings.get<string>("name", "coldfusion"));
		const userEngine: CFMLEngine = new CFMLEngine(userEngineName, cfmlEngineSettings.get<string>("version", "2021.0.0"));
		if (definition.type === "function" && definition.isCompatible(userEngine)) {
			cachedEntity.setGlobalFunction(definition.toGlobalFunction());
			// TODO: Add member function also
			cachedEntity.setGlobalEntityDefinition(definition);
			return true;
		}
		return false;
	}

	/**
	 * Sets the given definition as a global function in the cached entities
	 * @param definition The definition object to cache
	 * @returns
	 */
	public static setGlobalMemberFunction(definition: CFDocsDefinitionInfo): boolean {
		const cfmlEngineSettings: WorkspaceConfiguration = workspace.getConfiguration("cfml.engine");
		const userEngineName: CFMLEngineName = CFMLEngineName.valueOf(cfmlEngineSettings.get<string>("name", "coldfusion"));
		const userEngine: CFMLEngine = new CFMLEngine(userEngineName, cfmlEngineSettings.get<string>("version", "2021.0.0"));
		if (definition.type === "function" && definition.isCompatible(userEngine)) {
			cachedEntity.setGlobalMemberFunction(definition.toGlobalFunction());
			// TODO: Add member function also
			cachedEntity.setGlobalEntityDefinition(definition);
			return true;
		}
		return false;
	}

	/**
	 * Sets the given definition as a global tag in the cached entities
	 * @param definition The definition object to cache
	 * @returns
	 */
	public static setGlobalTag(definition: CFDocsDefinitionInfo): boolean {
		const cfmlEngineSettings: WorkspaceConfiguration = workspace.getConfiguration("cfml.engine");
		const userEngineName: CFMLEngineName = CFMLEngineName.valueOf(cfmlEngineSettings.get<string>("name", "coldfusion"));
		const userEngine: CFMLEngine = new CFMLEngine(userEngineName, cfmlEngineSettings.get<string>("version", "2021.0.0"));
		if (definition.type === "tag" && definition.isCompatible(userEngine)) {
			cachedEntity.setGlobalTag(definition.toGlobalTag());
			cachedEntity.setGlobalEntityDefinition(definition);
			return true;
		}
		return false;
	}

	public static async isValidDocRoot(docRoot: Uri): Promise<boolean> {
		try {
			await workspace.fs.stat(Uri.joinPath(docRoot, "/functions.json"));
		}
		catch {
			return false;
		}
		return true;
	}

	/**
	 * Returns a function which retrieves the definition information based on the CFDocs source
	 *
	 * This hides some of the complexity of handling multiple local and remote sources.
	 * @param cfdocsSource The source of the documentation
	 * @returns
	 */
	public static async resolveGetDefinitionInfo(cfdocsSource: CFDocsSource): Promise<(identifier: string) => Promise<CFDocsDefinitionInfo>> {
		let getDefinitionInfo: ((identifier: string) => Promise<CFDocsDefinitionInfo>) | undefined;
		if (cfdocsSource === CFDocsSource.remote) {
			getDefinitionInfo = CFDocsService.getRemoteDefinitionInfo.bind(CFDocsService);
		}
		if (cfdocsSource === CFDocsSource.local && env.appHost === "desktop") {
			// Use documentation from a local path specified by the user
			const cfmlCfDocsSettings: WorkspaceConfiguration = workspace.getConfiguration("cfml.cfDocs");
			const localPath: string | undefined = cfmlCfDocsSettings.get("localPath", "");
			if (await this.isValidDocRoot(Uri.file(localPath))) {
				getDefinitionInfo = CFDocsService.getLocalDefinitionInfo.bind(CFDocsService, Uri.file(localPath));
				console.info(`Loading documentation from cfml.cfDocs.localPath: "${localPath}"`);
			}
			else {
				console.warn(`Invalid local path for CFDocs: "${localPath}"`);
				window.showErrorMessage("Invalid local path for CFDocs. Please check your settings.");
			}
		}
		else if (cfdocsSource === CFDocsSource.extension) {
			// Use documentation bundled with the extension
			const cfDocsPath = Uri.file(extensionContext.asAbsolutePath("./resources/schemas/cfdocs/en/"));
			getDefinitionInfo = CFDocsService.getLocalDefinitionInfo.bind(CFDocsService, cfDocsPath);
			console.info(`Loading documentation from extension: "${cfDocsPath.fsPath}"`);
		}
		else if (cfdocsSource === CFDocsSource.lucee) {
			// Use documentation downloaded from the Lucee website and cached in the extension
			const luceeDocsPath = Uri.file(extensionContext.asAbsolutePath("./resources/schemas/lucee/"));
			if (await this.isValidDocRoot(luceeDocsPath)) {
				console.info(`Loading documentation downloaded from Lucee: ${luceeDocsPath.fsPath}`);
				getDefinitionInfo = CFDocsService.getLocalDefinitionInfo.bind(CFDocsService, luceeDocsPath);
			}
			else {
				console.warn(`Invalid local path for Lucee CFDocs: ${luceeDocsPath.fsPath}`);
				window.showErrorMessage("Invalid local path for Lucee CFDocs. Did you download the Lucee CFDocs?");
			}
		}
		if (!getDefinitionInfo) {
			// Fallback to remote CFDocs
			console.info(`Loading documentation from remote CFDocs: ${CFDocsService.cfDocsRepoLinkPrefix}`);
			getDefinitionInfo = CFDocsService.getRemoteDefinitionInfo.bind(CFDocsService);
		}
		return getDefinitionInfo;
	}

	/**
	 * Caches all documented tags and functions from CFDocs
	 * @returns
	 */
	public static async cacheAll(): Promise<boolean> {
		const cfmlCfDocsSettings: WorkspaceConfiguration = workspace.getConfiguration("cfml.cfDocs");
		const cfdocsSource: CFDocsSource = cfmlCfDocsSettings.get<CFDocsSource>("source", CFDocsSource.remote);

		const getDefinitionInfo = await this.resolveGetDefinitionInfo(cfdocsSource);
		const allFunctionNames: string[] = await CFDocsService.getAllFunctionNames(cfdocsSource);
		const allTagNames: string[] = (await getDefinitionInfo("tags")).related || [];
		const cfDocsCount = allFunctionNames.length + allTagNames.length;

		await window.withProgress({ location: ProgressLocation.Notification, title: "Loading CFDocs" }, async (progress) => {
			await Promise.all(allFunctionNames.map(async (functionName) => {
				try {
					const definitionInfo: CFDocsDefinitionInfo = await getDefinitionInfo(functionName);
					if (definitionInfo) {
						CFDocsService.setGlobalFunction(definitionInfo);
						console.log("Downloaded function");
					}
				}
				catch (e) {
					console.error(`Error with the JSON doc for ${functionName}:`, (<Error>e).message);
				}
				progress.report({ increment: 100 / cfDocsCount, message: `${functionName}` });
			}));

			await Promise.all(allTagNames.map(async (tagName) => {
				try {
					const definitionInfo: CFDocsDefinitionInfo = await getDefinitionInfo(tagName);
					if (definitionInfo) {
						CFDocsService.setGlobalTag(definitionInfo);
						console.log("Downloaded tag");
					}
				}
				catch (e) {
					console.error(`Error with the JSON doc for ${tagName}:`, (<Error>e).message);
				}
				progress.report({ increment: 100 / cfDocsCount, message: `${tagName}` });
			}));
		});

		return true;
	}

	/**
	 * Opens the documentation web page on CFDocs for the word at the current cursor position
	 * @param editor
	 * @editor The text editor which represents the document for which to check the word
	 */
	public static openCfDocsForCurrentWord(editor: TextEditor, edit: TextEditorEdit, _token: CancellationToken | undefined): void {
		const document: TextDocument = editor.document;
		const position: Position = editor.selection.start;

		const cfmlCompletionSettings: WorkspaceConfiguration = workspace.getConfiguration("cfml.suggest", document.uri);
		const replaceComments = cfmlCompletionSettings.get<boolean>("replaceComments", true);

		const documentPositionStateContext: DocumentPositionStateContext = getDocumentPositionStateContext(document, position, true, replaceComments, _token, false);

		if (documentPositionStateContext.positionInComment) {
			return;
		}

		const docPrefix: string = documentPositionStateContext.docPrefix;
		const textLine: TextLine = document.lineAt(position);
		const wordRange: Range = documentPositionStateContext.wordRange;
		const lineSuffix: string = documentPositionStateContext.sanitizedDocumentText.slice(document.offsetAt(wordRange.end), document.offsetAt(textLine.range.end));
		const userEngine: CFMLEngine = documentPositionStateContext.userEngine;

		const currentWord: string = documentPositionStateContext.currentWord;

		let globalEntity: GlobalEntity | undefined;
		const tagPrefixPattern: RegExp = getTagPrefixPattern();
		const functionSuffixPattern: RegExp = getFunctionSuffixPattern();

		if ((tagPrefixPattern.test(docPrefix) || (userEngine.supportsScriptTags() && functionSuffixPattern.test(lineSuffix))) && cachedEntity.isGlobalTag(currentWord)) {
			globalEntity = cachedEntity.getGlobalTag(currentWord);
		}
		else if (!documentPositionStateContext.isContinuingExpression && functionSuffixPattern.test(lineSuffix) && cachedEntity.isGlobalFunction(currentWord)) {
			globalEntity = cachedEntity.getGlobalFunction(currentWord);
		}

		if (globalEntity) {
			commands.executeCommand("vscode.open", Uri.parse(CFDocsService.cfDocsLinkPrefix + globalEntity.name));
		}
		else {
			window.showInformationMessage("No matching CFDocs entity was found");
		}
	}

	/**
	 * Opens the documentation web page of the currently set CF engine for the word at the current cursor position
	 * @editor The text editor which represents the document for which to check the word
	 */
	public static openEngineDocsForCurrentWord(editor: TextEditor, edit: TextEditorEdit, _token: CancellationToken | undefined): void {
		const document: TextDocument = editor.document;
		const position: Position = editor.selection.start;

		const cfmlCompletionSettings: WorkspaceConfiguration = workspace.getConfiguration("cfml.suggest", document.uri);
		const replaceComments = cfmlCompletionSettings.get<boolean>("replaceComments", true);

		const documentPositionStateContext: DocumentPositionStateContext = getDocumentPositionStateContext(document, position, true, replaceComments, _token, false);

		if (documentPositionStateContext.positionInComment) {
			return;
		}

		const userEngine: CFMLEngine = documentPositionStateContext.userEngine;

		if (userEngine.getName() === CFMLEngineName.Unknown) {
			window.showInformationMessage("CFML engine is not set");
			return;
		}

		const docPrefix: string = documentPositionStateContext.docPrefix;
		const textLine: TextLine = document.lineAt(position);
		const wordRange: Range = documentPositionStateContext.wordRange;
		const lineSuffix: string = documentPositionStateContext.sanitizedDocumentText.slice(document.offsetAt(wordRange.end), document.offsetAt(textLine.range.end));

		const currentWord: string = documentPositionStateContext.currentWord;

		let globalEntity: CFDocsDefinitionInfo | undefined;
		const tagPrefixPattern: RegExp = getTagPrefixPattern();
		const functionSuffixPattern: RegExp = getFunctionSuffixPattern();

		if ((tagPrefixPattern.test(docPrefix) || (userEngine.supportsScriptTags() && functionSuffixPattern.test(lineSuffix))) && cachedEntity.isGlobalTag(currentWord)) {
			globalEntity = cachedEntity.getGlobalEntityDefinition(currentWord);
		}
		else if (!documentPositionStateContext.isContinuingExpression && functionSuffixPattern.test(lineSuffix) && cachedEntity.isGlobalFunction(currentWord)) {
			globalEntity = cachedEntity.getGlobalEntityDefinition(currentWord);
		}

		if (globalEntity && globalEntity.engines && Object.prototype.hasOwnProperty.call(globalEntity.engines, userEngine.getName())) {
			const engineInfo: EngineCompatibilityDetail = globalEntity.engines[userEngine.getName()];
			if (engineInfo.docs) {
				commands.executeCommand("vscode.open", Uri.parse(engineInfo.docs));
			}
			else {
				window.showInformationMessage("No engine docs for this entity was found");
			}

			return;
		}

		window.showInformationMessage("No matching compatible entity was found");
	}

	/**
	 *
	 */
	public static async downloadDocs(): Promise<void> {
		// TODO: Limit how often this is downloaded
		// TODO: Test the web extension
		// TODO: Saving the extracted files is slow, see if this can be improved with another library or a script
		// TODO: Consider validation of the JSON files

		const cfmlCfDocsSettings: WorkspaceConfiguration = workspace.getConfiguration("cfml.cfDocs");
		const cfdocsSource: CFDocsSource = cfmlCfDocsSettings.get<CFDocsSource>("source", CFDocsSource.remote);
		if (cfdocsSource !== CFDocsSource.lucee) {
			return;
		}
		const docsRoot = Uri.file(extensionContext.asAbsolutePath("./resources/schemas/lucee/"));
		const zipURL = "https://docs.lucee.org/lucee-docs-json-zipped.zip";

		// Weight of each progress step to smooth out the progress bar
		const progressWeights = {
			connecting: 5,
			downloading: 15,
			extracting: 80, // the bottleneck is saving 800+ files
		};

		await window.withProgress({ location: ProgressLocation.Notification, title: "Download CFDocs" }, async (progress) => {
			progress.report({ increment: 0, message: "Connecting" });

			// TODO: test if this will work in VS Code for the Web if the cors issue is fixed
			// Host the zip file locally

			let zipFile: Response;
			try {
				zipFile = await fetch(zipURL);
			}
			catch (e) {
				let message = (e as Error)?.message || "Unknown error";
				if (env.appHost !== "desktop") {
					message = message + " (this may be due to a CORS error)";
				}
				console.error(`Failed to download CFDocs zip file: "${zipURL}" (${message})`);
				window.showErrorMessage(`Failed to download CFDocs: ${message}`);
				return;
			}
			if (!zipFile.ok) {
				console.error(`Failed to download CFDocs zip file: "${zipURL}" (${zipFile.status})`);
				window.showErrorMessage("Failed to download CFDocs");
				return;
			}
			const zipFileBuffer = await zipFile.arrayBuffer();

			progress.report({ increment: progressWeights.connecting, message: "Downloading" });

			// TODO: handle zip containing another zip file (this compresses better)

			let zip = new JSZip();
			await zip.loadAsync(zipFileBuffer, { base64: false, checkCRC32: true });

			// If the zip file contains another zip file, extract it
			const innerZipFile = zip.filter(file => file.endsWith(".zip"))[0];
			if (innerZipFile) {
				const innerZipContents = await innerZipFile.async("uint8array");
				const innerZip = new JSZip();
				await innerZip.loadAsync(innerZipContents, { base64: false, checkCRC32: true });
				zip = innerZip;
			}

			const docFiles = zip.filter(file => file.endsWith(".json"));
			if (docFiles.length === 0) {
				window.showErrorMessage("No CFDocs files found");
				return;
			}

			workspace.fs.createDirectory(docsRoot);

			progress.report({ increment: progressWeights.downloading, message: "Extracting" });

			for (const file of docFiles) {
				const filePath = Uri.joinPath(docsRoot, file.name);
				const contents: Uint8Array = await file.async("uint8array");
				// writeFile seems to take up the vast majority of the total time
				await workspace.fs.writeFile(filePath, contents);
				progress.report({ increment: progressWeights.extracting / docFiles.length, message: `Extracting ${file.name}...` });
			}
		});
	}
}
