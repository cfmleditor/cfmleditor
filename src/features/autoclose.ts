"use strict";
import { TextDocumentChangeEvent, TextDocumentChangeReason, workspace, window, Range, Position, Selection, TextDocumentContentChangeEvent, TextEditor, WorkspaceConfiguration, TextEditorEdit } from "vscode";
import { nonClosingTags } from "../entities/tag";

/**
 * @param event
 * @description Inserts closing tag when user types '/' or '>'.
 */
export async function handleContentChanges(event: TextDocumentChangeEvent): Promise<void> {

    if (!event.contentChanges[0] || event.reason === TextDocumentChangeReason.Undo || event.reason === TextDocumentChangeReason.Redo ) {
        return;
    }

    const editor = window.activeTextEditor;
    if ( !editor || editor && event.document !== editor.document ) {
        return;
    }

    const cfmlSettings: WorkspaceConfiguration = workspace.getConfiguration("cfml");
    if (!cfmlSettings.get<boolean>("autoCloseTags.enable", true)) {
        return;
    }

    const languageId = editor.document.languageId;
    const languages = ["cfml"];

    if ((languages.indexOf("*") === -1 && languages.indexOf(languageId) === -1)) {
        return;
    }

    // for ( const contentChange of event.contentChanges ) {

        const contentChange = event.contentChanges[0];
        const isRightAngleBracket = checkRightAngleBracket(contentChange);
        const isForwardSlash = contentChange.text === "/";

        if (!isRightAngleBracket && !isForwardSlash) {
            return;
        }

        // if ( editor.selections.length > 1 ) {
            // return;
        // }

        for ( let i = 0; i < editor.selections.length; i++ ) {
            await closeTag(contentChange, editor, editor.selections[i], i, editor.selections.length);
        }

    // }
}

/**
 * @param contentChange
 * @param editor
 * @param selection
 * @param selectionPosn
 * @param selectionLength
 * @description Evaluates a contentChange and inserts a closing tag when user types '/' or '>'
 */
async function closeTag(contentChange: TextDocumentContentChangeEvent, editor: TextEditor, selection: Selection, selectionPosn: number, selectionLength: number): Promise<void> {

    const isRightAngleBracket = checkRightAngleBracket(contentChange);
    const isForwardSlash = contentChange.text === "/";
    const originalPosition = selection.start.translate(0, 1);

    if (isForwardSlash) {
        const [last2chars, linePreceding] = getPrecedingCharacters(originalPosition, editor);
        if (last2chars === "</") {
            let closeTag: string | null = getCloseTag(linePreceding, nonClosingTags);
            if (closeTag) {
                const nextChar = getNextChar(editor, originalPosition);
                if (nextChar === ">") {
                    closeTag = closeTag.substring(0, closeTag.length - 1);
                }
                if ( closeTag ) {
                    await editor.edit((editBuilder: TextEditorEdit) => {
                        if ( closeTag ) {
                            editBuilder.insert(originalPosition, closeTag);
                        }
                    }).then(() => {
                        if (nextChar === ">") {
                            editor.selection = moveSelectionRight(editor.selection, 1);
                        }
                    });
                }
            }
        }
    }

    if (isRightAngleBracket || isForwardSlash) {
        const textLine = editor.document.lineAt(selection.start);
        const text = textLine.text.substring(0, selection.start.character + 1);
        const result = /<([_a-zA-Z][a-zA-Z0-9:\-_.]*)(?:\s+[^<>]*?[^\s/<>=]+?)*?\s?(\/|>)$/.exec(text);
        if (result !== null && ((occurrenceCount(result[0], "'") % 2 === 0)
            && (occurrenceCount(result[0], "\"") % 2 === 0) && (occurrenceCount(result[0], "`") % 2 === 0))) {
            if (result[2] === ">") {
                if (nonClosingTags.indexOf(result[1].toLowerCase()) === -1) {
                    await editor.edit((editBuilder: TextEditorEdit) => {
                        editBuilder.insert(originalPosition, "</" + result[1] + ">");
                    }).then(() => {
                        if ( selectionLength < 2 ) {
                            editor.selection = new Selection(originalPosition, originalPosition);
                        }
                    });
                }
            } else {
                // if not typing "/" just before ">", add the ">" after "/"
                if (textLine.text.length <= selection.start.character + 1 || textLine.text[selection.start.character + 1] !== ">") {
                    await editor.edit((editBuilder: TextEditorEdit) => {
                        editBuilder.insert(originalPosition, ">");
                    });
                }
            }
        }
    }
}

