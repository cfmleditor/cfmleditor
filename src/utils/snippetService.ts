import { Uri, WorkspaceConfiguration, workspace } from "vscode";
import { Snippet, Snippets } from "../entities/snippet";
import { setCustomSnippet } from "../features/cachedEntities";

export default class SnippetService {

    /**
     * @returns boolean
     */
    public static async cacheAllCustomSnippets(): Promise<boolean> {

        SnippetService.getCustomSnippets().then((snippets: Snippets) => {
            for (const key in snippets) {
                const snippet: Snippet = snippets[key];
                setCustomSnippet(key, snippet);
            }
        });

        return true;
    }

    /**
     * @returns Snippets
     */
    public static async getCustomSnippets(): Promise<Snippets> {

        return new Promise<Snippets>((resolve, reject) => {

            const cfmlCompletionSettings: WorkspaceConfiguration = workspace.getConfiguration("cfml.suggest");

            const snippetsLocalPath: string = cfmlCompletionSettings.get("snippets.localPath");

            if ( snippetsLocalPath && snippetsLocalPath.length > 0 ) {

                const snippetsPathUri: Uri = Uri.file(snippetsLocalPath);

                try {
                    workspace.fs.readFile(snippetsPathUri).then((readData) => {
                        const readStr = Buffer.from(readData).toString("utf8");
                        const readJson = JSON.parse(readStr);
                        resolve(readJson);
                    });
                } catch (ex) {
                    reject(ex);
                }

            } else {

                resolve({});

            }

        });

    }

}