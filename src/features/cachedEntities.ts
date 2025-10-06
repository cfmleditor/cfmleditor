import { CancellationToken, ProgressLocation, TextDocument, Uri, window, workspace, WorkspaceConfiguration } from "vscode";
import { LSTextDocument } from "../utils/LSTextDocument";
import { Component, ComponentsByName, ComponentsByUri, COMPONENT_EXT, COMPONENT_FILE_GLOB, parseComponent, ComponentRef } from "../entities/component";
import { GlobalFunction, GlobalFunctions, GlobalMemberFunction, GlobalMemberFunctions, GlobalTag, GlobalTags } from "../entities/globals";
import { Scope } from "../entities/scope";
import { ComponentFunctions, UserFunction, UserFunctionRef } from "../entities/userFunction";
import { parseVariableAssignments, Variable, VariablesByUri } from "../entities/variable";
import { CFDocsDefinitionInfo } from "../utils/cfdocs/definitionInfo";
import { MyMap, SearchMode } from "../utils/collections";
import { APPLICATION_CFM_GLOB, isApplicationFile, isServerFile } from "../utils/contextUtil";
import { DocumentStateContext, getDocumentStateContext } from "../utils/documentUtil";
import { resolveCustomMappingPaths, resolveRelativePath, resolveRootPath, uriBaseName } from "../utils/fileUtil";
import TrieSearch from "trie-search";
import { Snippet, Snippets } from "../entities/snippet";
import { setBulkCaching } from "../cfmlMain";

let allGlobalEntityDefinitions = new MyMap<string, CFDocsDefinitionInfo>();

let allGlobalFunctions: GlobalFunctions = {};
let allGlobalMemberFunctions: GlobalMemberFunctions = {};
let allGlobalTags: GlobalTags = {};
// let allMemberFunctions: MemberFunctionsByType = new MyMap<DataType, Set<MemberFunction>>();

let allComponentsByUri: ComponentsByUri = {};
let allComponentsByName: ComponentsByName = {};
let allComponentUris: { [key: string]: Uri } = {};

const allComponentNames: TrieSearch<ComponentRef> = new TrieSearch<ComponentRef>("uri");
const allFunctionNames: TrieSearch<UserFunctionRef> = new TrieSearch<UserFunctionRef>("name", {
	idFieldOrFunction: (userFunction: UserFunctionRef) => {
		return userFunction.name + ":" + userFunction.componenturi.fsPath;
	},
});

const allServerVariables: VariablesByUri = new VariablesByUri();
const allApplicationVariables: VariablesByUri = new VariablesByUri();

let customSnippets: Snippets = {};
/**
 * Checks whether the given identifier is a cached global function
 * @param name The identifier to check
 * @returns
 */
export function isGlobalFunction(name: string): boolean {
	return Object.prototype.hasOwnProperty.call(allGlobalFunctions, name.toLowerCase());
}

/**
 * Checks whether the given identifier is a cached global tag
 * @param name The identifier to check
 * @returns
 */
export function isGlobalTag(name: string): boolean {
	return Object.prototype.hasOwnProperty.call(allGlobalTags, name.toLowerCase());
}

/**
 * Checks whether the given identifier is a cached global entity
 * @param name The identifier to check
 * @returns
 */
export function isGlobalEntity(name: string): boolean {
	return Object.prototype.hasOwnProperty.call(allGlobalTags, name.toLowerCase()) || Object.prototype.hasOwnProperty.call(allGlobalFunctions, name.toLowerCase());
}

/**
 * Sets the given global function object into cache
 * @param functionDefinition The global function object to cache
 */
export function setGlobalFunction(functionDefinition: GlobalFunction): void {
	allGlobalFunctions[functionDefinition.name.toLowerCase()] = functionDefinition;
}

/**
 * Retrieves the cached global function identified by the given function name
 * @param functionName The name of the global function to be retrieved
 * @returns
 */
