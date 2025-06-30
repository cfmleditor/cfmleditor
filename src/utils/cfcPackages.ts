// This file provides functions to convert paths to package names and vice versa,
// It also allows replacement of packagenames with mappings.

import { join } from "path";
import { Uri, workspace } from "vscode";

export interface CFMLMapping {
	directoryPath: string; // The physical path to the directory
	logicalPath: string; // The logical path to the directory
	isPhysicalDirectoryPath: boolean; // Whether the directoryPath is a physical path
}
/**
 *
 * @param path
 * @param mappings
 * @returns
 */
export function convertPathToPackageName(
	path: Uri,
	mappings: CFMLMapping[]
): string {
	let relPath = "";

	// We would need to kinda sort the mappings by length, so that the longest matching path is used first.
	mappings.sort((a, b) => {
		return b.directoryPath.length - a.directoryPath.length;
	});

	relPath = workspace.asRelativePath(path, false);

	for (const mapping of mappings) {
		if (mapping.isPhysicalDirectoryPath
			&& path.fsPath.startsWith(mapping.directoryPath)
		) {
			relPath = path.fsPath.replace(mapping.directoryPath, "");
			relPath = join(mapping.logicalPath, relPath);
			break;
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
