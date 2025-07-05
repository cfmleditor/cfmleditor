import { FileStat, FileType, Uri, workspace, WorkspaceFolder } from "vscode";
import { Utils } from "vscode-uri";
import { getComponentAsync } from "../features/cachedEntities";
import { Component, getComponentFunction } from "../entities/component";
import { UserFunction } from "../entities/userFunction";

export interface CFMLMapping {
	logicalPath: string;
	directoryPath: string;
	isPhysicalDirectoryPath?: boolean;
	webrootPath?: string;
	controllerPath?: string;
}

/**
 *
 * @param srcPath file path
 * @returns Promise
 */
export async function getDirectories(srcPath: string): Promise<[string, FileType][]> {
	const files: [string, FileType][] = await workspace.fs.readDirectory(Uri.parse(srcPath));
	return filterDirectories(files);
}

/**
 * Takes an array of files and filters them to only the directories
 * @param files A list of files to filter
 * @returns array
 */
export function filterDirectories(files: [string, FileType][]): [string, FileType][] {
	return files.filter((file: [string, FileType]) => {
		if (file[1] === FileType.Directory) {
			return true;
		}
		else {
			return false;
		}
	});
}

/**
 *
 * @param srcPath file path
 * @returns Promise
 */
export async function getComponents(srcPath: string): Promise<[string, FileType][]> {
	const files: [string, FileType][] = await workspace.fs.readDirectory(Uri.parse(srcPath));
	return filterComponents(files);
}

/**
 * Takes an array of files and filters them to only the components
 * @param files A list of files to filter
 * @returns array
 */
export function filterComponents(files: [string, FileType][]): [string, FileType][] {
	return files.filter((file: [string, FileType]) => {
		if (file[1] === FileType.File && /\.cfc$/gi.test(file[0])) {
			return true;
		}
		else {
			return false;
		}
	});
}

/**
 *
 * @param path file path
 * @param ext
 * @returns string
 */
export function resolveBaseName(path: string, ext?: string): string {
	let base = Utils.basename(Uri.parse(path));
	if (ext) {
		base = base.replace(ext, "");
	}
	return base;
}

/**
 *
 * @param path file path
 * @param ext
 * @returns string
 */
export function uriBaseName(path: Uri, ext?: string): string {
	let base = Utils.basename(path);
	if (ext) {
		base = base.replace(ext, "");
	}
	return base;
}

/**
 *
 * @param path file path
 * @returns Promise
 */
export async function fileExists(path: string): Promise<boolean> {
	try {
		await workspace.fs.stat(Uri.file(path));
		return true;
	}
	catch {
		return false;
	}
}

/**
 *
 * @param uri path uri
 * @returns true if the uri is a FileType.Directory and false if it is not, also returns false if the uri cannot be resolved
 */
export async function isDirectory(uri: Uri): Promise<boolean> {
	try {
		const stat: FileStat = await workspace.fs.stat(uri);
		return stat.type === FileType.Directory;
	}
	catch {
		return false;
	}
}

/**
 *
 * @param uri path uri
 * @returns true if the uri is a FileType.File and false if it is not, also returns false if the uri cannot be resolved
 */
export async function isFile(uri: Uri): Promise<boolean> {
	try {
		const stat: FileStat = await workspace.fs.stat(uri);
		return stat.type === FileType.File;
	}
	catch {
		return false;
	}
}

/**
 * Resolves a dot path to a list of file paths
 * @param dotPath A string for a component in dot-path notation
 * @param baseUri The URI from which the component path will be resolved
 * @returns Promise
 */
export async function resolveDottedPaths(dotPath: string, baseUri: Uri): Promise<string[]> {
	const paths: string[] = [];

	const normalizedPath: string = dotPath.replace(/(\?\.|\.|::)/g, "/");

	// TODO: Check imports

	// relative to local directory
	const localPath: string = resolveRelativePath(baseUri, normalizedPath);
	if (await fileExists(localPath)) {
		paths.push(localPath);

		if (normalizedPath.length > 0) {
			return paths;
		}
	}

	// relative to web root
	const rootPath: string | undefined = resolveRootPath(baseUri, normalizedPath);
	if (rootPath && await fileExists(rootPath)) {
		paths.push(rootPath);

		if (normalizedPath.length > 0) {
			return paths;
		}
	}

	// custom mappings
	const customMappingPaths: string[] = resolveCustomMappingPaths(baseUri, normalizedPath);
	for (const mappedPath of customMappingPaths) {
		if (await fileExists(mappedPath)) {
			paths.push(mappedPath);

			if (normalizedPath.length > 0) {
				return paths;
			}
		}
	}

	return paths;
}