export function getGlobalFunction(functionName: string): GlobalFunction {
	return allGlobalFunctions[functionName.toLowerCase()];
}

/**
 * Returns all of the cached global functions
 * @returns
 */
export function getAllGlobalFunctions(): GlobalFunctions {
	return allGlobalFunctions;
}

/**
 * Clears all of the cached global functions
 */
export function clearAllGlobalFunctions(): void {
	allGlobalFunctions = {};
}

/**
 * Sets the given global function object into cache
 * @param functionDefinition The global function object to cache
 */
export function setGlobalMemberFunction(functionDefinition: GlobalMemberFunction): void {
	allGlobalMemberFunctions[functionDefinition.name.toLowerCase()] = functionDefinition;
}

/**
 * Retrieves the cached global member function identified by the given function name
 * @param functionName The name of the global function to be retrieved
 * @returns
 */
export function getGlobalMemberFunction(functionName: string): GlobalMemberFunction {
	return allGlobalMemberFunctions[functionName.toLowerCase()];
}

/**
 * Returns all of the cached global member functions
 * @returns
 */
export function getAllGlobalMemberFunctions(): GlobalMemberFunctions {
	return allGlobalMemberFunctions;
}

/**
 * Clears all of the cached global functions
 */
export function clearAllGlobalMemberFunctions(): void {
	allGlobalMemberFunctions = {};
}

/**
 * Sets the given global tag object into cache
 * @param tagDefinition The global tag object to cache
 */
export function setGlobalTag(tagDefinition: GlobalTag): void {
	allGlobalTags[tagDefinition.name.toLowerCase()] = tagDefinition;
}

/**
 * Retrieves the cached global tag identified by the given tag name
 * @param tagName The name of the global tag to be retrieved
 * @returns
 */
export function getGlobalTag(tagName: string): GlobalTag {
	return allGlobalTags[tagName.toLowerCase()];
}

/**
 * Returns all of the cached global tags
 * @returns
 */
export function getAllGlobalTags(): GlobalTags {
	return allGlobalTags;
}

/**
 * Clears all of the cached global tags
 */
export function clearAllGlobalTags(): void {
	allGlobalTags = {};
}

/**
 * Sets the given global definition object into cache
 * @param definition The global definition object to cache
 */
export function setGlobalEntityDefinition(definition: CFDocsDefinitionInfo): void {
	allGlobalEntityDefinitions.set(definition.name.toLowerCase(), definition);
}

/**
 * Retrieves the cached global tag identified by the given tag name
 * @param name The name of the global definition to be retrieved
 * @returns
 */
export function getGlobalEntityDefinition(name: string): CFDocsDefinitionInfo | undefined {
	return allGlobalEntityDefinitions.get(name.toLowerCase());
}

/**
 * Returns all of the cached global entity definitions
 * @returns
 */
export function getAllGlobalEntityDefinitions(): MyMap<string, CFDocsDefinitionInfo> {
	return allGlobalEntityDefinitions;
}

/**
 * Clears all of the cached global entity definitions
 */
export function clearAllGlobalEntityDefinitions(): void {
	allGlobalEntityDefinitions = new MyMap<string, CFDocsDefinitionInfo>();
}

/**
 * Sets the given component object into cache
 * @param comp The component to cache
 */
function setComponent(comp: Component): void {
	const componentUriKey = comp.uri.toString().toLowerCase();
	allComponentsByUri[componentUriKey] = comp;
	allComponentUris[componentUriKey] = comp.uri;
	const componentNameKey: string = uriBaseName(comp.uri, COMPONENT_EXT).toLowerCase();
	if (!allComponentsByName[componentNameKey]) {
		allComponentsByName[componentNameKey] = {};
	}
	allComponentsByName[componentNameKey][componentUriKey] = comp;

	try {
		allComponentNames.add(comp);
	}
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	catch (ex) {
		// console.warn(ex);
		console.warn(`Unable to add ${componentNameKey} to allComponentNames`);
	}
}

