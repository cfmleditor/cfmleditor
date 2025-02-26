import { FileStat, FileType, Uri, workspace, WorkspaceFolder } from "vscode";
import { Utils } from "vscode-uri";

export interface CFMLMapping {
	logicalPath: string;
	directoryPath: string;
	isPhysicalDirectoryPath?: boolean;
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
 * @param path file path
 * @returns Promise
 */
export async function uriExists(path: Uri): Promise<boolean> {
	try {
		await workspace.fs.stat(path);
		return true;
	}
	catch {
		return false;
	}
}

/**
 *
 * @param path file path
 * @returns Promise
 */
export async function uriStat(path: Uri): Promise<FileStat> {
	return await workspace.fs.stat(path);
}

/**
 * Resolves a dot path to a list of file paths
 * @param dotPath A string for a component in dot-path notation
 * @param baseUri The URI from which the component path will be resolved
 * @returns Promise
 */
export async function resolveDottedPaths(dotPath: string, baseUri: Uri): Promise<string[]> {
	const paths: string[] = [];

	const normalizedPath: string = dotPath.replace(/\./g, "/");

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
	const rootPath: string = resolveRootPath(baseUri, normalizedPath);
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
export function resolveRootPath(baseUri: Uri, appendingPath: string): string | undefined {
	const root: WorkspaceFolder = workspace.getWorkspaceFolder(baseUri);

	// When baseUri is not in workspace
	if (!root) {
		return undefined;
	}

	return Uri.joinPath(root.uri, appendingPath).fsPath;
}

/**
 * Resolves a full path based on mappings
 * @param baseUri The URI from which the root path will be resolved
 * @param appendingPath A path appended to the resolved path
 * @returns array
 */
export function resolveCustomMappingPaths(baseUri: Uri, appendingPath: string): string[] {
	const customMappingPaths: string[] = [];

	const cfmlMappings: CFMLMapping[] = workspace.getConfiguration("cfml", baseUri).get<CFMLMapping[]>("mappings", []);
	const normalizedPath: string = appendingPath.replace(/\\/g, "/");
	for (const cfmlMapping of cfmlMappings) {
		const slicedLogicalPath: string = cfmlMapping.logicalPath.slice(1);
		const logicalPathStartPattern = new RegExp(`^${slicedLogicalPath}(?:/|$)`);
		if (logicalPathStartPattern.test(normalizedPath)) {
			const directoryPath: string = cfmlMapping.isPhysicalDirectoryPath === undefined || cfmlMapping.isPhysicalDirectoryPath ? cfmlMapping.directoryPath : resolveRootPath(baseUri, cfmlMapping.directoryPath);
			const mappedPath: string = Uri.joinPath(Uri.parse(directoryPath), appendingPath.slice(slicedLogicalPath.length)).fsPath;
			customMappingPaths.push(mappedPath);
		}
	}

	return customMappingPaths;
}

/**
 *
 * @param name
 * @param workingDir
 * @returns Uri | undefined
 */
export async function findUpWorkspaceFile(name: string, workingDir: Uri): Promise<Uri | undefined> {
	let directory: Uri = Utils.dirname(workingDir);
	const workspaceDir: WorkspaceFolder = workspace.getWorkspaceFolder(workingDir);

	while (directory) {
		const filePath: Uri = Uri.joinPath(directory, name);

		try {
			const stats: FileStat = await workspace.fs.stat(filePath);
			if (stats.type === FileType.File) {
				return filePath;
			}
		}
		catch {
			/* empty */
		}

		// Stop at the workspace folder
		if (directory.fsPath === workspaceDir.uri.fsPath) {
			break;
		}

		directory = Utils.joinPath(directory, "../");
	}

	return undefined;
}