/**
 * Resolves a full path relative to the given URI
 * @param baseUri The URI from which the relative path will be resolved
 * @param appendingPath A path appended to the given URI
 * @returns string
 */
export function resolveRelativePath(baseUri: Uri, appendingPath: string): string {
	return Uri.joinPath(Utils.dirname(baseUri), appendingPath).fsPath;
}

/**
 * Resolves a full path relative to the root of the given URI, or undefined if not in workspace
 * @param baseUri The URI from which the root path will be resolved
 * @param appendingPath A path appended to the resolved root path
 * @returns string
 */
export function resolveRootPath(baseUri: Uri | undefined, appendingPath: string): string | undefined {
	const root: WorkspaceFolder | undefined = baseUri ? workspace.getWorkspaceFolder(baseUri) : undefined;

	// When baseUri is not in workspace
	if (!root) {
		return undefined;
	}

	// Include the webroot (relative to the workspace root)
	// Used when the application is served from a subdirectory ("public", "www", "src", etc...)
	const webroot = workspace.getConfiguration("cfml", baseUri).get<string>("webroot", "");

	return Uri.joinPath(root.uri, webroot, appendingPath).fsPath;
}

/**
 * Resolves a full path based on mappings
 * @param baseUri The URI from which the root path will be resolved
 * @param appendingPath A path appended to the resolved path
 * @returns array
 */
export function resolveCustomMappingPaths(baseUri: Uri | undefined, appendingPath: string): string[] {
	const customMappingPaths: string[] = [];

	const cfmlMappings: CFMLMapping[] = workspace.getConfiguration("cfml", baseUri).get<CFMLMapping[]>("mappings", []);
	const normalizedPath: string = appendingPath.replace(/\\/g, "/");
	for (const cfmlMapping of cfmlMappings) {
		const slicedLogicalPath: string = cfmlMapping.logicalPath.slice(1);
		const logicalPathStartPattern = new RegExp(`^${slicedLogicalPath}(?:/|$)`);
		if (!logicalPathStartPattern.test(normalizedPath)) {
			continue;
		}
		const directoryPath = resolveDirectoryPath(baseUri, cfmlMapping);
		if (!directoryPath) {
			continue;
		}
		const mappedPath: string = Uri.joinPath(Uri.parse(directoryPath), appendingPath.slice(slicedLogicalPath.length)).fsPath;
		customMappingPaths.push(mappedPath);
	}

	return customMappingPaths;
}

/**
 * Resolves the directory path for a CFML mapping.
 * @param baseUri
 * @param cfmlMapping
 * @returns
 */
function resolveDirectoryPath(baseUri: Uri | undefined, cfmlMapping: CFMLMapping): string | undefined {
	return cfmlMapping.isPhysicalDirectoryPath === undefined || cfmlMapping.isPhysicalDirectoryPath
		? cfmlMapping.directoryPath
		: resolveRootPath(baseUri, cfmlMapping.directoryPath);
}

/**
 * Resolves a full path based on mappings
 * @param baseUri The URI from which the root path will be resolved
 * @param route
 * @returns array
 */
export async function resolveRouteTemplatePath(baseUri: Uri | undefined, route: string): Promise<string[]> {
	const templatePaths: string[] = [];

	const cfmlMappings: CFMLMapping[] = workspace.getConfiguration("cfml", baseUri).get<CFMLMapping[]>("mappings", []);
	const normalizedPath: string = route.replace(/\./g, "/");

	for (const cfmlMapping of cfmlMappings) {
		const slicedLogicalPath: string = cfmlMapping.logicalPath.slice(1);

		const logicalPathStartPattern = new RegExp(`^${slicedLogicalPath}(?:/|$)`);

		if (!logicalPathStartPattern.test(normalizedPath)) {
			continue;
		}

		const directoryPath = resolveDirectoryPath(baseUri, cfmlMapping);

		if (!directoryPath) {
			continue;
		}

		const templatePath = await resolveTemplatePath(directoryPath, slicedLogicalPath, normalizedPath, cfmlMapping.webrootPath);
		if (templatePath && await fileExists(templatePath)) {
			templatePaths.push(templatePath);
		}
	}

	return templatePaths;
}

/**
 * Resolves a full path based on mappings
 * @param baseUri The URI from which the root path will be resolved
 * @param route
 * @returns array
 */