/**
 * Retrieves the cached component identified by the given URI
 * @param uri The URI of the component to be retrieved
 * @returns
 */
export function getComponent(uri: Uri): Component | undefined {
	if (hasComponent(uri)) {
		return allComponentsByUri[uri.toString().toLowerCase()];
	}

	return undefined;
}

/**
 * Retrieves the cached component identified by the given URI
 * @param uri The URI of the component to be retrieved
 * @param _token
 * @returns
 */
export async function getComponentAsync(uri: Uri, _token: CancellationToken | undefined): Promise<Component | undefined> {
	if (hasComponent(uri)) {
		return allComponentsByUri[uri.toString().toLowerCase()];
	}

	const [, component] = await getParsedComponentFromUri(uri, _token);

	return component;
}

/**
 * Checks if the cached component with the given URI exists
 * @param uri The URI of the component to be checked
 * @param _token
 * @returns
 */

/**
 *
 * @param uri
 * @returns
 */
export function hasComponent(uri: Uri): boolean {
	return Object.prototype.hasOwnProperty.call(allComponentsByUri, uri.toString().toLowerCase());
}

/**
 * Retrieves all cached components matched by the given query
 * @param query Some query text used to search for cached components
 * @param _token
 * @returns
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function searchAllComponentNames(query: string, _token: CancellationToken | undefined): Component[] {
	const components: Component[] = [];
	allComponentNames.search(query).forEach((componentRef: ComponentRef) => {
		const componentUriKey: string = componentRef.uri.toString().toLowerCase();
		if (allComponentsByUri[componentUriKey]) {
			components.push(allComponentsByUri[componentUriKey]);
		}
	});
	return components;
}

/**
 * Sets the given user function object into cache
 * @param userFunction The user function to cache
 */
function setUserFunction(userFunction: UserFunctionRef): void {
	try {
		allFunctionNames.add(userFunction);
	}
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	catch (ex) {
		console.warn(`Unable to add ${userFunction.name} to allFunctionNames`);
	}
}

/**
 * Retrieves all cached user functions matched by the given query
 * @param query Some query text used to search for cached user functions
 * @param _searchMode How the query will be searched for
 * @returns
 */

/**
 *
 * @param query
 * @param _searchMode
 * @returns
 */
export function searchAllFunctionNames(query: string, _searchMode: SearchMode = SearchMode.StartsWith): UserFunction[] {
	const functions: UserFunction[] = [];
	let functionRefs: UserFunctionRef[] = [];
	functionRefs = allFunctionNames.search(query);
	if (_searchMode === SearchMode.EqualTo) {
		functionRefs = functionRefs.filter((funcObj: UserFunctionRef) => {
			return funcObj.name.toLowerCase() === query.toLowerCase();
		});
	}
	functionRefs.forEach((ref: UserFunctionRef) => {
		const componentUriKey = ref.componenturi.toString().toLowerCase();
		if (allComponentsByUri[componentUriKey]) {
			const component: Component = allComponentsByUri[componentUriKey];
			const functionKey: string = ref.name.toLocaleLowerCase();
			const componentFunction: UserFunction | undefined = component.functions.get(functionKey.toLocaleLowerCase());
			if (componentFunction) {
				functions.push(componentFunction);
			}
		}
	});
	return functions;
}

