// This file provides functions to convert paths to package names and vice versa,
// It also allows replacement of packagenames with mappings.

import { Uri, workspace } from "vscode";
import { join } from "path";

interface CFMLMapping {
	directoryPath: string; // The physical path to the directory
	logicalPath: string; // The logical path to the directory
	isPhysicalDirectoryPath: boolean; // Whether the directoryPath is a physical path
}
/**
 *
 * @param workspacePath
 * @param path
 * @returns
 */
export function convertPathToPackageName(
	workspacePath: Uri,
	path: Uri
): string {
	const mappings = workspace.getConfiguration("cfml").get<CFMLMapping[]>("mappings", []) || [];

	// We would need to kinda sort the mappings by length, so that the longest matching path is used first.
	mappings.sort((a, b) => {
		return b.directoryPath.length - a.directoryPath.length;
	});

	let relPath = workspace.asRelativePath(path);
	for (const mapping of mappings) {
		if (mapping.isPhysicalDirectoryPath) {
			continue;
		}

		if (relPath.startsWith(mapping.directoryPath)) {
			relPath = join(
				mapping.logicalPath,
				relPath.slice(mapping.directoryPath.length)
			);
			break;
		}
	}

	// Now convert it to a package path
	relPath = relPath.replace(/^[/|\\]/, "") // removes leading slashes.
		.replace(/[/|\\]/g, ".") // replaces slashes with dots.
		.replace(/\.[A-Za-z]+$/, ""); // removes the file extension.

	return relPath;
}
