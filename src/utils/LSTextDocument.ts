import { EndOfLine, Position, Range, TextDocument, TextLine, Uri } from "vscode";
import { TextDocument as FastTextDocument } from "vscode-languageserver-textdocument";
const fs = require('fs').promises;

export class LSTextDocument implements TextDocument {

    // These are fixed as this implementation is not open for editing
    readonly isUntitled: boolean = false;
    readonly version: number = 1;
    readonly isDirty: boolean = false;
    readonly isClosed: boolean = false;

    // These are set once in the constructor
    public readonly uri: Uri;
    public readonly fileName: string;
    public readonly eol: EndOfLine;

    // This is the actual text document
    private textDocument: FastTextDocument;
    private content: string;


    // Pass these through to the actual text document
    get languageId(): string {
        return this.textDocument.languageId;
    }
    get lineCount(): number {
        return this.textDocument.lineCount;
    }

    constructor(uri: Uri, languageId: string, version: number, content: string) {
        this.textDocument = FastTextDocument.create(uri.toString(), languageId, version, content);
        this.content = content;
        this.uri = uri;
        this.fileName = uri.fsPath;
        this.eol = this.getEOL(content);
        this.textDocument.uri
        this.textDocument.version
    }

    public static async openTextDocument(uri: Uri, languageId: string = "plaintext"): Promise<LSTextDocument> {
        const content = await fs.readFile(uri.fsPath, 'utf8');
        const version = 1; // Initial version
        return new LSTextDocument(uri, languageId, version, content);
    }

    private getEOL(text: string): EndOfLine {
        const idx = text.indexOf('\n');
        // Default to '\n' if the text has no lines at all
        if (idx === -1) {
            return EndOfLine.LF;
        }
        // Check the first '\n' character and see if it is preceded by '\r'
        if (idx > 0 && text.charCodeAt(idx - 1) === 13) {
            return EndOfLine.CRLF;
        }
        // Default to '\n'
        return EndOfLine.LF;
    }

    save(): Thenable<boolean> {
        throw new Error("Method not implemented.");
    }

    lineAt(line: number): TextLine;
    lineAt(position: Position): TextLine;
    lineAt(lineOrPosition: number | Position): TextLine {
        if (typeof lineOrPosition === 'number') {
            return this._lineAt(new Position(lineOrPosition, 0));
        } else {
            return this._lineAt(lineOrPosition);
        }
    }
    _lineAt(position: Position): TextLine {
        const lineText = this.textDocument.getText({
            start: { line: position.line, character: 0 },
            end: { line: position.line, character: Number.MAX_SAFE_INTEGER }
        });
        return {
            lineNumber: position.line,
            text: lineText,
            range: new Range(new Position(position.line, 0), new Position(position.line, lineText.length)),
            rangeIncludingLineBreak: new Range(new Position(position.line, 0), new Position(position.line + 1, 0)),
            firstNonWhitespaceCharacterIndex: lineText.search(/\S|$/),
            isEmptyOrWhitespace: lineText.trim().length === 0
        };
    }

    offsetAt(position: Position): number {
        return this.textDocument.offsetAt(position);
    }
    positionAt(offset: number): Position {
        const pos = this.textDocument.positionAt(offset)
        return new Position(pos.line, pos.character);
    }
    getText(range?: Range): string {
        return this.textDocument.getText(range);
    }

    getWordRangeAtPosition(position: Position, regex?: RegExp): Range | undefined {
        const text = this.content;
        const offset = this.textDocument.offsetAt(position);
        const start = text.lastIndexOf(' ', offset) + 1;
        const end = text.indexOf(' ', offset);
        if (start === -1 || end === -1) {
            return undefined;
        }
        return new Range(this.positionAt(start), this.positionAt(end));
    }
    validateRange(range: Range): Range {
        const start = this.positionAt(Math.max(0, this.offsetAt(range.start)));
        const end = this.positionAt(Math.min(this.content.length, this.offsetAt(range.end)));
        return new Range(start, end);
    }
    validatePosition(position: Position): Position {
        const offset = this.offsetAt(position);
        const validatedOffset = Math.max(0, Math.min(offset, this.content.length));
        return this.positionAt(validatedOffset);
    }

}