/**
 * Resolves a component in dot-path notation to a URI
 * @param dotPath A string for a component in dot-path notation
 * @param baseUri The URI from which the component path will be resolved
 * @param _token
 * @returns
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function cachedComponentPathToUri(dotPath: string, baseUri: Uri, _token: CancellationToken | undefined): Uri | undefined {
	if (!dotPath) {
		return undefined;
	}

	const normalizedPath: string = dotPath.replace(/(\?\.|\.|::)/g, "/") + COMPONENT_EXT;

	// relative to local directory
	const localPath: string = resolveRelativePath(baseUri, normalizedPath);
	const localFile: Uri = Uri.file(localPath);
	const localFileKey = localFile.toString().toLowerCase();
	if (allComponentUris[localFileKey]) {
		return allComponentUris[localFileKey];
	}

	// relative to web root
	const rootPath: string | undefined = resolveRootPath(baseUri, normalizedPath);
	if (rootPath) {
		const rootFile: Uri = Uri.file(rootPath);
		const rootFileKey = rootFile.toString().toLowerCase();
		if (allComponentUris[rootFileKey]) {
			return allComponentUris[rootFileKey];
		}
	}

	// custom mappings
	const customMappingPaths: string[] = resolveCustomMappingPaths(baseUri, normalizedPath);
	for (const mappedPath of customMappingPaths) {
		const mappedFile: Uri = Uri.file(mappedPath);
		const mappedFileKey = mappedFile.toString().toLowerCase();
		if (allComponentUris[mappedFileKey]) {
			return allComponentUris[mappedFileKey];
		}
	}

	return undefined;
}

/**
 * Caches given component and its contents
 * @param component The component to cache
 * @param documentStateContext Contextual information for a given document's state
 * @param _token
 */
export async function cacheComponent(component: Component, documentStateContext: DocumentStateContext, _token: CancellationToken | undefined): Promise<void> {
	clearCachedComponent(component.uri);
	setComponent(component);
	component.functions.forEach((funcObj: UserFunction) => {
		setUserFunction({
			name: funcObj.name,
			componenturi: funcObj.location.uri,
		});
	});

	if (isApplicationFile(component.uri)) {
		await cacheApplicationFromStateContext(documentStateContext, _token);
	}
	else if (isServerFile(component.uri)) {
		const thisServerVariables: Variable[] = (await parseVariableAssignments(documentStateContext, documentStateContext.docIsScript, undefined, _token)).filter((variable: Variable) => {
			return variable.scope === Scope.Server;
		});
		allServerVariables.set(component.uri.toString(), thisServerVariables);
	}
}

/**
 * Reads and parses all cfc files in the current workspace and caches their definitions
 * @param _token
 * @returns
 */
export async function cacheAllComponents(_token: CancellationToken | undefined): Promise<void> {
	setBulkCaching(true);

	clearAllCachedComponents();

	const components: Uri[] = await workspace.findFiles(COMPONENT_FILE_GLOB);

	for (const componentUri of components) {
		const componentUriKey: string = componentUri.toString().toLowerCase();
		allComponentUris[componentUriKey] = componentUri;
	}

	await cacheGivenComponents(components, _token);
	await cacheAllApplicationCfms();

	setBulkCaching(false);
}

/**
 * Reads and parses given cfc files and caches their definitions
 * @param componentUris List of URIs to read, parse, and cache
 * @param _token
 */
async function cacheGivenComponents(componentUris: Uri[], _token: CancellationToken | undefined): Promise<void> {
	await window.withProgress(
		{
			location: ProgressLocation.Notification,
			title: "Caching components",
			cancellable: true,
		},
		async (progress, token) => {
			const componentCount = componentUris.length;
			let i = 0;

			for (const componentUri of componentUris) {
				if (token.isCancellationRequested) {
					break;
				}
				if (_token && _token.isCancellationRequested) {
					break;
				}

				try {
					await cacheComponentFromUri(componentUri, _token);
				}
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				catch (ex) {
					console.warn(`Cannot parse document at ${componentUri.fsPath}`);
				}
				finally {
					i++;
					progress.report({
						message: `${i} / ${componentCount}`,
						increment: (100 / componentCount),
					});
				}
			}
		}
	);
}

