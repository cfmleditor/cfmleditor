
import { CancellationToken, ProgressLocation, TextDocument, Uri, window, workspace, WorkspaceConfiguration } from "vscode";
import { LSTextDocument } from "../utils/LSTextDocument";
import { Component, ComponentsByName, ComponentsByUri, COMPONENT_EXT, COMPONENT_FILE_GLOB, parseComponent } from "../entities/component";
import { GlobalFunction, GlobalFunctions, GlobalMemberFunction, GlobalMemberFunctions, GlobalTag, GlobalTags } from "../entities/globals";
import { Scope } from "../entities/scope";
import { ComponentFunctions, UserFunction } from "../entities/userFunction";
import { parseVariableAssignments, Variable, VariablesByUri } from "../entities/variable";
import { CFDocsDefinitionInfo } from "../utils/cfdocs/definitionInfo";
import { MyMap, SearchMode } from "../utils/collections";
import { APPLICATION_CFM_GLOB } from "../utils/contextUtil";
import { DocumentStateContext, getDocumentStateContext } from "../utils/documentUtil";
import { resolveCustomMappingPaths, resolveRelativePath, resolveRootPath, uriBaseName } from "../utils/fileUtil";
import TrieSearch from 'trie-search';
import { Snippet, Snippets } from "../entities/snippet";
import { setBulkCaching } from "../cfmlMain";

let allGlobalEntityDefinitions = new MyMap<string, CFDocsDefinitionInfo>();

let allGlobalFunctions: GlobalFunctions = {};
let allGlobalMemberFunctions: GlobalMemberFunctions = {};
let allGlobalTags: GlobalTags = {};
// let allMemberFunctions: MemberFunctionsByType = new MyMap<DataType, Set<MemberFunction>>();

let allComponentsByUri: ComponentsByUri = {};
let allComponentsByName: ComponentsByName = {};

