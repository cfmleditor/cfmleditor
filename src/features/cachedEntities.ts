
import { CancellationToken, ConfigurationTarget, extensions, ProgressLocation, TextDocument, Uri, window, workspace, WorkspaceConfiguration } from "vscode";
import { Component, ComponentsByName, ComponentsByUri, COMPONENT_EXT, COMPONENT_FILE_GLOB, parseComponent } from "../entities/component";
import { GlobalFunction, GlobalFunctions, GlobalMemberFunction, GlobalMemberFunctions, GlobalTag, GlobalTags } from "../entities/globals";
import { Scope } from "../entities/scope";
import { ComponentFunctions, UserFunction, UserFunctionByUri, UserFunctionsByName } from "../entities/userFunction";
import { parseVariableAssignments, Variable, VariablesByUri } from "../entities/variable";
import { CFDocsDefinitionInfo } from "../utils/cfdocs/definitionInfo";
import { MyMap, SearchMode } from "../utils/collections";
import { APPLICATION_CFM_GLOB } from "../utils/contextUtil";
import { DocumentStateContext, getDocumentStateContext } from "../utils/documentUtil";
import { resolveCustomMappingPaths, resolveRelativePath, resolveRootPath } from "../utils/fileUtil";
import trie from "trie-prefix-tree";
import { Snippet, Snippets } from "../entities/snippet";
import { Utils } from "vscode-uri";

let allGlobalEntityDefinitions = new MyMap<string, CFDocsDefinitionInfo>();

let allGlobalFunctions: GlobalFunctions = {};
let allGlobalMemberFunctions: GlobalMemberFunctions = {};
let allGlobalTags: GlobalTags = {};
// let allMemberFunctions: MemberFunctionsByType = new MyMap<DataType, Set<MemberFunction>>();

let allComponentsByUri: ComponentsByUri = {};
let allComponentsByName: ComponentsByName = {};

// let allUserFunctionsByUri: UserFunctionsByUri = {};
let allUserFunctionsByName: UserFunctionsByName = {};