/*
async function cacheGivenComponentsParallel(componentUris: Uri[], _token: CancellationToken | undefined): Promise<void> {
	await window.withProgress(
		{
			location: ProgressLocation.Notification,
			title: "Caching components",
			cancellable: true,
		},
		async (progress, token) => {
			const componentCount = componentUris.length;
			let completedCount = 0;

			const promises = componentUris.map(async (componentUri) => {
				if (token.isCancellationRequested || (_token && _token.isCancellationRequested)) {
					return; // Skip if cancellation is requested
				}

				try {
					await cacheComponentFromUri(componentUri, _token);
				}
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				catch (ex) {
					console.warn(`Cannot parse document at ${componentUri.fsPath}`);
				}
				finally {
					completedCount++;
					progress.report({
						message: `${completedCount} / ${componentCount}`,
						increment: (100 / componentCount),
					});
				}
			});

			// Wait for all promises to complete
			await Promise.all(promises);
		}
	);
}
*/

/**
 *
 * @param componentUri
 * @returns
 */
export async function getTextDocumentFromUri(componentUri: Uri): Promise<TextDocument> {
	const document: TextDocument = await LSTextDocument.openTextDocument(componentUri);
	return document;
}

/**
 *Parses given document
 * @param componentUri
 * @param _token
 * @returns
 */
export async function getParsedComponentFromUri(componentUri: Uri, _token: CancellationToken | undefined): Promise<[DocumentStateContext, Component | undefined]> {
	const document: TextDocument = await getTextDocumentFromUri(componentUri);
	return getParsedComponentFromDocument(document, _token);
}

/**
 *Parses given document
 * @param document Parses given document
 * @param _token
 * @returns
 */
export async function getParsedComponentFromDocument(document: TextDocument, _token: CancellationToken | undefined): Promise<[DocumentStateContext, Component | undefined]> {
	const cfmlCompletionSettings: WorkspaceConfiguration = workspace.getConfiguration("cfml.suggest", document.uri);
	const replaceComments = cfmlCompletionSettings.get<boolean>("replaceComments", true);

	const documentStateContext: DocumentStateContext = getDocumentStateContext(document, true, replaceComments, _token);
	const parsedComponent: Component | undefined = await parseComponent(documentStateContext, _token);
	return [documentStateContext, parsedComponent];
}

/**
 * Parses given document and caches its definitions
 * @param document The text document to parse and cache
 * @param _token cancellation token
 * @returns
 */
export async function cacheComponentFromDocument(document: TextDocument, _token: CancellationToken | undefined): Promise<void> {
	const [documentStateContext, parsedComponent]: [DocumentStateContext, Component | undefined] = await getParsedComponentFromDocument(document, _token);
	if (!parsedComponent) {
		return;
	}
	await cacheComponent(parsedComponent, documentStateContext, _token);
}

/**
 * Parses given component from uri and caches its definitions
 * @param componentUri
 * @param _token
 */
export async function cacheComponentFromUri(componentUri: Uri, _token: CancellationToken | undefined): Promise<void> {
	const [documentStateContext, parsedComponent] = await getParsedComponentFromUri(componentUri, _token);
	if (parsedComponent) {
		await cacheComponent(parsedComponent, documentStateContext, _token);
	}
}

/**
 * Removes all cached references to the given component
 * @param componentUri The URI of the component to be removed from cache
 */
export function clearCachedComponent(componentUri: Uri): void {
	const componentUriKey = componentUri.toString().toLocaleLowerCase();
	const componentByUri: Component = allComponentsByUri[componentUriKey];
	if (componentByUri) {
		delete allComponentsByUri[componentUriKey];
	}

	const componentNameKey: string = uriBaseName(componentUri, COMPONENT_EXT).toLowerCase();
	const componentsByName: ComponentsByUri = allComponentsByName[componentNameKey];
	if (componentsByName) {
		const componentsByNameLen: number = Object.keys(componentsByName).length;
		if (componentsByName[componentUriKey]) {
			const prevCompFunctions: ComponentFunctions = componentsByName[componentUriKey].functions;
			if (componentsByNameLen === 1) {
				delete allComponentsByName[componentNameKey];
			}
			else {
				delete componentsByName[componentUriKey];
			}

			if (prevCompFunctions) {
				for (const funcName of prevCompFunctions.keys()) {
					allFunctionNames.remove(funcName);
				}
			}
		}
	}
}

