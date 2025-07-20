import { Position, languages, commands, window, TextEditor, LanguageConfiguration, TextDocument, CharacterPair, CancellationToken, Range } from "vscode";
import { getCurrentConfigIsTag, LANGUAGE_ID, setCurrentConfigIsTag } from "../cfmlMain";
import { isCfcFile, getTagCommentRanges, isCfsFile, getCfScriptRanges, getScriptCommentRanges } from "../utils/contextUtil";
import { getComponent, hasComponent } from "./cachedEntities";

export enum CommentType {
	Line,
	Block,
}

export enum CommentLanguage {
	Tag,
	Script,
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
function getCommentLangAndInRange(document: TextDocument, startPosition: Position, _token: CancellationToken | undefined): [CommentLanguage, Range | undefined] {
	const docIsScript: boolean = (isCfsFile(document) || (isCfcFile(document) && hasComponent(document.uri) && (getComponent(document.uri))?.isScript)) ? true : false;

	let commentLang: CommentLanguage = CommentLanguage.Tag;
	let inCommentRange: Range | undefined;
	let scriptCommentRanges: Range[] | undefined;
	let tagCommentRanges: Range[] | undefined;

	if (docIsScript) {
		commentLang = CommentLanguage.Script;
		scriptCommentRanges = getScriptCommentRanges(document, undefined, _token);
	}

	if (commentLang === CommentLanguage.Tag) {
		tagCommentRanges = getTagCommentRanges(document, undefined, _token, startPosition);
		const scriptRanges: Range[] = getCfScriptRanges(document, undefined, _token, tagCommentRanges, true, startPosition);

		for (const scriptRange of scriptRanges) {
			if (scriptRange.contains(startPosition)) {
				commentLang = CommentLanguage.Script;
				scriptCommentRanges = getScriptCommentRanges(document, scriptRange, _token);
				break;
			}
			if (startPosition.isBefore(scriptRange.start)) break;
		}
	}

	if (commentLang === CommentLanguage.Tag && tagCommentRanges) {
		for (const commentRange of tagCommentRanges) {
			if (commentRange.contains(startPosition)) {
				inCommentRange = commentRange;
				break;
			}
		}
	}

	if (commentLang === CommentLanguage.Script && scriptCommentRanges) {
		for (const commentRange of scriptCommentRanges) {
			if (commentRange.contains(startPosition)) {
				inCommentRange = commentRange;
				break;
			}
		}
	}

	return [commentLang, inCommentRange];
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
		const [lang, range] = getCommentLangAndInRange(editor.document, editor.selection.start, undefined);
		if (range) {
			forceUncommentBlock(
				editor,
				range,
				(
					(lang === CommentLanguage.Tag)
						? cfmlCommentRules.tagBlockComment
						: cfmlCommentRules.scriptBlockComment
				)
			);
		}
		else {
			toggleComment(CommentType.Block, editor, ((lang === CommentLanguage.Tag) ? true : false));
		}
	}
	else {
		window.showInformationMessage("No editor is active");
	}
}

function forceUncommentBlock(editor: TextEditor, range: Range, commentPair: CharacterPair): void {
	const document = editor.document;
	const text = document.getText(range);

	const [start, end] = commentPair;
	if (text.startsWith(start) && text.endsWith(end)) {
		const uncommentedText = text.slice(start.length, -end.length);
		editor.edit((editBuilder) => {
			editBuilder.replace(range, uncommentedText);
		});
	}
}

/**
 * @param editor
 */
export function toggleLineComment(editor: TextEditor): void {
	if (editor) {
		const [lang, range] = getCommentLangAndInRange(editor.document, editor.selection.start, undefined);
		if (range) {
			forceUncommentBlock(
				editor,
				range,
				(
					(lang === CommentLanguage.Tag)
						? cfmlCommentRules.tagBlockComment
						: cfmlCommentRules.scriptBlockComment
				)
			);
		}
		else {
			toggleComment(CommentType.Line, editor, ((lang === CommentLanguage.Tag) ? true : false));
		}
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