/**
 * @param originalPosition
 * @param editor
 * @description Gets the preceding two characters of a cursor position.
 * @returns
 */
function getPrecedingCharacters(originalPosition: Position, editor: TextEditor){
    const range = new Range(new Position(Math.max(originalPosition.line - 1000, 0), 0), originalPosition);
    const text = editor.document.getText(range);
    let last2chars = "";
    if (text.length > 2) {
        last2chars = text.substr(text.length - 2);
    }
    return [last2chars, text];
}

/**
 * @param contentChange
 * @description Checks if the user has typed a right angle bracket.
 * @returns
 */
function checkRightAngleBracket(contentChange: TextDocumentContentChangeEvent): boolean {
    return contentChange.text === ">" || checkRightAngleBracketInVSCode1Dot8(contentChange);
}

/**
 * @param contentChange
 * @description Checks if the user has typed a right angle bracket in VSCode 1.8.
 * @returns
 */
function checkRightAngleBracketInVSCode1Dot8(contentChange: TextDocumentContentChangeEvent): boolean {
    return contentChange.text.endsWith(">") && contentChange.range.start.character === 0
        && contentChange.range.start.line === contentChange.range.end.line
        && !contentChange.range.end.isEqual(new Position(0, 0));
}

/**
 * @param editor
 * @param position
 * @description Gets the next character in the editor.
 * @returns
 */
function getNextChar(editor: TextEditor, position: Position): string {
    const nextPosition = position.translate(0, 1);
    const text = editor.document.getText(new Range(position, nextPosition));
    return text;
}

const TAG_RE = /<(\/?[a-zA-Z][a-zA-Z0-9:_.-]*)(?![\s\S]*<\/?[a-zA-Z])/;

/**
 * @param text
 * @param excludedTags
 * @description Gets the closing tag for the given text.
 * @returns
 */
function getCloseTag(text: string, excludedTags: string[]): string | null {
    const s = text[text.length - 1] === "/" && text[text.length - 2] === "<" ? text.slice(0, -2) : text[text.length - 1] === "<" ? text.slice(0, -1) : text;
    let m = s.match(TAG_RE);
    // while we catch a closing tag, we jump directly to the matching opening tag
    while (m && ( m[1][0] === "/" || excludedTags.indexOf(m[1].toLowerCase()) !== -1 )) {
        const s2 = s.slice(0, m.index);
        if ( m[1][0] === "/" ) {
            // Already Closed Tags
            const m2 = s2.match(RegExp(`<${m[1].slice(1)}.*$`, "m"));
            if (!m2) {return "";}
            m = s.slice(0, m2.index).match(TAG_RE);
        } else {
            // Excluded Tags
            m = s.slice(0, m.index).match(TAG_RE);
        }
    }
    if (!m) {return null;}
    return (text[text.length - 1] === "/" && text[text.length - 2] === "<" ? m[1] : text[text.length - 1] === "<" ? "/" + m[1] : "</" + m[1]) + ">";
}

/**
 * @param selection
 * @param shift
 * @description Moves the selection to the right.
 * @returns
 */
function moveSelectionRight(selection: Selection, shift: number): Selection {
    const newPosition = selection.active.translate(0, shift);
    return new Selection(newPosition, newPosition);
}

/**
 * @param source
 * @param find
 * @description Counts the number of occurrences of a string in another string.
 * @returns
 */
function occurrenceCount(source: string, find: string): number {
    return source.split(find).length - 1;
}