export async function resolveRouteControllerPath(baseUri: Uri | undefined, route: string): Promise<[Uri | undefined, UserFunction | undefined]> {
	const cfmlMappings: CFMLMapping[] = workspace.getConfiguration("cfml", baseUri).get<CFMLMapping[]>("mappings", []);
	const normalizedPath: string = route.replace(/\\/g, "/");

	for (const cfmlMapping of cfmlMappings) {
		if (!cfmlMapping.controllerPath) {
			continue;
		}

		const directoryPath = resolveDirectoryPath(baseUri, cfmlMapping);

		if (!directoryPath) {
			continue;
		}

		const [controllerPath, userFunction] = await resolveControllerPath(directoryPath, normalizedPath, cfmlMapping.controllerPath);

		if (controllerPath && userFunction) {
			return [controllerPath, userFunction];
		}
	}

	return [undefined, undefined];
}

/**
 * Resolves the mapped path by traversing directories and handling special cases.
 * @param directoryPath
 * @param slicedLogicalPath
 * @param normalizedPath
 * @param webrootPath
 * @returns
 */
async function resolveTemplatePath(
	directoryPath: string,
	slicedLogicalPath: string,
	normalizedPath: string,
	webrootPath: string | undefined
): Promise<string | undefined> {
	let pathUri: Uri = Uri.parse(directoryPath);
	const splitPath: string[] = normalizedPath.slice(slicedLogicalPath.length).split("/");
	const filePath: string[] = [];

	if (webrootPath) {
		pathUri = Uri.joinPath(pathUri, webrootPath);
	}

	for (const path of splitPath) {
		if (!path) {
			continue;
		}
		const tmpPath = Uri.joinPath(pathUri, path);
		if (await isDirectory(tmpPath)) {
			pathUri = tmpPath;
		}
		else {
			filePath.push(path);
		}
	}

	filePath.push("cfm");

	return Uri.joinPath(pathUri, filePath.join(".")).fsPath;
}

/**
 * Resolves the mapped path by traversing directories and handling special cases.
 * @param directoryPath
 * @param route
 * @param controllerPath
 * @returns
 */
async function resolveControllerPath(
	directoryPath: string,
	route: string,
	controllerPath: string | undefined
): Promise<[Uri | undefined, UserFunction | undefined]> {
	const directoryUri = Uri.parse(directoryPath);
	const pathUri: Uri = controllerPath ? Uri.joinPath(directoryUri, controllerPath.replace(/\\/gi, "/")) : directoryUri;
	const segments: string[] = route.split(".");

	/*
	routes should lookup paths from right to left using "." as delimeters from right to left

	Attempt to resolve paths and functions in this order where # is the function name within each of the controller .cfc files
	1. controller.module.submodule.function should look for controller-module-submodule.cfc#function()
	2. controller.module.submodule.function should look for controller-module.cfc#submodulefunction()
	3. controller.module.submodule.function should look for controller.cfc#modulesubmodulefunction()
	*/

	for (let i = segments.length; i > 0; i--) {
		const currentSegments = segments.slice(0, i);
		const controllerFileName = currentSegments.join("-") + ".cfc";
		const controllerFilePath = Uri.joinPath(pathUri, controllerFileName);
		if (await isFile(controllerFilePath)) {
			const component: Component | undefined = await getComponentAsync(controllerFilePath, undefined);
			if (component) {
				const remainingSegments = segments.slice(i); // Segments after the current index
				const controllerFunction: string = remainingSegments.join("");
				const userFunction: UserFunction | undefined = getComponentFunction(component, controllerFunction);
				if (userFunction) {
					return [controllerFilePath, userFunction];
				}
			}
		}
	}
	return [undefined, undefined];
}

/**
 *
 * @param name
 * @param workingDir
 * @returns Uri | undefined
 */
export async function findUpWorkspaceFile(name: string, workingDir: Uri): Promise<Uri | undefined> {
	let directory: Uri = Utils.dirname(workingDir);
	let count: number = 0;
	const workspaceDir: WorkspaceFolder | undefined = workspace.getWorkspaceFolder(workingDir);
	const removePathEnding: RegExp = /[\\/]$/gi;

	while (directory) {
		const filePath: Uri = Uri.joinPath(directory, name);
		count++;

		if (await isFile(filePath)) {
			return filePath;
		}
		// Stop at the workspace folder
		if (!workspaceDir || count > 20 || directory.fsPath.replace(removePathEnding, "") === workspaceDir.uri.fsPath.replace(removePathEnding, "")) {
			break;
		}

		directory = Utils.joinPath(directory, "../");
	}

	return undefined;
}
