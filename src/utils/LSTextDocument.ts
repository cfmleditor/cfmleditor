// THIRD PARTY LICENSE NOTICE:
//
// Portions of this code are sourced from Visual Studio Code:
//
//  Copyright (c) Microsoft Corporation. All rights reserved.
//  Licensed under the MIT License. See LICENSE in the project root for license information.

import { EndOfLine, Position, Range, TextDocument, TextLine, Uri, workspace } from "vscode";
import { TextDocument as FastTextDocument } from "vscode-languageserver-textdocument";
import { getWordAtText } from "./wordHelpers";

/**
 * LSTextDocument (Language Server Text Document)
 *
 * This is a replacement for `vscode.TextDocument` that uses `vscode-languageserver-textdocument.TextDocument` as the underlying implementation.
 *
 * This is intended to be faster than `vscode.TextDocument` as it doesn't interact with the editor.
 */
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
	public readonly encoding: string;

	// This is the actual text document
	private textDocument: FastTextDocument;

	// Pass these through to the actual text document
	get languageId(): string {
		return this.textDocument.languageId;
	}

	get lineCount(): number {
		return this.textDocument.lineCount;
	}

	constructor(uri: Uri, languageId: string, version: number, content: string) {
		// Normalize line endings
		// Note: This is done to match the behavior of vscode.TextDocument
		let lineEnding = "\n";
		const lineEndingMatch = content.match(/\r\n|\r|\n/g);
		if (lineEndingMatch) {
			lineEnding = lineEndingMatch[0];
			// VS Code changes old Mac-style line endings to '\r\n'
			if (lineEnding === "\r") {
				lineEnding = "\r\n";
			}
			// Ensure the document has consistent line endings
			content = content.replaceAll(/\r\n|\r|\n/g, lineEnding);
		}

		this.textDocument = FastTextDocument.create(uri.toString(), languageId, version, content);

		this.uri = uri;
		this.fileName = uri.fsPath;
		this.eol = lineEnding === "\r\n" ? EndOfLine.CRLF : EndOfLine.LF;
		this.encoding = "utf-8"; // Default encoding, can be changed if needed
		// this.textDocument.uri
		// this.textDocument.version
	}

	public static async openTextDocument(uri: Uri, languageId: string = "plaintext"): Promise<LSTextDocument> {
		const contentBytes = await workspace.fs.readFile(uri);
		const content = new TextDecoder("utf-8").decode(contentBytes);
		const version = 1; // Initial version
		return new LSTextDocument(uri, languageId, version, content);
	}

	save(): Thenable<boolean> {
		throw new Error("Method not implemented.");
	}

	lineAt(line: number): TextLine;
	lineAt(position: Position): TextLine;
	lineAt(lineOrPosition: number | Position): TextLine {
		if (typeof lineOrPosition === "number") {
			return this._lineAt(new Position(lineOrPosition, 0));
		}
		else {
			return this._lineAt(lineOrPosition);
		}
	}

	_lineAt(position: Position): TextLine {
		const lineText = this.textDocument.getText({
			start: { line: position.line, character: 0 },
			end: { line: position.line, character: Number.MAX_SAFE_INTEGER },
		});
		return {
			lineNumber: position.line,
			text: lineText,
			range: new Range(new Position(position.line, 0), new Position(position.line, lineText.length)),
			rangeIncludingLineBreak: new Range(new Position(position.line, 0), new Position(position.line + 1, 0)),
			firstNonWhitespaceCharacterIndex: lineText.search(/\S|$/),
			isEmptyOrWhitespace: lineText.trim().length === 0,
		};
	}

	offsetAt(position: Position): number {
		return this.textDocument.offsetAt(position);
	}

	positionAt(offset: number): Position {
		const pos = this.textDocument.positionAt(offset);
		return new Position(pos.line, pos.character);
	}

	getText(range?: Range): string {
		return this.textDocument.getText(range);
	}

	// See: https://github.com/microsoft/deoptexplorer-vscode/blob/9a6bc239bf88a6c26a52a517d41e1a00e1d96353/src/third-party-derived/vscode/textDocumentLike.ts#L262
	getWordRangeAtPosition(position: Position, regex?: RegExp): Range | undefined {
		position = this.validatePosition(position);

		// Use the default regex, or validate a custom regex
		if (!regex) {
			regex = DEFAULT_WORD_REGEXP;
		}
		else {
			// Ensure a custom regex doesn't cause an infinite loop
			regex.lastIndex = 0;
			if (regex.test("") && regex.lastIndex === 0) {
				throw new Error("Ignoring custom regexp because it matches the empty string.");
			}
			if (!regex.global || regex.sticky) {
				let flags = "g";
				if (regex.ignoreCase) flags += "i";
				if (regex.multiline) flags += "m";
				if (regex.unicode) flags += "u";
				regex = new RegExp(regex.source, flags);
			}
		}

		/*
            Scan the current line for a word that contains the position.
             - If the regex is bad this could cause an infinite loop, which is why we validate it above.
             - This can return null if it doesn't find a match in a set time.
        */
		const wordAtText = getWordAtText(
			position.character + 1,
			regex,
			this.lineAt(position).text
		);

		if (wordAtText) {
			return new Range(position.line, wordAtText.startColumn - 1, position.line, wordAtText.endColumn - 1);
		}
		return undefined;
	}

	validateRange(range: Range): Range {
		// We need to recreate `vscode.TextDocument.validatePosition()`

		// Validate the start and end positions separately
		const start = this.positionAt(this.textDocument.offsetAt(range.start));
		const end = this.positionAt(this.textDocument.offsetAt(range.end));

		// Convert the validated positions back to a `vscode.Range`
		return new Range(start, end);
	}

	validatePosition(position: Position): Position {
		// We need to recreate `vscode.TextDocument.validatePosition()`

		// We can leverage the validation in the `offsetAt` method
		const validOffset = this.textDocument.offsetAt(position);

		// Convert the offset back to a position and turn it into a `vscode.Position`
		const pos = this.textDocument.positionAt(validOffset);
		return new Position(pos.line, pos.character);
	}
}

/*
    This is the default word definition regex used by VSCode.

    `(-?\d*\.\d\w*)`
    - Floating point numbers
    - Matches `.1`, `-5.4f`, `123.0HelloWorld`

    `([^\`\~\!\@\#\$\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)`
    - This ignores the printable ASCII characters except for "_"
    - Basically just `[a-zA-Z_]`
    - Matches `Hello_World`

    See: https://github.com/microsoft/vscode/blob/d718ff4ef98365abe53739bde33044a326a98f29/src/vs/editor/common/core/wordHelper.ts#L35C4-L35C92
*/
// eslint-disable-next-line no-useless-escape
const DEFAULT_WORD_REGEXP = /(-?\d*\.\d\w*)|([^\`\~\!\@\#\$\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g;
