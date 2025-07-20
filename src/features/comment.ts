import { Position, languages, commands, window, TextEditor, LanguageConfiguration, TextDocument, CharacterPair, CancellationToken, Range, Selection, workspace, WorkspaceConfiguration } from "vscode";
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
 * @param editor
 */
export function toggleBlockComment(editor: TextEditor): void {
	toggleComment(CommentType.Block, editor);
}

function forceUncommentBlock(editor: TextEditor, range: Range, commentPair: CharacterPair): void {
	const document = editor.document;
	const text = document.getText(range);

	const [start, end] = commentPair;
	if (text.startsWith(start) && text.endsWith(end)) {
		// Check for spaces after start and before end markers
		const hasStartSpace = text.charAt(start.length) === " ";
		const hasEndSpace = text.charAt(text.length - end.length - 1) === " ";

		const startOffset = start.length + (hasStartSpace ? 1 : 0);
		const endOffset = end.length + (hasEndSpace ? 1 : 0);

		const uncommentedText = text.slice(startOffset, -endOffset);
		// Store relative positions within the content (not the comment markers)
		const contentStart = document.offsetAt(range.start) + startOffset;
		const relativeSelections = editor.selections.map(selection => ({
			startOffset: document.offsetAt(selection.start) - contentStart,
			endOffset: document.offsetAt(selection.end) - contentStart,
		}));

		editor.edit((editBuilder) => {
			editBuilder.replace(range, uncommentedText);
		}).then(() => {
			const newRangeStart = document.offsetAt(range.start);
			const newSelections = relativeSelections.map((rel) => {
				const newStart = document.positionAt(newRangeStart + Math.max(0, rel.startOffset));
				const newEnd = document.positionAt(newRangeStart + Math.max(0, rel.endOffset));
				return new Selection(newStart, newEnd);
			});

			editor.selections = newSelections;
		});
	}
}

/**
 * @param editor
 */
export function toggleLineComment(editor: TextEditor): void {
	toggleComment(CommentType.Line, editor);
}

/**
 * Return a function that can be used to execute a line or block comment
 * @param commentType The comment type for which the command will be executed
 * @param editor
 */
export function toggleComment(commentType: CommentType, editor: TextEditor): void {
	if (!editor) {
		window.showInformationMessage("No editor is active");
		return;
	}

	const cfmlCommentSettings: WorkspaceConfiguration = workspace.getConfiguration("cfml.comments", editor.document.uri);
	const uncommentAnywhere: boolean = cfmlCommentSettings.get<boolean>("uncommentAnywhere.enabled", false);

	const [lang, range] = getCommentLangAndInRange(editor.document, editor.selection.start, undefined);
	if (uncommentAnywhere && editor.selections.length < 2 && range && (lang === CommentLanguage.Tag || editor.document.getText(range).charCodeAt(1) === 42)) { // 47 = '/', 42 = '*'
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
		const tagComment: boolean = (lang === CommentLanguage.Tag);
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
		commands.executeCommand((commentType === CommentType.Line) ? "editor.action.commentLine" : "editor.action.blockComment");
	}
}