/**
 * Clears all cached references to components and their contents
 */
function clearAllCachedComponents(): void {
	allComponentsByUri = {};
	allComponentsByName = {};
	allComponentUris = {};
	allComponentNames.reset();
	allFunctionNames.reset();
}

/**
 * Reads and parses all Application.cfm files in the current workspace and caches their definitions
 * @returns
 */
export async function cacheAllApplicationCfms(): Promise<void> {
	const applicationUris: Uri[] = await workspace.findFiles(APPLICATION_CFM_GLOB);
	await cacheGivenApplicationCfms(applicationUris, undefined);
}

/**
 * Reads and parses given Application.cfm files and caches their definitions
 * @param applicationUris List of URIs to parse and cache
 * @param _token
 */
async function cacheGivenApplicationCfms(applicationUris: Uri[], _token: CancellationToken | undefined): Promise<void> {
	for (const applicationUri of applicationUris) {
		const document: TextDocument = await workspace.openTextDocument(applicationUri);
		await cacheApplicationFromDocument(document, _token);
	}
}

/**
 * Reads and parses given Application.cfm files and caches their definitions
 * @param document
 * @param _token
 */
export async function cacheApplicationFromDocument(document: TextDocument, _token: CancellationToken | undefined): Promise<void> {
	const documentStateContext: DocumentStateContext = getDocumentStateContext(document, true, true, _token);
	await cacheApplicationFromStateContext(documentStateContext, _token);
}

/**
 * Reads and parses given Application.cfm documentStateContext and caches their definitions
 * @param documentStateContext
 * @param _token
 */
export async function cacheApplicationFromStateContext(documentStateContext: DocumentStateContext, _token: CancellationToken | undefined): Promise<void> {
	try {
		const thisApplicationVariables: Variable[] = await parseVariableAssignments(documentStateContext, documentStateContext.docIsScript, undefined, _token);
		const thisApplicationFilteredVariables: Variable[] = thisApplicationVariables.filter((variable: Variable) => {
			return [Scope.Application, Scope.Session, Scope.Request].includes(variable.scope);
		});
		setApplicationVariables(documentStateContext.document.uri, thisApplicationFilteredVariables);
	}
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	catch (ex) {
		console.warn(`Cannot parse document at ${documentStateContext.document.uri.fsPath}`);
	}
}

/**
 * Retrieves the cached application variables identified by the given URI
 * @param uri The URI of the application file
 * @returns
 */
export function getCachedApplicationVariables(uri: Uri): Variable[] | undefined {
	return allApplicationVariables.get(uri.toString());
}

/**
 * Sets the cached application variables for the given URI
 * @param uri The URI of the application file
 * @param applicationVariables The application variables to set
 */
export function setApplicationVariables(uri: Uri, applicationVariables: Variable[]): void {
	allApplicationVariables.set(uri.toString(), applicationVariables);
}

/**
 * Removes the cached application variables identified by the given URI
 * @param uri The URI of the application file to remove
 * @returns
 */
export function removeApplicationVariables(uri: Uri): boolean {
	return allApplicationVariables.delete(uri.toString());
}

/**
 * Retrieves the cached server variables identified by the given URI
 * @param uri The URI of the component to be check
 * @returns
 */
export function getCachedServerVariables(uri: Uri): Variable[] | undefined {
	return allServerVariables.get(uri.toString());
}

/**
 * Returns all of the cached custom snippets
 * @returns
 */
export function getAllCustomSnippets(): Snippets {
	return customSnippets;
}

/**
 * Sets the given custom snippet into cache
 * @param key The snippet object key
 * @param snippet The snippet object
 */
export function setCustomSnippet(key: string, snippet: Snippet): void {
	customSnippets[key] = snippet;
}

/**
 * Clears all of the cached custom snippets
 */
export function clearAllCustomSnippets(): void {
	customSnippets = {};
}
