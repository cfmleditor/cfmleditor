"use strict";
import { TextDocumentChangeEvent, TextDocumentChangeReason, workspace, window, Range, Position, Selection, TextDocumentContentChangeEvent, TextEditor, WorkspaceConfiguration } from "vscode";
import { nonClosingTags } from "../entities/tag";

/**
 * @description Inserts closing tag when user types '/' or '>'.
 */
export function handleContentChanges(event: TextDocumentChangeEvent): void {

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
    const disableOnLanguage = [];

    if ((languages.indexOf("*") === -1 && languages.indexOf(languageId) === -1) || disableOnLanguage.indexOf(languageId) !== -1) {
        return;
    }

    event.contentChanges.forEach((contentChange) => {
        closeTag(contentChange);
    });
}

/**
 * @description Evaluates a contentChange and inserts a closing tag when user types '/' or '>'
 */
function closeTag(contentChange: TextDocumentContentChangeEvent): void {
    const isRightAngleBracket = checkRightAngleBracket(contentChange);
    const isForwardSlash = contentChange.text === "/";

    if (!isRightAngleBracket && !isForwardSlash) {
        return;
    }

    const editor = window.activeTextEditor;
    const selection = editor.selection;
    const originalPosition = selection.start.translate(0, 1);

    if (isForwardSlash) {
        const [last2chars, linePreceding] = getPrecedingCharacters(originalPosition, editor);
        if (last2chars === "</") {
            let closeTag = getCloseTag(linePreceding, nonClosingTags);
            if (closeTag) {
                const nextChar = getNextChar(editor, originalPosition);
                if (nextChar === ">") {
                    closeTag = closeTag.substr(0, closeTag.length - 1);
                }
                editor.edit((editBuilder) => {
                    editBuilder.insert(originalPosition, closeTag);
                }).then(() => {
                    if (nextChar === ">") {
                        editor.selection = moveSelectionRight(editor.selection, 1);
                    }
                });
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
                    editor.edit((editBuilder) => {
                        editBuilder.insert(originalPosition, "</" + result[1] + ">");
                    }).then(() => {
                        editor.selection = new Selection(originalPosition, originalPosition);
                    });
                }
            } else {
                // if not typing "/" just before ">", add the ">" after "/"
                if (textLine.text.length <= selection.start.character + 1 || textLine.text[selection.start.character + 1] !== ">") {
                    editor.edit((editBuilder) => {
                        editBuilder.insert(originalPosition, ">");
                    });
                }
            }
        }
    }
}

/**
 * @description Gets the preceding two characters of a cursor position.
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
 * @description Checks if the user has typed a right angle bracket.
 */
function checkRightAngleBracket(contentChange: TextDocumentContentChangeEvent): boolean {
    return contentChange.text === ">" || checkRightAngleBracketInVSCode1Dot8(contentChange);
}

/**
 * @description Checks if the user has typed a right angle bracket in VSCode 1.8.
 */
function checkRightAngleBracketInVSCode1Dot8(contentChange: TextDocumentContentChangeEvent): boolean {
    return contentChange.text.endsWith(">") && contentChange.range.start.character === 0
        && contentChange.range.start.line === contentChange.range.end.line
        && !contentChange.range.end.isEqual(new Position(0, 0));
}

/**
 * @description Gets the next character in the editor.
 */
function getNextChar(editor: TextEditor, position: Position): string {
    const nextPosition = position.translate(0, 1);
    const text = editor.document.getText(new Range(position, nextPosition));
    return text;
}

const TAG_RE = /<(\/?[a-zA-Z][a-zA-Z0-9:_.-]*)(?![\s\S]*<\/?[a-zA-Z])/;

/**
 * @description Gets the closing tag for the given text.
 */
function getCloseTag(text: string, excludedTags: string[]): string {
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
 * @description Moves the selection to the right.
 */
function moveSelectionRight(selection: Selection, shift: number): Selection {
    const newPosition = selection.active.translate(0, shift);
    return new Selection(newPosition, newPosition);
}

/**
 * @description Counts the number of occurrences of a string in another string.
 */
function occurrenceCount(source: string, find: string): number {
    return source.split(find).length - 1;
}