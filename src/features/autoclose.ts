"use strict";
import { TextDocumentChangeEvent, TextDocumentChangeReason, workspace, window, Range, Position, Selection, TextDocumentContentChangeEvent, TextEditor, WorkspaceConfiguration } from "vscode";
import { nonClosingTags } from "../entities/tag";

/**
 * @description Inserts closing tag when user types '/' or '>'.
 * @param event
 */
export function insertAutoCloseTag(event: TextDocumentChangeEvent): void {

    if (!event.contentChanges[0] || event.reason == TextDocumentChangeReason.Undo || event.reason == TextDocumentChangeReason.Redo ) {
        return;
    }

    const isRightAngleBracket = checkRightAngleBracket(event.contentChanges[0]);
    if (!isRightAngleBracket && event.contentChanges[0].text !== "/") {
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

    const selection = editor.selection;
    const originalPosition = selection.start.translate(0, 1);
    const excludedTags = nonClosingTags;

    if (event.contentChanges[0].text === "/") {
        const text = editor.document.getText(new Range(new Position(Math.max(originalPosition.line - 1000,0), 0), originalPosition));
        let last2chars = "";
        if (text.length > 2) {
            last2chars = text.substr(text.length - 2);
        }
        if (last2chars === "</") {
            let closeTag = getCloseTag(text, excludedTags);
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

    if (isRightAngleBracket || event.contentChanges[0].text === "/") {
        const textLine = editor.document.lineAt(selection.start);
        const text = textLine.text.substring(0, selection.start.character + 1);
        const result = /<([_a-zA-Z][a-zA-Z0-9:\-_.]*)(?:\s+[^<>]*?[^\s/<>=]+?)*?\s?(\/|>)$/.exec(text);
        if (result !== null && ((occurrenceCount(result[0], "'") % 2 === 0)
            && (occurrenceCount(result[0], "\"") % 2 === 0) && (occurrenceCount(result[0], "`") % 2 === 0))) {
            if (result[2] === ">") {
                if (excludedTags.indexOf(result[1].toLowerCase()) === -1) {
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
 * @description Checks if the user has typed a right angle bracket.
 */
function checkRightAngleBracket(contentChange: TextDocumentContentChangeEvent): boolean {
    return contentChange.text === ">" || checkRightAngleBracketInVSCode_1_8(contentChange);
}

/**
 * @description
 */
function checkRightAngleBracketInVSCode_1_8(contentChange: TextDocumentContentChangeEvent): boolean {
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