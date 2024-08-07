import { Position, languages, commands, window, TextEditor, LanguageConfiguration, TextDocument, CharacterPair, CancellationToken } from "vscode";
import { LANGUAGE_ID, LANGUAGE_CFS_ID } from "../cfmlMain";
import { isInCfScript, isCfcFile } from "../utils/contextUtil";
import { getComponent, hasComponent } from "./cachedEntities";

export enum CommentType {
    Line,
    Block
}

export interface CFMLCommentRules {
    scriptBlockComment: CharacterPair;
    scriptLineComment: string;
    tagBlockComment: CharacterPair;
}

export interface CommentContext {
    inComment: boolean;
    activeComment: string | CharacterPair;
    commentType: CommentType;
    start: Position;
    depth: number;
}

export const cfmlCommentRules: CFMLCommentRules = {
    scriptBlockComment: ["/*", "*/"],
    scriptLineComment: "//",
    tagBlockComment: ["<!---", "--->"]
};

/**
 * Returns whether to use CFML tag comment
 * @param document The TextDocument in which the selection is made
 * @param startPosition The position at which the comment starts
 * @param _token
 * @returns
 */
async function isTagComment(document: TextDocument, startPosition: Position, _token: CancellationToken): Promise<boolean> {
    const docIsScript: boolean = (isCfcFile(document, _token) && hasComponent(document.uri, _token) && (await getComponent(document.uri, _token)).isScript);

    return !docIsScript && !isInCfScript(document, startPosition, _token);
}

/**
 * Returns the command for the comment type specified
 * @param commentType The comment type for which to get the command
 * @returns
 */
function getCommentCommand(commentType: CommentType): string {
    let command: string = "";
    if (commentType === CommentType.Line) {
        command = "editor.action.commentLine";
    } else {
        command = "editor.action.blockComment";
    }

    return command;
}

/**
 * Return a function that can be used to execute a line or block comment
 * @param commentType The comment type for which the command will be executed
 * @param _token
 * @returns
 */
export function toggleComment(commentType: CommentType, _token: CancellationToken): (editor: TextEditor) => Promise<void> {
    return async (editor: TextEditor) => {
        if (editor) {
            // default comment config
            let languageConfig: LanguageConfiguration = {
                comments: {
                    lineComment: cfmlCommentRules.scriptLineComment,
                    blockComment: cfmlCommentRules.scriptBlockComment
                }
            };

            const cfsLanguageConfig: LanguageConfiguration = {
                comments: {
                    lineComment: cfmlCommentRules.scriptLineComment,
                    blockComment: cfmlCommentRules.scriptBlockComment
                }
            };

            // Changes the comment in language configuration based on the context
            if (await isTagComment(editor.document, editor.selection.start, _token)) {
                languageConfig = {
                    comments: {
                        blockComment: cfmlCommentRules.tagBlockComment
                    }
                };
            }
            languages.setLanguageConfiguration(LANGUAGE_ID, languageConfig);
            languages.setLanguageConfiguration(LANGUAGE_CFS_ID, cfsLanguageConfig);
            const command: string = getCommentCommand(commentType);
            commands.executeCommand(command);
        } else {
            window.showInformationMessage("No editor is active");
        }
    };
}