let allComponentNames = trie([]);
let allFunctionNames = trie([]);

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
  const componentKey: string = Utils.basename(comp.uri).toLowerCase();
  if (!allComponentsByName[componentKey]) {
    allComponentsByName[componentKey] = {};
  }
  allComponentsByName[componentKey][comp.uri.toString()] = comp;

  try {
    allComponentNames.addWord(componentKey);
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
export function getComponent(uri: Uri, _token: CancellationToken): Component {
  if (!hasComponent(uri, _token)) {
    /* TODO: If not already cached, attempt to read, parse and cache. Tricky since read is async */
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
  allComponentNames.getPrefix(query.toLowerCase()).forEach((compKey: string) => {
    components = components.concat(Object.values(allComponentsByName[compKey]));
  });
  return components;
}

/**
 * Sets the given user function object into cache
 * @param userFunction The user function to cache
 */
function setUserFunction(userFunction: UserFunction): void {
  const functionKey: string = userFunction.name.toLowerCase();

  if (!allUserFunctionsByName[functionKey]) {
    allUserFunctionsByName[functionKey] = {};
  }
  allUserFunctionsByName[functionKey][userFunction.location.uri.toString()] = userFunction;

  try {
    allFunctionNames.addWord(functionKey);
  } catch (ex) {
    console.warn(`Unable to add ${functionKey} to trie`);
  }
}

/**
 * Retrieves all cached user functions matched by the given query
 * @param query Some query text used to search for cached user functions
 * @param searchMode How the query will be searched for
 * @returns
 */
export function searchAllFunctionNames(query: string, searchMode: SearchMode = SearchMode.StartsWith): UserFunction[] {
  let functions: UserFunction[] = [];
  const lowerQuery = query.toLowerCase();

  if (searchMode === SearchMode.StartsWith) {
    allFunctionNames.getPrefix(lowerQuery).forEach((funcKey: string) => {
      functions = functions.concat(Object.values(allUserFunctionsByName[funcKey]));
    });
  } else if (searchMode === SearchMode.Contains) {
    for (const name in allUserFunctionsByName) {
      if (name.includes(lowerQuery)) {
        functions = functions.concat(Object.values(allUserFunctionsByName[name]));
      }
    }
  } else if (searchMode === SearchMode.EqualTo) {
    if (Object.prototype.hasOwnProperty.call(allUserFunctionsByName, lowerQuery)) {
      functions = Object.values(allUserFunctionsByName[lowerQuery]);
    }
  }

  return functions;
}

/**
 * Resolves a component in dot-path notation to a URI
 * @param dotPath A string for a component in dot-path notation
 * @param baseUri The URI from which the component path will be resolved
 * @returns
 */
export function componentPathToUri(dotPath: string, baseUri: Uri): Uri | undefined {
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
  const fileName: string = Utils.basename(componentUri);
  if (fileName === "Application.cfc") {
    const thisApplicationVariables: Variable[] = await parseVariableAssignments(documentStateContext, documentStateContext.docIsScript, null, _token);

    const thisApplicationFilteredVariables: Variable[] = thisApplicationVariables.filter((variable: Variable) => {
      return [Scope.Application, Scope.Session, Scope.Request].includes(variable.scope);
    });
    setApplicationVariables(componentUri, thisApplicationFilteredVariables);
  } else if (fileName === "Server.cfc") {
    const thisServerVariables: Variable[] = (await parseVariableAssignments(documentStateContext, documentStateContext.docIsScript, null, _token)).filter((variable: Variable) => {
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
    clearAllCachedComponents();

    return workspace.findFiles(COMPONENT_FILE_GLOB).then(
        async (componentUris: Uri[]) => {
            // TODO: Remove cflint setting update for workspace state when CFLint checks it. Remove workspace state when CFLint can get list of open editors.
            let cflintExt = extensions.getExtension("cfmleditor.cfmleditor-lint");
            if (!cflintExt) {
                cflintExt = extensions.getExtension("KamasamaK.vscode-cflint");
            }
            if (cflintExt) {
                const cflintSettings: WorkspaceConfiguration = workspace.getConfiguration("cflint", null);
                const runModes: object = cflintSettings.get<object>("runModes");
                if (runModes && Object.prototype.hasOwnProperty.call(runModes, "onOpen") && runModes["onOpen"]) {
                    const cflintEnabledValues = cflintSettings.inspect<boolean>("enabled");
                    const cflintEnabledPrevWSValue: boolean = cflintEnabledValues.workspaceValue;
                    cflintSettings.update("enabled", false, ConfigurationTarget.Workspace).then(async () => {
                        await cacheGivenComponents(componentUris, _token);
                        await cacheAllApplicationCfms();
                        cflintSettings.update("enabled", cflintEnabledPrevWSValue, ConfigurationTarget.Workspace);
                    });
                } else {
                    cacheGivenComponents(componentUris, _token);
                    cacheAllApplicationCfms();
                }
            } else {
                cacheGivenComponents(componentUris, _token);
                cacheAllApplicationCfms();
            }
        },
        (reason) => {
            console.warn(reason);
        }
    );
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
          const document: TextDocument = await workspace.openTextDocument(componentUri);
          const cfmlCompletionSettings: WorkspaceConfiguration = workspace.getConfiguration("cfml.suggest", document.uri);
          const replaceComments = cfmlCompletionSettings.get<boolean>("replaceComments", true);
          cacheComponentFromDocument(document, false, replaceComments, _token);
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
  const documentStateContext: DocumentStateContext = getDocumentStateContext(document, fast, replaceComments, _token);
  try {
    const parsedComponent: Component | undefined = await parseComponent(documentStateContext, _token);
    if (!parsedComponent) {
        return false;
    }
    cacheComponent(parsedComponent, documentStateContext, _token);
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

  const componentKey: string = Utils.basename(componentUri).toLowerCase();
  const componentsByName: ComponentsByUri = allComponentsByName[componentKey];
  if (componentsByName) {
    const componentsByNameLen: number = Object.keys(componentsByName).length;
    if (componentsByName[componentUri.toString()]) {
      const prevCompFunctions: ComponentFunctions = componentsByName[componentUri.toString()].functions;
      if (componentsByNameLen === 1) {
        delete allComponentsByName[componentKey];
        allComponentNames.removeWord(componentKey);
      } else {
        delete componentsByName[componentUri.toString()];
      }

      if (prevCompFunctions) {
        for (const funcName of prevCompFunctions.keys()) {
          const userFunctions: UserFunctionByUri = allUserFunctionsByName[funcName];
          if (userFunctions) {
            const userFunctionsLen: number = Object.keys(userFunctions).length;

            if (userFunctions[componentUri.toString()]) {
              if (userFunctionsLen === 1) {
                delete allUserFunctionsByName[funcName];
                allFunctionNames.removeWord(funcName);
              } else {
                delete userFunctions[componentUri.toString()];
              }
            }
          }
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
  allComponentNames = trie([]);

  allUserFunctionsByName = {};
  allFunctionNames = trie([]);
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
      const documentStateContext: DocumentStateContext = getDocumentStateContext(document, false, replaceComments, _token);
      const thisApplicationVariables: Variable[] = await parseVariableAssignments(documentStateContext, documentStateContext.docIsScript, null, _token);
      const thisApplicationFilteredVariables: Variable[] = thisApplicationVariables.filter((variable: Variable) => {
        return [Scope.Application, Scope.Session, Scope.Request].includes(variable.scope);
      });
      setApplicationVariables(applicationUri, thisApplicationFilteredVariables);
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