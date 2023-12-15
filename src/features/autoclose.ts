'use strict';
import { TextDocumentChangeEvent, TextDocumentChangeReason, workspace, window, Range, Position, Selection, TextDocumentContentChangeEvent, TextEditor, WorkspaceConfiguration } from 'vscode';
import { nonClosingTags } from '../entities/tag';

export function insertAutoCloseTag(event: TextDocumentChangeEvent): void {

    if (!event.contentChanges[0] || event.reason == TextDocumentChangeReason.Undo || event.reason == TextDocumentChangeReason.Redo ) {
        return;
    }

    let isRightAngleBracket = CheckRightAngleBracket(event.contentChanges[0]);
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

    let languageId = editor.document.languageId;
    let languages = ["cfml"];
    let disableOnLanguage = [];

    if ((languages.indexOf("*") === -1 && languages.indexOf(languageId) === -1) || disableOnLanguage.indexOf(languageId) !== -1) {
        return;
    }

    let selection = editor.selection;
    let originalPosition = selection.start.translate(0, 1);
    let excludedTags = nonClosingTags;
    let isSublimeText3Mode = false;
    let enableAutoCloseSelfClosingTag = true;
    let isFullMode = true;

    if ((isSublimeText3Mode || isFullMode) && event.contentChanges[0].text === "/") {
        let text = editor.document.getText(new Range(new Position(0, 0), originalPosition));
        let last2chars = "";
        if (text.length > 2) {
            last2chars = text.substr(text.length - 2);
        }
        if (last2chars === "</") {
            let closeTag = getCloseTag(text, excludedTags);
            if (closeTag) {
                let nextChar = getNextChar(editor, originalPosition);
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

    if (((!isSublimeText3Mode || isFullMode) && isRightAngleBracket) ||
        (enableAutoCloseSelfClosingTag && event.contentChanges[0].text === "/")) {
        let textLine = editor.document.lineAt(selection.start);
        let text = textLine.text.substring(0, selection.start.character + 1);
        let result = /<([_a-zA-Z][a-zA-Z0-9:\-_.]*)(?:\s+[^<>]*?[^\s/<>=]+?)*?\s?(\/|>)$/.exec(text);
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
                if (textLine.text.length <= selection.start.character + 1 || textLine.text[selection.start.character + 1] !== '>') { // if not typing "/" just before ">", add the ">" after "/"
                    editor.edit((editBuilder) => {
                        // if (config.get<boolean>("insertSpaceBeforeSelfClosingTag")) {
                        //     const spacePosition = originalPosition.translate(0, -1);
                        //     editBuilder.insert(spacePosition, " ");
                        // }
                        editBuilder.insert(originalPosition, ">");
                    })
                }
            }
        }
    }
}

function CheckRightAngleBracket(contentChange: TextDocumentContentChangeEvent): boolean {
    return contentChange.text === ">" || CheckRightAngleBracketInVSCode_1_8(contentChange);
}

function CheckRightAngleBracketInVSCode_1_8(contentChange: TextDocumentContentChangeEvent): boolean {
    return contentChange.text.endsWith(">") && contentChange.range.start.character === 0
        && contentChange.range.start.line === contentChange.range.end.line
        && !contentChange.range.end.isEqual(new Position(0, 0));
}

export function insertCloseTag(): void {
    let editor = window.activeTextEditor;
    if (!editor) {
        return;
    }

    let selection = editor.selection;
    let originalPosition = selection.start;
    //let config = workspace.getConfiguration('auto-close-tag', editor.document.uri);
    let excludedTags = nonClosingTags;
    let text = editor.document.getText(new Range(new Position(0, 0), originalPosition));
    if (text.length > 2) {
        let closeTag = getCloseTag(text, excludedTags);
        if (closeTag) {
            editor.edit((editBuilder) => {
                editBuilder.insert(originalPosition, closeTag);
            }, {
                undoStopBefore: true,
                undoStopAfter: true
            });
        }
    }
}

function getNextChar(editor: TextEditor, position: Position): string {
    let nextPosition = position.translate(0, 1);
    let text = editor.document.getText(new Range(position, nextPosition));
    return text;
}

function getCloseTag(text: string, excludedTags: string[]): string {
    let regex = /<(\/?[_a-zA-Z][a-zA-Z0-9:\-_.]*)(?:\s+[^<>]*?[^\s/<>=]+?)*?\s?>/g;
    let result = null;
    let stack = [];
    while ((result = regex.exec(text)) !== null) {
        let isStartTag = result[1].substr(0, 1) !== "/";
        let tag = isStartTag ? result[1] : result[1].substr(1);
        if (excludedTags.indexOf(tag.toLowerCase()) === -1) {
            if (isStartTag) {
                stack.push(tag);
            } else if (stack.length > 0) {
                let lastTag = stack[stack.length - 1];
                if (lastTag === tag) {
                    stack.pop()
                }
            }
        }
    }
    if (stack.length > 0) {
        let closeTag = stack[stack.length - 1];
        if (text.substr(text.length - 2) === "</") {
            return closeTag + ">";
        }
        if (text.substr(text.length - 1) === "<") {
            return "/" + closeTag + ">";
        }
        return "</" + closeTag + ">";
    } else {
        return null;
    }
}

function moveSelectionRight(selection: Selection, shift: number): Selection {
    let newPosition = selection.active.translate(0, shift);
    let newSelection = new Selection(newPosition, newPosition);
    return newSelection;
}

function occurrenceCount(source: string, find: string): number {
    return source.split(find).length - 1;
}