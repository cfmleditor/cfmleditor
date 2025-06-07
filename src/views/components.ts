// import * as vscode from "vscode";
import { workspace, TreeDataProvider, TreeItemCollapsibleState, TreeItem, EventEmitter, Uri, ThemeIcon, CancellationToken, ProviderResult } from "vscode";

class CFCComponentItem extends TreeItem {
	constructor(
		public readonly label: string,
		public readonly fullPath: string
	) {
		super(label, TreeItemCollapsibleState.None);
		this.command = {
			title: "Open CFML Component",
			command: "cfmlExplorer.openFile",
			arguments: [Uri.file(fullPath)],
		};
		this.contextValue = "cfmlComponent";
		this.iconPath = new ThemeIcon("file-code"); // Make sure to use the appropiate icons
	}
}

export class CFMLFlatPackageProvider implements TreeDataProvider<CFCComponentItem> {
	private _onDidChangeTreeData = new EventEmitter<CFCComponentItem | undefined>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	constructor() {
		workspace.onDidCreateFiles((e) => {
			if (e.files.some(f => f.fsPath.endsWith(".cfc"))) {
				this._onDidChangeTreeData.fire(undefined);
			}
		});
	}

	getParent?(element: CFCComponentItem): ProviderResult<CFCComponentItem> {
		throw new Error("Method not implemented.");
	}

	resolveTreeItem?(item: TreeItem, element: CFCComponentItem, token: CancellationToken): ProviderResult<TreeItem> {
		throw new Error("Method not implemented.");
	}

	// getParent?(element: CFCComponentItem): ProviderResult<CFCComponentItem> {
	// 	throw new Error("Method not implemented.");
	// }

	// resolveTreeItem?(item: TreeItem, element: CFCComponentItem, token: CancellationToken): ProviderResult<TreeItem> {
	// 	throw new Error("Method not implemented.");
	// }

	setFilter(filter: string) {
		// this.filterText = filter.toLowerCase();
		this.refresh();
	}

	refresh() {
		this._onDidChangeTreeData.fire(undefined);
	}

	getTreeItem(item: CFCComponentItem): TreeItem {
		return item;
	}

	async getChildren(): Promise<CFCComponentItem[]> {
		return new Promise((resolve) => {
			resolve([]);
		});
	}
	// workspace.findFiles("**/*.cfc", "**/node_modules/**").then((files) => {
	// 	const items = files.map((file) => {
	// 		const relative = path.relative(this.rootPath, file.fsPath).replace(/\.cfc$/, "");
	// 		const packagePath = relative.split(path.sep).join(".");
	// 		return new CFCComponentItem(packagePath, file.fsPath);
	// 	});
	// 	return items.filter(item =>
	// 		this.filterText === "" || item.label.toLowerCase().includes(this.filterText)
	// 	);
	// });

	// const files = this.findCFCsRecursive(this.rootPath);
	// return files
	// 	.map((file) => {
	// 		const relative = path.relative(this.rootPath, file).replace(/\.cfc$/, "");
	// 		const packagePath = relative.split(path.sep).join(".");
	// 		return new CFCComponentItem(packagePath, file);
	// 	})
	// 	.filter(item =>
	// 		this.filterText === "" || item.label.toLowerCase().includes(this.filterText)
	// 	);

	// private findCFCsRecursive(dir: string): string[] {
	// 	const results: string[] = [];
	// 	const entries = workspace.fs.readDirectory(dir);
	// 	if (!entries) {
	// 		return results; // No entries found
	// 	}
	// 	for (const entry of entries) {
	// 		const fullPath = path.join(dir, entry.name);
	// 		if (entry.isDirectory()) {
	// 			results.push(...this.findCFCsRecursive(fullPath));
	// 		}
	// 		else if (entry.isFile() && fullPath.endsWith(".cfc")) {
	// 			results.push(fullPath);
	// 		}
	// 	}
	// 	return results;
	// }
}