const allComponentNames : TrieSearch<Component> = new TrieSearch<Component>('uri');
const allFunctionNames : TrieSearch<UserFunction> = new TrieSearch<UserFunction>('name');

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
export function getGlobalEntityDefinition(name: string): CFDocsDefinitionInfo {
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
    allComponentsByUri[comp.uri.toString()] = comp;
    const componentKey: string = uriBaseName(comp.uri, COMPONENT_EXT).toLowerCase();
    if (!allComponentsByName[componentKey]) {
        allComponentsByName[componentKey] = {};
    }
    allComponentsByName[componentKey][comp.uri.toString()] = comp;

    try {
        allComponentNames.add(comp);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (ex) {
        //console.warn(ex);
        console.warn(`Unable to add ${componentKey} to trie`);
    }
}

/**
 * Retrieves the cached component identified by the given URI
 * @param uri The URI of the component to be retrieved
 * @param _token
 * @returns
 */
export async function getComponent(uri: Uri, _token: CancellationToken): Promise<Component> {
    if (!hasComponent(uri, _token)) {
        /* TODO: If not already cached, attempt to read, parse and cache. Tricky since read is async */
        return undefined;
    }

    return allComponentsByUri[uri.toString()];
}

/**
 * Checks if the cached component with the given URI exists
 * @param uri The URI of the component to be checked
 * @param _token
 * @returns
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function hasComponent(uri: Uri, _token: CancellationToken): boolean {
    return Object.prototype.hasOwnProperty.call(allComponentsByUri, uri.toString());
}

/**
 * Retrieves all cached components matched by the given query
 * @param query Some query text used to search for cached components
 * @param _token
 * @returns
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function searchAllComponentNames(query: string, _token: CancellationToken): Component[] {
    let components: Component[] = [];
    components = allComponentNames.search(query);
    return components;
}

/**
 * Sets the given user function object into cache
 * @param userFunction The user function to cache
 */
function setUserFunction(userFunction: UserFunction): void {
    try {
        allFunctionNames.add(userFunction);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (ex) {
        console.warn(`Unable to add ${userFunction.name} to trie`);
    }
}

/**
 * Retrieves all cached user functions matched by the given query
 * @param query Some query text used to search for cached user functions
 * @param _searchMode How the query will be searched for
 * @returns
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function searchAllFunctionNames(query: string, _searchMode: SearchMode = SearchMode.StartsWith): UserFunction[] {
    let functions: UserFunction[] = [];
    functions = allFunctionNames.search(query)
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
export function cachedComponentPathToUri(dotPath: string, baseUri: Uri, _token: CancellationToken): Uri | undefined {
    if (!dotPath) {
        return undefined;
    }

    const normalizedPath: string = dotPath.replace(/\./g, "/") + COMPONENT_EXT;

    // relative to local directory
    const localPath: string = resolveRelativePath(baseUri, normalizedPath);
    const localFile: Uri = Uri.file(localPath);
    if (allComponentsByUri[localFile.toString()]) {
        return localFile;
    }

    // relative to web root
    const rootPath: string = resolveRootPath(baseUri, normalizedPath);
    if (rootPath) {
        const rootFile: Uri = Uri.file(rootPath);
        if (allComponentsByUri[rootFile.toString()]) {
            return rootFile;
        }
    }

    // custom mappings
    const customMappingPaths: string[] = resolveCustomMappingPaths(baseUri, normalizedPath);
    for (const mappedPath of customMappingPaths) {
        const mappedFile: Uri = Uri.file(mappedPath);
        if (allComponentsByUri[mappedFile.toString()]) {
            return mappedFile;
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
export async function cacheComponent(component: Component, documentStateContext: DocumentStateContext, _token: CancellationToken): Promise<void> {
    clearCachedComponent(component.uri);
    setComponent(component);
    component.functions.forEach((funcObj: UserFunction) => {
        setUserFunction(funcObj);
    });

    const componentUri: Uri = component.uri;
    const fileName: string = uriBaseName(componentUri);
    if (fileName === "Application.cfc") {
        const thisApplicationVariables: Variable[] = await parseVariableAssignments(documentStateContext, documentStateContext.docIsScript, undefined, _token);

        const thisApplicationFilteredVariables: Variable[] = thisApplicationVariables.filter((variable: Variable) => {
            return [Scope.Application, Scope.Session, Scope.Request].includes(variable.scope);
        });
        setApplicationVariables(componentUri, thisApplicationFilteredVariables);
    } else if (fileName === "Server.cfc") {
        const thisServerVariables: Variable[] = (await parseVariableAssignments(documentStateContext, documentStateContext.docIsScript, undefined, _token)).filter((variable: Variable) => {
            return variable.scope === Scope.Server;
        });
        allServerVariables.set(componentUri.toString(), thisServerVariables);
    }
}

/**
 * Reads and parses all cfc files in the current workspace and caches their definitions
 * @param _token
 * @returns
 */
export async function cacheAllComponents(_token: CancellationToken): Promise<void> {

    setBulkCaching(true);

    clearAllCachedComponents();

    const components: Uri[] = await workspace.findFiles(COMPONENT_FILE_GLOB);

    await cacheGivenComponents(components, _token);
    await cacheAllApplicationCfms();

    setBulkCaching(false);

}

/**
 * Reads and parses given cfc files and caches their definitions
 * @param componentUris List of URIs to read, parse, and cache
 * @param _token
 */
async function cacheGivenComponents(componentUris: Uri[], _token: CancellationToken): Promise<void> {
    await window.withProgress(
        {
            location: ProgressLocation.Notification,
            title: "Caching components",
            cancellable: true
        },
        async (progress, token) => {
            const componentCount = componentUris.length;
            let i = 0;

            for (const componentUri of componentUris) {
                if (token.isCancellationRequested) { break; }

                try {
                    const document: TextDocument = await LSTextDocument.openTextDocument(componentUri);
                    const cfmlCompletionSettings: WorkspaceConfiguration = workspace.getConfiguration("cfml.suggest", document.uri);
                    const replaceComments = cfmlCompletionSettings.get<boolean>("replaceComments", true);
                    await cacheComponentFromDocument(document, false, replaceComments, _token);
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                } catch (ex) {
                    console.warn(`Cannot parse document at ${componentUri}`);
                } finally {
                    i++;
                    progress.report({
                        message: `${i} / ${componentCount}`,
                        increment: (100 / componentCount)
                    });
                }
            }
        }
    );
}

/**
 * Parses given document and caches its definitions
 * @param document The text document to parse and cache
 * @param fast Whether to use the faster, but less accurate parsing
 * @param replaceComments
 * @param _token
 * @returns
 */
export async function cacheComponentFromDocument(document: TextDocument, fast: boolean = false, replaceComments: boolean = false, _token: CancellationToken): Promise<boolean> {
    const documentStateContext: DocumentStateContext = await getDocumentStateContext(document, fast, replaceComments, _token);
    try {
        const parsedComponent: Component | undefined = await parseComponent(documentStateContext, _token);
        if (!parsedComponent) {
            return false;
        }
        await cacheComponent(parsedComponent, documentStateContext, _token);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (err) {
        return false;
    }
    return true;
}

/**
 * Removes all cached references to the given component
 * @param componentUri The URI of the component to be removed from cache
 */
export function clearCachedComponent(componentUri: Uri): void {
    const componentByUri: Component = allComponentsByUri[componentUri.toString()];
    if (componentByUri) {
        delete allComponentsByUri[componentUri.toString()];
    }

    const componentKey: string = uriBaseName(componentUri).toLowerCase();
    const componentsByName: ComponentsByUri = allComponentsByName[componentKey];
    if (componentsByName) {
        const componentsByNameLen: number = Object.keys(componentsByName).length;
        if (componentsByName[componentUri.toString()]) {
            const prevCompFunctions: ComponentFunctions = componentsByName[componentUri.toString()].functions;
            if (componentsByNameLen === 1) {
                delete allComponentsByName[componentKey];
                allComponentNames.remove(componentKey);
            } else {
                delete componentsByName[componentUri.toString()];
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
    allComponentNames.reset();
    allFunctionNames.reset();
}

/**
 * Reads and parses all Application.cfm files in the current workspace and caches their definitions
 * @returns
 */
export async function cacheAllApplicationCfms(): Promise<void> {
    return workspace.findFiles(APPLICATION_CFM_GLOB).then(
        cacheGivenApplicationCfms,
        (reason) => {
            console.warn(reason);
        }
    );
}

/**
 * Reads and parses given Application.cfm files and caches their definitions
 * @param applicationUris List of URIs to parse and cache
 * @param _token
 */
async function cacheGivenApplicationCfms(applicationUris: Uri[], _token?: CancellationToken): Promise<void> {
    for (const applicationUri of applicationUris) {
        try {
            const document: TextDocument = await workspace.openTextDocument(applicationUri);
            const cfmlCompletionSettings: WorkspaceConfiguration = workspace.getConfiguration("cfml.suggest", document.uri);
            const replaceComments = cfmlCompletionSettings.get<boolean>("replaceComments", true);
            const documentStateContext: DocumentStateContext = await getDocumentStateContext(document, false, replaceComments, _token);
            const thisApplicationVariables: Variable[] = await parseVariableAssignments(documentStateContext, documentStateContext.docIsScript, undefined, _token);
            const thisApplicationFilteredVariables: Variable[] = thisApplicationVariables.filter((variable: Variable) => {
                return [Scope.Application, Scope.Session, Scope.Request].includes(variable.scope);
            });
            setApplicationVariables(applicationUri, thisApplicationFilteredVariables);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (ex) {
            console.warn(`Cannot parse document at ${applicationUri}`);
        }
    }
}

/**
 * Retrieves the cached application variables identified by the given URI
 * @param uri The URI of the application file
 * @returns
 */
export function getApplicationVariables(uri: Uri): Variable[] {
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
export function getServerVariables(uri: Uri): Variable[] {
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