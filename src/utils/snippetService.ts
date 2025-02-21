import { Uri, WorkspaceConfiguration, workspace } from "vscode";
import { Snippet, Snippets } from "../entities/snippet";
import { setCustomSnippet } from "../features/cachedEntities";

export default class SnippetService {

    /**
     * @returns boolean
     */
    public static async cacheAllCustomSnippets(): Promise<boolean> {

        const snippets: Snippets = await SnippetService.getCustomSnippets();
        for (const key in snippets) {
            const snippet: Snippet = snippets[key];
            setCustomSnippet(key, snippet);
        }
        return true;
    }

    /**
     * @returns Snippets
     */
    public static async getCustomSnippets(): Promise<Snippets> {
        const cfmlCompletionSettings: WorkspaceConfiguration = workspace.getConfiguration("cfml.suggest");
        const snippetsLocalPath: string = cfmlCompletionSettings.get("snippets.localPath");

        if (snippetsLocalPath && snippetsLocalPath.length > 0) {
            const snippetsPathUri: Uri = Uri.file(snippetsLocalPath);
            const readData = await workspace.fs.readFile(snippetsPathUri);
            const readStr = Buffer.from(readData).toString("utf8");
            const readJson = JSON.parse(readStr) as Snippets;
            return readJson;
        } else {
            return {};
        }
    }

}