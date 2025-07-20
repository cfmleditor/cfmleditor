import { Position, languages, commands, window, TextEditor, LanguageConfiguration, TextDocument, CharacterPair, CancellationToken, Range } from "vscode";
import { getCurrentConfigIsTag, LANGUAGE_ID, setCurrentConfigIsTag } from "../cfmlMain";
import { isCfcFile, getTagCommentRanges, isCfsFile, getCfScriptRanges } from "../utils/contextUtil";
import { getComponent, hasComponent } from "./cachedEntities";

export enum CommentType {
	Line,
	Block,
}

export interface CFMLCommentRules {
	scriptBlockComment: CharacterPair;
	scriptLineComment: string;
	tagBlockComment: CharacterPair;
}

export interface CommentContext {
	inComment: boolean;
	activeComment?: string | CharacterPair;
	commentType?: CommentType;
	start?: Position;
	depth: number;
}

export const cfmlCommentRules: CFMLCommentRules = {
	scriptBlockComment: ["/*", "*/"],
	scriptLineComment: "//",
	tagBlockComment: ["<!---", "--->"],
};

/**
 * Returns whether to use CFML tag comment
 * @param document The TextDocument in which the selection is made
 * @param startPosition The position at which the comment starts
 * @param _token cancellation token
 * @returns
 */
function isTagComment(document: TextDocument, startPosition: Position, _token: CancellationToken | undefined): boolean {
	const docIsScript: boolean = (isCfsFile(document) || (isCfcFile(document) && hasComponent(document.uri) && (getComponent(document.uri))?.isScript)) ? true : false;

	if (docIsScript) {
		return false;
	}

	const commentRanges: Range[] = getTagCommentRanges(document, undefined, _token, startPosition);
	const scriptRanges: Range[] = getCfScriptRanges(document, undefined, _token, commentRanges, true, startPosition);

	for (const range of scriptRanges) {
		if (range.contains(startPosition)) {
			return false;
		}
		if (startPosition.isBefore(range.start)) break;
	}

	return true;
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
	}
	else {
		command = "editor.action.blockComment";
	}

	return command;
}

/**
 * @param editor
 */
export function toggleBlockComment(editor: TextEditor): void {
	if (editor) {
		const tagComment: boolean = isTagComment(editor.document, editor.selection.start, undefined);
		toggleComment(CommentType.Block, editor, tagComment);
	}
	else {
		window.showInformationMessage("No editor is active");
	}
}

/**
 * @param editor
 */
export function toggleLineComment(editor: TextEditor): void {
	if (editor) {
		const tagComment: boolean = isTagComment(editor.document, editor.selection.start, undefined);
		toggleComment(CommentType.Line, editor, tagComment);
	}
	else {
		window.showInformationMessage("No editor is active");
	}
}

/**
 * Return a function that can be used to execute a line or block comment
 * @param commentType The comment type for which the command will be executed
 * @param editor
 * @param tagComment
 */
export function toggleComment(commentType: CommentType, editor: TextEditor, tagComment: boolean): void {
	if (editor) {
		if (getCurrentConfigIsTag() !== tagComment) {
			setCurrentConfigIsTag(tagComment);
			const languageConfig: LanguageConfiguration = tagComment
				? {
						comments: {
							blockComment: cfmlCommentRules.tagBlockComment,
						},
					}
				: {
						comments: {
							lineComment: cfmlCommentRules.scriptLineComment,
							blockComment: cfmlCommentRules.scriptBlockComment,
						},
					};
			languages.setLanguageConfiguration(LANGUAGE_ID, languageConfig);
		}
		const command: string = getCommentCommand(commentType);
		commands.executeCommand(command);
	}
	else {
		window.showInformationMessage("No editor is active");
	}
}
