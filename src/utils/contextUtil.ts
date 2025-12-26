import { CancellationToken, CharacterPair, Position, Range, TextDocument, Uri, workspace, WorkspaceConfiguration } from "vscode";
import { COMPONENT_EXT, isScriptComponent } from "../entities/component";
import { parseTags, Tag, TagContext } from "../entities/tag";
import { cfmlCommentRules, CommentContext, CommentType } from "../features/comment";
import { DocumentStateContext } from "./documentUtil";
import { equalsIgnoreCase } from "./textUtil";
import { stringArrayIncludesIgnoreCase } from "./collections";
import { Utils } from "vscode-uri";
import { some } from "micromatch";

const CFM_FILE_EXTS: string[] = [".cfm", ".cfml"];
const CFS_FILE_EXTS: string[] = [".cfs"];
export const APPLICATION_CFM_GLOB: string = "**/Application.cfm";
export const APPLICATION_CFM: string = "Application.cfm";
export const APPLICATION_CFC: string = "Application.cfc";
export const SERVER_CFC: string = "Server.cfc";
// const notContinuingExpressionPattern: RegExp = /(?:^|[^\w$.\s])\s*$/;
const continuingExpressionPattern: RegExp = /(?:\?\.\s*|\.\s*|::\s*|[\w$])$/;
const memberExpressionPattern: RegExp = /(?:\?\.|\.|::)$/;
const cfscriptTagPattern: RegExp = /((?:<cfscript\b\s*)(?:[^>]*?)(?:>)|(?:<\/cfscript>))/gi;
const tagCommentPattern: RegExp = /(<!---)|(--->)/g;
const scriptCommentPattern = /(\/\*)|(\*\/)|(\/\/(?:[^\n\r]*))/g;

const characterPairs: CharacterPair[] = [
	["{", "}"],
	["[", "]"],
	["(", ")"],
	["\"", "\""],
	["'", "'"],
	["#", "#"],
	["<", ">"],
];

const NEW_LINE = "\n".charCodeAt(0);
const LEFT_PAREN = "(".charCodeAt(0);
const RIGHT_PAREN = ")".charCodeAt(0);
const SINGLE_QUOTE = "'".charCodeAt(0);
const DOUBLE_QUOTE = "\"".charCodeAt(0);
const HASH = "#".charCodeAt(0);
const CLOSE_TAG_DELIM = ">".charCodeAt(0);

const BOF = 0;

const identPattern = /[$A-Za-z_][$\w]*/;
const identPartPattern = /[$\w]/;

export interface StringContext {
	inString: boolean;
	activeStringDelimiter?: string;
	activeCharCodeDelimiter?: number;
	start?: Position;
	embeddedCFML: boolean;
	embeddedCFMLStartPosition?: Position;
}

export interface DocumentContextRanges {
	commentRanges: Range[];
	stringRanges?: Range[];
	stringEmbeddedCfmlRanges?: Range[];
}

export class BackwardIterator {
	private documentStateContext: DocumentStateContext;
	private lineNumber: number;
	private lineCharacterOffset: number;
	private lineText: string;

	/**
	 *
	 * @param documentStateContext document state context
	 * @param position position
	 * @param _token
	 */
	constructor(documentStateContext: DocumentStateContext, position: Position, _token: CancellationToken | undefined) {
		this.documentStateContext = documentStateContext;
		this.lineNumber = position.line;
		this.lineCharacterOffset = position.character;
		this.lineText = this.getLineText(_token);
	}

	/**
	 * Returns whether there is another character
	 * @returns boolean
	 */
	public hasNext(): boolean {
		return this.lineNumber >= 0;
	}

	/**
	 * Gets the next character code
	 * @param _token
	 * @returns
	 */
	public next(_token: CancellationToken | undefined): number {
		if (this.lineCharacterOffset < 0) {
			this.lineNumber--;
			if (this.lineNumber >= 0) {
				this.lineText = this.getLineText(_token);
				this.lineCharacterOffset = this.lineText.length - 1;
				return NEW_LINE;
			}

			return BOF;
		}

		const charCode: number = this.lineText.charCodeAt(this.lineCharacterOffset);
		this.lineCharacterOffset--;
		return charCode;
	}

	/**
	 * Gets current position in iterator
	 * @returns Position
	 */
	public getPosition(): Position | undefined {
		let lineNumber = this.lineNumber;
		let lineCharacterOffset = this.lineCharacterOffset;
		if (lineCharacterOffset < 0) {
			lineNumber--;
			if (lineNumber >= 0) {
				const document: TextDocument = this.getDocument();
				const lineRange: Range = document.lineAt(lineNumber).range;
				const lineText: string = this.documentStateContext.sanitizedDocumentText.slice(document.offsetAt(lineRange.start), document.offsetAt(lineRange.end));
				lineCharacterOffset = lineText.length - 1;
			}
			else {
				return undefined;
			}
		}

		if (lineCharacterOffset < 0) {
			return undefined;
		}

		return new Position(lineNumber, lineCharacterOffset);
	}

	/**
	 * Sets a position in iterator
	 * @param newPosition Sets a new position for the iterator
	 * @param _token
	 */
	public setPosition(newPosition: Position, _token: CancellationToken | undefined): void {
		if (this.lineNumber !== newPosition.line) {
			this.lineNumber = newPosition.line;
			this.lineText = this.getLineText(_token);
		}
		this.lineCharacterOffset = newPosition.character;
	}

	/**
	 * Gets document
	 * @returns
	 */
	public getDocument(): TextDocument {
		return this.documentStateContext.document;
	}

	/**
	 * Gets documentStateContext
	 * @returns
	 */
	public getDocumentStateContext(): DocumentStateContext {
		return this.documentStateContext;
	}

	/**
	 * Gets the current line text
	 * @param _token
	 * @returns
	 */
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	private getLineText(_token: CancellationToken | undefined): string {
		const document: TextDocument = this.getDocument();
		const lineRange: Range = document.lineAt(this.lineNumber).range;
		return this.documentStateContext.sanitizedDocumentText.slice(document.offsetAt(lineRange.start), document.offsetAt(lineRange.end));
	}
}

/**
 * Checks whether the given document is a CFM file
 * @param document The document to check
 * @param _token
 * @returns
 */

/**
 *
 * @param document
 * @returns
 */
export function isCfmFile(document: TextDocument): boolean {
	const extensionName: string = Utils.extname(Uri.parse(document.fileName));
	for (const currExt of CFM_FILE_EXTS) {
		if (equalsIgnoreCase(extensionName, currExt)) {
			return true;
		}
	}
	return false;
}

/**
 * Checks whether the given document is an Application.cfm file
 * @param uri the uri to check
 * @returns true if the document is an Application.cfm file
 */
export function isApplicationFile(uri: Uri): boolean {
	const fileName = Utils.basename(uri);
	return (fileName === APPLICATION_CFM || fileName === APPLICATION_CFC) ? true : false;
}

/**
 * Checks whether the given document is an Application.cfm file
 * @param uri the uri to check
 * @returns true if the document is an Application.cfm file
 */
export function isServerFile(uri: Uri): boolean {
	const fileName = Utils.basename(uri);
	return (fileName === SERVER_CFC) ? true : false;
}

/**
 * Returns true if the file extension is a CFS file
 * @param document
 * @param _token
 * @returns
 */

/**
 *
 * @param document
 * @returns
 */
export function isCfsFile(document: TextDocument): boolean {
	const extensionName: string = Utils.extname(Uri.parse(document.fileName));
	for (const currExt of CFS_FILE_EXTS) {
		if (equalsIgnoreCase(extensionName, currExt)) {
			return true;
		}
	}
	return false;
}

/**
 * Checks whether the given document is a CFC file
 * @param document The document to check
 * @returns
 */
export function isCfcFile(document: TextDocument): boolean {
	return isCfcUri(document.uri);
}

/**
 * Checks whether the given URI represents a CFC file
 * @param uri The URI to check
 * @returns
 */
export function isCfcUri(uri: Uri): boolean {
	const extensionName = Utils.extname(uri);
	return equalsIgnoreCase(extensionName, COMPONENT_EXT);
}

/**
 * Returns all of the ranges in which tagged cfscript is active
 * @param document The document to check
 * @param range Optional range within which to check
 * @param _token cancellation token prevents the regex from excuting if cancelled
 * @param commentRanges check start and end tags are not inside the passed comment ranges
 * @param excludeTags exclude the cfscript tags from the ranges, false is the current and default behaviuor
 * @param stopAfterPosition
 * @returns
 */
export function getCfScriptRanges(document: TextDocument, range: Range | undefined, _token: CancellationToken | undefined, commentRanges: Range[] = [], excludeTags: boolean = false, stopAfterPosition?: Position): Range[] {
	const ranges: Range[] = [];
	const validRange = range && document.validateRange(range);
	const documentText = validRange ? document.getText(range) : document.getText();
	const textOffset = validRange ? document.offsetAt(range.start) : 0;
	let match: RegExpExecArray | null;
	let startOffset: number | undefined;
	let startLength: number | undefined;

	while ((match = cfscriptTagPattern.exec(documentText)) !== null) {
		if (_token?.isCancellationRequested) {
			return ranges;
		}
		const matchPosition: Position = document.positionAt(textOffset + match.index);
		let inComment: boolean = false;

		for (const commentRange of commentRanges) {
			if (commentRange.contains(matchPosition)) {
				inComment = true;
				break;
			}
			if (matchPosition.isBefore(commentRange.start)) break;
		}

		if (!inComment) {
			// charCode 47 is forward slash '/'
			if (match[0].charCodeAt(1) === 47) { // '</cfscript>'
				if (startOffset !== undefined) {
					const startPosition: Position = document.positionAt(textOffset + startOffset + (excludeTags && startLength !== undefined ? startLength : 0));
					const endPosition = document.positionAt(textOffset + match.index + (excludeTags ? 0 : match[0].length));
					const range = new Range(
						startPosition,
						endPosition,
					);
					ranges.push(range);
					// We don't need to keep going if the close comment is after the stopAfterPosition ( ie. current cursor )
					if (stopAfterPosition?.isBefore(range.end)) {
						return ranges;
					}
					startOffset = undefined;
					startLength = undefined;
				}
			}
			else {
				startOffset = match.index;
				startLength = match[0].length;
			}
		}
	}

	return ranges;
}

/**
 * Returns ranges for document context such as comments and strings
 * @param document The document to check
 * @param isScript Whether the document or given range is CFScript
 * @param docRange Range within which to check
 * @param fast Whether to choose the faster but less accurate method
 * @param _token
 * @param exclDocumentRanges
 * @returns
 */
export function getDocumentContextRanges(document: TextDocument, isScript: boolean = false, docRange: Range | undefined, fast: boolean = false, _token: CancellationToken | undefined, exclDocumentRanges: boolean = false): DocumentContextRanges {
	const startTime = performance.now();

	if (fast) {
		const fastEndTime = performance.now();

		const fastresult = {
			commentRanges: getCommentRanges(document, isScript, docRange, _token),
			stringRanges: undefined,
			stringEmbeddedCfmlRanges: undefined,
		};

		console.info(`getDocumentContextRanges (fast) on ${document.fileName} took ${(fastEndTime - startTime).toFixed(2)}ms`);

		return fastresult;
	}

	if (exclDocumentRanges) {
		return { commentRanges: [], stringRanges: undefined, stringEmbeddedCfmlRanges: undefined };
	}

	const result = getCommentAndStringRangesIterated(document, isScript, docRange, _token);

	const endTime = performance.now();

	console.info(`getDocumentContextRanges on ${document.fileName} took ${(endTime - startTime).toFixed(2)}ms`);

	return result;
}

/**
 * Returns all of the ranges for comments based on regular expression searches
 * @param document The document to check
 * @param isScript Whether the document or given range is CFScript
 * @param docRange Range within which to check
 * @param _token
 * @returns
 */

function getCommentRanges(document: TextDocument, isScript: boolean = false, docRange: Range | undefined, _token: CancellationToken | undefined): Range[] {
	let commentRanges: Range[] = [];

	if (isScript) {
		const scriptCommentRanges: Range[] = getScriptCommentRanges(document, docRange, _token);
		commentRanges = commentRanges.concat(scriptCommentRanges);
	}
	else {
		const tagCommentRanges: Range[] = getTagCommentRanges(document, docRange, _token);
		commentRanges = commentRanges.concat(tagCommentRanges);

		const cfScriptRanges: Range[] = getCfScriptRanges(document, docRange, _token, commentRanges);
		cfScriptRanges.forEach((range: Range) => {
			const cfscriptCommentRanges: Range[] = getScriptCommentRanges(document, range, _token);
			commentRanges = commentRanges.concat(cfscriptCommentRanges);
		});
	}

	return commentRanges;
}

/**
 * Returns ranges for nested script-based comments.
 * @param document The document to check.
 * @param docRange Range within which to check.
 * @param _token A cancellation token.
 * @returns An array of comment ranges.
 */
export function getScriptCommentRanges(document: TextDocument, docRange: Range | undefined, _token: CancellationToken | undefined): Range[] {
	const commentRanges: Range[] = [];
	const validRange = docRange && document.validateRange(docRange);
	const documentText = validRange ? document.getText(docRange) : document.getText();
	const textOffset = validRange ? document.offsetAt(docRange.start) : 0;

	let match: RegExpExecArray | null;
	let startOffset: number | undefined;
	let inBlockComment = false;

	while ((match = scriptCommentPattern.exec(documentText)) !== null) {
		if (_token?.isCancellationRequested) {
			return commentRanges;
		}
		if (match[1]) { // '/*'
			if (inBlockComment !== true) {
				startOffset = match.index;
				inBlockComment = true;
			}
		}
		else if (match[2]) { // '*/'
			if (inBlockComment === true && startOffset !== undefined) {
				const range = new Range(
					document.positionAt(textOffset + startOffset),
					document.positionAt(textOffset + match.index + match[2].length)
				);
				commentRanges.push(range);
				startOffset = undefined;
				inBlockComment = false;
			}
		}
		else if (match[3] && inBlockComment !== true) { // '//'
			startOffset = match.index;
			const range = new Range(
				document.positionAt(textOffset + startOffset),
				document.positionAt(textOffset + match.index + match[3].length)
			);
			startOffset = undefined;
			commentRanges.push(range);
		}
	}

	return commentRanges;
}

/**
 * Returns ranges for nested comments <!--- --->
 * using regex to find startComment and endComment text.
 * @param document text document
 * @param docRange search only a specific range
 * @param _token cancellation token
 * @param stopAfterPosition search until the close comment is before the stopAfterPosition
 * @returns
 */
export function getTagCommentRanges(document: TextDocument, docRange: Range | undefined, _token: CancellationToken | undefined, stopAfterPosition?: Position): Range[] {
	const commentRanges: Range[] = [];
	const documentText = docRange ? document.getText(docRange) : document.getText();
	const textOffset = docRange ? document.offsetAt(docRange.start) : 0;

	let match: RegExpExecArray | null;
	let depth = 0;
	let startOffset: number | undefined;

	while ((match = tagCommentPattern.exec(documentText)) !== null) {
		if (match[1]) { // <!---
			if (depth === 0) {
				startOffset = match.index;
			}
			depth++;
		}
		else { // --->
			depth--;
			if (depth === 0 && startOffset !== undefined) {
				const endOffset = match.index + 4; // 4 = length of "--->"
				const range = new Range(
					document.positionAt(textOffset + startOffset),
					document.positionAt(textOffset + endOffset)
				);
				commentRanges.push(range);
				if (stopAfterPosition?.isBefore(range.end)) {
					return commentRanges;
				}
				startOffset = undefined;
			}
		}
	}

	return commentRanges;
}

/**
 * Returns all of the ranges for comments based on iteration. Much slower than regex, but more accurate since it ignores string contents.
 * @param document The document to check
 * @param isScript Whether the document or given range is CFScript
 * @param docRange Range within which to check
 * @param _token
 * @returns
 */
function getCommentAndStringRangesIterated(document: TextDocument, isScript: boolean = false, docRange: Range | undefined, _token: CancellationToken | undefined): DocumentContextRanges {
	const commentRanges: Range[] = [];
	const stringRanges: Range[] = [];
	const documentText: string = document.getText();
	let textOffsetStart: number = 0;
	let textOffsetEnd: number = documentText.length;
	if (docRange && document.validateRange(docRange)) {
		textOffsetStart = document.offsetAt(docRange.start);
		textOffsetEnd = document.offsetAt(docRange.end);
	}

	let commentContext: CommentContext = {
		inComment: false,
		activeComment: undefined,
		commentType: undefined,
		start: undefined,
		depth: 0,
	};

	let lineText: string = "";
	let lineLen: number = 0;

	const stringContext: StringContext = {
		inString: false,
		activeStringDelimiter: undefined,
		activeCharCodeDelimiter: undefined,
		start: undefined,
		embeddedCFML: false,
		embeddedCFMLStartPosition: undefined,
	};

	const tagContext: TagContext = {
		inStartTag: false,
		inEndTag: false,
		name: undefined,
		startOffset: undefined,
	};

	const stringEmbeddedCFMLRanges: Range[] = [];
	const scriptLineComment = cfmlCommentRules.scriptLineComment;
	const scriptBlockComment = cfmlCommentRules.scriptBlockComment;
	const tagBlockComment = cfmlCommentRules.tagBlockComment;

	let charCodeAtNextPosition: number = 0;
	let hashEscaped: boolean = false;
	let quoteEscaped: boolean = false;
	let newDepth: number = 0;
	let currentLine = 0;
	let currentChar = 0;
	let prevLine = 0;
	let prevChar = 0;
	let position: Position | undefined;
	let tagName: string = "";
	let characterAtPosition: string = "";
	let charCodeAtPosition: number = 0;

	// TODO: Account for code delimited by hashes within cfoutput, cfmail, cfquery, etc. blocks

	for (let offset = textOffsetStart; offset < textOffsetEnd; offset++) {
		charCodeAtPosition = documentText.charCodeAt(offset);
		characterAtPosition = String.fromCharCode(charCodeAtPosition);
		// Handle newline: close line comments and update position tracking
		if (charCodeAtPosition === NEW_LINE) {
			if (commentContext.inComment && commentContext.commentType === CommentType.Line && commentContext.start) {
				commentRanges.push(new Range(commentContext.start, new Position(currentLine, currentChar)));
				commentContext = {
					inComment: false,
					activeComment: undefined,
					commentType: undefined,
					start: undefined,
					depth: 0,
				};
			}
			prevLine = currentLine;
			prevChar = currentChar;
			currentLine++;
			currentChar = 0;
			lineText = "";
			lineLen = 0;
			continue;
		}
		else {
			lineText += characterAtPosition;
			lineLen++;
		}

		if (commentContext.inComment) {
			// Check for end of block comment
			if (commentContext.commentType === CommentType.Block && commentContext.activeComment && lineLen >= 2 && lineText.endsWith(commentContext.activeComment[1])) {
				if (commentContext.depth > 1) {
					commentContext.depth--;
				}
				else {
					if (commentContext.start) {
						commentRanges.push(new Range(commentContext.start, document.positionAt(offset + 1)));
						commentContext = {
							inComment: false,
							activeComment: undefined,
							commentType: undefined,
							start: undefined,
							depth: 0,
						};
					}
				}
			}
			// Handle the edge case of a line comment on the last line of the document
			else if (commentContext.start && commentContext.commentType === CommentType.Line && offset === textOffsetEnd - 1) {
				const rangeLengthFix = charCodeAtPosition === NEW_LINE ? 0 : 1;
				commentRanges.push(new Range(commentContext.start, new Position(currentLine, currentChar + rangeLengthFix)));
			}
		}
		else if (stringContext.inString) {
			if (charCodeAtPosition === HASH) {
				if (stringContext.embeddedCFML) {
					stringContext.embeddedCFML = false;
					if (stringContext.embeddedCFMLStartPosition) {
						stringEmbeddedCFMLRanges.push(new Range(stringContext.embeddedCFMLStartPosition, document.positionAt(offset + 1)));
					}
					stringContext.embeddedCFMLStartPosition = undefined;
				}
				else {
					charCodeAtNextPosition = documentText.charCodeAt(offset + 1);
					hashEscaped = charCodeAtNextPosition === HASH;

					if (hashEscaped) {
						offset++;
						lineText += String.fromCharCode(charCodeAtNextPosition);
						lineLen++;
						currentChar++;
					}
					else {
						stringContext.embeddedCFML = true;
						stringContext.embeddedCFMLStartPosition = new Position(currentLine, currentChar);
					}
				}
			}
			else if (!stringContext.embeddedCFML && charCodeAtPosition === stringContext.activeCharCodeDelimiter) {
				charCodeAtNextPosition = documentText.charCodeAt(offset + 1);
				quoteEscaped = charCodeAtNextPosition === stringContext.activeCharCodeDelimiter;

				if (quoteEscaped) {
					offset++;
					lineText += String.fromCharCode(charCodeAtNextPosition);
					lineLen++;
					currentChar++;
				}
				else {
					if (stringContext.start) {
						stringRanges.push(new Range(stringContext.start, document.positionAt(offset + 1)));
						stringContext.inString = false;
						stringContext.activeStringDelimiter = undefined;
						stringContext.activeCharCodeDelimiter = undefined;
						stringContext.start = undefined;
						stringContext.embeddedCFML = false;
					}
				}
			}
		}
		else {
			if (isScript) {
				if (charCodeAtPosition === SINGLE_QUOTE || charCodeAtPosition === DOUBLE_QUOTE) {
					stringContext.inString = true;
					stringContext.activeStringDelimiter = characterAtPosition;
					stringContext.activeCharCodeDelimiter = charCodeAtPosition;
					stringContext.start = new Position(currentLine, currentChar);
					stringContext.embeddedCFML = false;
				}
				// For "/*" or "//" check
				else if (lineLen >= 2 && lineText.charCodeAt(lineLen - 2) === 47) {
					// Comments not in tag block
					if (commentContext.activeComment !== tagBlockComment) {
						// For "//" check
						if (lineText.charCodeAt(lineLen - 1) === 47) {
							newDepth = commentContext.depth + 1;
							commentContext = {
								inComment: true,
								activeComment: scriptLineComment,
								commentType: CommentType.Line,
								start: new Position(prevLine, prevChar),
								depth: newDepth,
							};
						}
						// For "/*" check
						else if (lineText.charCodeAt(lineLen - 1) === 42) {
							newDepth = commentContext.depth + 1;
							commentContext = {
								inComment: true,
								activeComment: scriptBlockComment,
								commentType: CommentType.Block,
								start: new Position(prevLine, prevChar),
								depth: newDepth,
							};
						}
					}
				}
			}
			else if (lineLen >= 5
				&& lineText.charCodeAt(lineLen - 5) === 60 // <
				&& lineText.charCodeAt(lineLen - 4) === 33 // !
				&& lineText.charCodeAt(lineLen - 3) === 45 // -
				&& lineText.charCodeAt(lineLen - 2) === 45 // -
				&& lineText.charCodeAt(lineLen - 1) === 45) {
				newDepth = commentContext.depth + 1;
				if (newDepth > 1) {
					commentContext.depth = newDepth;
				}
				else {
					commentContext = {
						inComment: true,
						activeComment: tagBlockComment,
						commentType: CommentType.Block,
						start: new Position(currentLine, currentChar + 1 - tagBlockComment[0].length),
						depth: newDepth,
					};
				}
			}
			else if (tagContext.inStartTag) {
				if (charCodeAtPosition === CLOSE_TAG_DELIM) {
					tagContext.inStartTag = false;
					tagContext.inEndTag = false;
					tagContext.name = undefined;
					tagContext.startOffset = undefined;
				}
				else if (charCodeAtPosition === SINGLE_QUOTE || charCodeAtPosition === DOUBLE_QUOTE) {
					stringContext.inString = true;
					stringContext.activeStringDelimiter = characterAtPosition;
					stringContext.activeCharCodeDelimiter = charCodeAtPosition;
					stringContext.start = new Position(currentLine, currentChar);
					stringContext.embeddedCFML = false;
				}
			}
			else if (lineLen >= 3
				&& lineText.charCodeAt(lineLen - 3) === 60 // <
				&& lineText.charCodeAt(lineLen - 2) === 99 // c
				&& lineText.charCodeAt(lineLen - 1) === 102) { // f
				position = new Position(currentLine, currentChar);
				tagName = document.getText(document.getWordRangeAtPosition(position));
				tagContext.inStartTag = true;
				tagContext.inEndTag = false;
				tagContext.name = tagName;
				tagContext.startOffset = offset - 2;
			}
		}

		prevLine = currentLine;
		prevChar = currentChar;
		currentChar++;
	}

	let cfScriptRanges: Range[] = [];
	if (!isScript) {
		cfScriptRanges = getCfScriptRanges(document, docRange, _token, commentRanges);
	}

	if (cfScriptRanges.length > 0) {
		// Remove tag comments found within CFScripts
		// commentRanges = commentRanges.filter((range: Range) => {
		//   return !isInRanges(cfScriptRanges, range, false, _token);
		// });

		cfScriptRanges.forEach((range: Range) => {
			if (!isInRanges(commentRanges, range, false, _token)) {
				const cfscriptContextRanges: DocumentContextRanges = getCommentAndStringRangesIterated(document, true, range, _token);
				commentRanges.push(...cfscriptContextRanges.commentRanges);
				if (cfscriptContextRanges.stringRanges) {
					stringRanges.push(...cfscriptContextRanges.stringRanges);
				}
			}
		});
	}

	return { commentRanges: commentRanges, stringRanges: stringRanges, stringEmbeddedCfmlRanges: stringEmbeddedCFMLRanges };
}

/**
 * Returns all of the ranges in which there is JavaScript
 * @param documentStateContext The context information for the TextDocument to check
 * @param range Optional range within which to check
 * @param _token
 * @returns
 */
export function getJavaScriptRanges(documentStateContext: DocumentStateContext, range: Range | undefined, _token: CancellationToken | undefined): Range[] {
	const scriptTags: Tag[] = parseTags(documentStateContext, "script", range, _token);

	return scriptTags.map((tag: Tag) => tag.bodyRange).filter((range): range is Range => range !== undefined);
}

/**
 * Returns all of the ranges in which there is CSS in style tags. Does not consider style attributes.
 * @param documentStateContext The context information for the TextDocument to check
 * @param range Optional range within which to check
 * @param _token
 * @returns
 */
export function getCssRanges(documentStateContext: DocumentStateContext, range: Range | undefined, _token: CancellationToken | undefined): Range[] {
	const styleTags: Tag[] = parseTags(documentStateContext, "style", range, _token);

	return styleTags.map((tag: Tag) => tag.bodyRange).filter((range): range is Range => range !== undefined);
}

/**
 * Returns all of the ranges in which tagged cfoutput is active.
 * @param documentStateContext The context information for the TextDocument to check
 * @param range Optional range within which to check
 * @param _token
 * @returns
 */
export function getCfOutputRanges(documentStateContext: DocumentStateContext, range: Range | undefined, _token: CancellationToken | undefined): Range[] {
	const cfoutputTags: Tag[] = parseTags(documentStateContext, "cfoutput", range, _token);

	return cfoutputTags.map((tag: Tag) => tag.bodyRange).filter((range): range is Range => range !== undefined);
}

/**
 * Returns whether the given position is within a cfoutput block
 * @param documentStateContext The context information for the TextDocument to check
 * @param position Position at which to check
 * @param _token
 * @returns
 */
export function isInCfOutput(documentStateContext: DocumentStateContext, position: Position, _token: CancellationToken | undefined): boolean {
	return isInRanges(getCfOutputRanges(documentStateContext, undefined, _token), position, false, _token);
}

/**
 * Returns whether the given position is within a CFScript block
 * @param document The document to check
 * @param position Position at which to check
 * @param _token
 * @param commentRanges
 * @param excludeTags
 * @returns
 */
export function isInCfScript(document: TextDocument, position: Position, _token: CancellationToken | undefined, commentRanges: Range[], excludeTags: boolean = false): boolean {
	return isInRanges(getCfScriptRanges(document, undefined, _token, commentRanges, excludeTags), position, false, _token);
}

/**
 * Returns whether the given position is in a CFScript context
 * @param document The document to check
 * @param position Position at which to check
 * @param _token
 * @param commentRanges
 * @returns
 */
export function isPositionScript(document: TextDocument, position: Position, _token: CancellationToken | undefined, commentRanges: Range[]): boolean {
	return (isScriptComponent(document) || isInCfScript(document, position, _token, commentRanges));
}

/**
 * Returns whether the given position is within a JavaScript block
 * @param documentStateContext The context information for the TextDocument to check
 * @param position Position at which to check
 * @param _token
 * @returns
 */
export function isInJavaScript(documentStateContext: DocumentStateContext, position: Position, _token: CancellationToken | undefined): boolean {
	return isInRanges(getJavaScriptRanges(documentStateContext, undefined, _token), position, false, _token);
}

/**
 * Returns whether the given position is within a JavaScript block
 * @param documentStateContext The context information for the TextDocument to check
 * @param position Position at which to check
 * @param _token
 * @returns
 */
export function isInCss(documentStateContext: DocumentStateContext, position: Position, _token: CancellationToken | undefined): boolean {
	return isInRanges(getCssRanges(documentStateContext, undefined, _token), position, false, _token);
}

/**
 * Returns whether the given position is within a comment
 * @param document The document to check
 * @param position Position at which to check
 * @param isScript Whether the document is CFScript
 * @param _token
 * @returns
 */
export function isInComment(document: TextDocument, position: Position, isScript: boolean = false, _token: CancellationToken | undefined): boolean {
	return isInRanges(getDocumentContextRanges(document, isScript, undefined, false, _token).commentRanges, position, true, _token);
}

/**
 * Returns whether the given position is within a set of ranges
 * @param ranges The set of ranges within which to check
 * @param positionOrRange Position or range to check
 * @param ignoreEnds Whether to ignore `start` and `end` in `ranges` when `positionOrRange` is `Position`
 * @param _token
 * @returns
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function isInRanges(ranges: Range[], positionOrRange: Position | Range, ignoreEnds: boolean = false, _token: CancellationToken | undefined): boolean {
	return ranges.some((range: Range) => {
		let isContained: boolean = range.contains(positionOrRange);
		if (ignoreEnds) {
			if (positionOrRange instanceof Position) {
				isContained = isContained && !range.start.isEqual(positionOrRange) && !range.end.isEqual(positionOrRange);
			}
		}
		return isContained;
	});
}

/**
 * Returns an array of ranges inverted from given ranges
 * @param document The document to check
 * @param ranges Ranges to invert
 * @returns
 */
export function invertRanges(document: TextDocument, ranges: Range[]): Range[] {
	const invertedRanges: Range[] = [];

	const documentEndPosition: Position = document.positionAt(document.getText().length);
	let previousEndPosition: Position = new Position(0, 0);
	ranges.forEach((range: Range) => {
		if (previousEndPosition.isEqual(range.start)) {
			previousEndPosition = range.end;
			return;
		}

		invertedRanges.push(new Range(
			previousEndPosition,
			range.start
		));
	});
	if (!previousEndPosition.isEqual(documentEndPosition)) {
		invertedRanges.push(new Range(
			previousEndPosition,
			documentEndPosition
		));
	}

	return invertedRanges;
}

/**
 * Returns if the given prefix is part of a continuing expression
 * @param prefix Prefix to the current position
 * @param _token
 * @returns
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function isContinuingExpression(prefix: string, _token: CancellationToken | undefined): boolean {
	return continuingExpressionPattern.test(prefix);
}

/**
 * Returns if the given prefix is part of a continuing expression
 * @param prefix Prefix to the current position
 * @returns
 */
export function isMemberExpression(prefix: string): boolean {
	return memberExpressionPattern.test(prefix);
}

/**
 * Given a character, gets its respective character pair
 * @param character Either character in a character pair
 * @returns
 */
function getCharacterPair(character: string): CharacterPair | undefined {
	return characterPairs.find((charPair: CharacterPair) => {
		return (charPair[0] === character || charPair[1] === character);
	});
}

/**
 * Gets the opening character in a character pair
 * @param closingChar The closing character in a pair
 * @returns
 */
function getOpeningChar(closingChar: string): string {
	const characterPair: CharacterPair | undefined = getCharacterPair(closingChar);

	if (!characterPair) {
		return "";
	}

	return characterPair[0];
}

/**
 * Determines the position at which the given opening character occurs after the given position immediately following the opening character
 * @param documentStateContext The context information for the TextDocument to check
 * @param startOffset A numeric offset representing the position in the document from which to start
 * @param endOffset A numeric offset representing the last position in the document that should be checked
 * @param char The character(s) for which to check
 * @param includeChar Whether the returned position should include the character found
 * @param _token
 * @returns
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getNextCharacterPosition(documentStateContext: DocumentStateContext, startOffset: number, endOffset: number, char: string | string[], includeChar: boolean = true, _token: CancellationToken | undefined): Position {
	const document: TextDocument = documentStateContext.document;
	const documentText: string = documentStateContext.sanitizedDocumentText;
	let stringContext: StringContext = {
		inString: false,
		activeStringDelimiter: undefined,
		start: undefined,
		embeddedCFML: false,
	};
	const embeddedCFMLDelimiter: string = "#";
	const aposChar = "'";
	const quotChar = "\"";
	const searchChar = Array.isArray(char) ? char : [char];

	const pairContext = [
		// braces
		{
			characterPair: characterPairs[0],
			unclosedPairCount: 0,
		},
		// brackets
		{
			characterPair: characterPairs[1],
			unclosedPairCount: 0,
		},
		// parens
		{
			characterPair: characterPairs[2],
			unclosedPairCount: 0,
		},
	];

	const openingPairs: string[] = pairContext.map(pairItem => pairItem.characterPair[0]).filter(openingChar => !searchChar.includes(openingChar));
	const closingPairs: string[] = pairContext.map(pairItem => pairItem.characterPair[1]);
	const incrementUnclosedPair = (openingChar: string): void => {
		pairContext.filter((pairItem) => {
			return openingChar === pairItem.characterPair[0];
		}).forEach((pairItem) => {
			pairItem.unclosedPairCount++;
		});
	};
	const decrementUnclosedPair = (closingChar: string): void => {
		pairContext.filter((pairItem) => {
			return closingChar === pairItem.characterPair[1];
		}).forEach((pairItem) => {
			pairItem.unclosedPairCount--;
		});
	};
	const hasNoUnclosedPairs = (): boolean => {
		return pairContext.every((pairItem) => {
			return pairItem.unclosedPairCount === 0;
		});
	};

	for (let offset = startOffset; offset < endOffset; offset++) {
		const characterAtPosition: string = documentText.charAt(offset);

		if (stringContext.inString) {
			if (characterAtPosition === embeddedCFMLDelimiter) {
				stringContext.embeddedCFML = !stringContext.embeddedCFML;
			}
			else if (!stringContext.embeddedCFML && characterAtPosition === stringContext.activeStringDelimiter) {
				stringContext = {
					inString: false,
					activeStringDelimiter: undefined,
					start: undefined,
					embeddedCFML: false,
				};
			}
		}
		else if (characterAtPosition === aposChar || characterAtPosition === quotChar) {
			stringContext = {
				inString: true,
				activeStringDelimiter: characterAtPosition,
				start: document.positionAt(offset),
				embeddedCFML: false,
			};
		}
		else if (searchChar.includes(characterAtPosition) && hasNoUnclosedPairs()) {
			if (includeChar) {
				return document.positionAt(offset + 1);
			}
			else {
				return document.positionAt(offset);
			}
		}
		else if (openingPairs.includes(characterAtPosition)) {
			incrementUnclosedPair(characterAtPosition);
		}
		else if (closingPairs.includes(characterAtPosition)) {
			decrementUnclosedPair(characterAtPosition);
		}
	}

	return document.positionAt(endOffset);
}

/**
 * Determines the position at which the given closing character occurs after the given position immediately following the opening character
 * @param documentStateContext The context information for the TextDocument to check
 * @param initialOffset A numeric offset representing the position in the document from which to start
 * @param closingChar The character that denotes the closing
 * @param _token
 * @returns
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getClosingPosition(documentStateContext: DocumentStateContext, initialOffset: number, closingChar: string, _token: CancellationToken | undefined): Position {
	const openingChar = getOpeningChar(closingChar);
	const document: TextDocument = documentStateContext.document;
	const documentText: string = documentStateContext.sanitizedDocumentText;
	const aposChar = "'";
	const quotChar = "\"";
	let unclosedPairs = 0;
	let stringContext: StringContext = {
		inString: false,
		activeStringDelimiter: undefined,
		start: undefined,
		embeddedCFML: false,
	};
	const embeddedCFMLDelimiter: string = "#";

	for (let offset = initialOffset; offset < documentText.length; offset++) {
		const characterAtPosition: string = documentText.charAt(offset);

		if (stringContext.inString) {
			if (characterAtPosition === embeddedCFMLDelimiter) {
				stringContext.embeddedCFML = !stringContext.embeddedCFML;
			}
			else if (!stringContext.embeddedCFML && characterAtPosition === stringContext.activeStringDelimiter) {
				stringContext = {
					inString: false,
					activeStringDelimiter: undefined,
					start: undefined,
					embeddedCFML: false,
				};
			}
		}
		else if (characterAtPosition === aposChar || characterAtPosition === quotChar) {
			stringContext = {
				inString: true,
				activeStringDelimiter: characterAtPosition,
				start: document.positionAt(offset),
				embeddedCFML: false,
			};
		}
		else if (characterAtPosition === openingChar) {
			unclosedPairs++;
		}
		else if (characterAtPosition === closingChar) {
			if (unclosedPairs !== 0) {
				unclosedPairs--;
			}
			else {
				return document.positionAt(offset + 1);
			}
		}
	}

	return document.positionAt(initialOffset);
}

/**
 * Tests whether the given character can be part of a valid CFML identifier
 * @param char Character to test
 * @returns
 */
export function isValidIdentifierPart(char: string): boolean {
	return identPartPattern.test(char);
}

/**
 * Tests whether the given word can be a valid CFML identifier
 * @param word String to test
 * @returns
 */
export function isValidIdentifier(word: string): boolean {
	return identPattern.test(word);
}

/**
 * Returns the range of the word preceding the given position if it is a valid identifier or undefined if invalid
 * @param documentStateContext The document in which to check for the identifier
 * @param position A position at which to start
 * @param _token
 * @returns
 */
export function getPrecedingIdentifierRange(documentStateContext: DocumentStateContext, position: Position, _token: CancellationToken | undefined): Range | undefined {
	let identRange: Range | undefined;
	let charStr = "";
	const iterator: BackwardIterator = new BackwardIterator(documentStateContext, position, _token);
	while (iterator.hasNext()) {
		const ch: number = iterator.next(_token);
		charStr = String.fromCharCode(ch);
		if (/\S/.test(charStr)) {
			break;
		}
	}

	if (isValidIdentifierPart(charStr)) {
		const iterPosition: Position | undefined = iterator.getPosition();
		if (iterPosition) {
			const currentWordRange: Range | undefined = documentStateContext.document.getWordRangeAtPosition(iterPosition);
			if (currentWordRange) {
				const currentWord: string = documentStateContext.document.getText(currentWordRange);
				if (isValidIdentifier(currentWord)) {
					identRange = currentWordRange;
				}
			}
		}
	}

	return identRange;
}

/**
 * Gets an array of arguments including and preceding the currently selected argument
 * @param iterator A BackwardIterator to use to read arguments
 * @param _token
 * @returns
 */
export function getStartSigPosition(iterator: BackwardIterator, _token: CancellationToken | undefined): Position | undefined {
	let parenNesting = 0;

	const documentStateContext: DocumentStateContext = iterator.getDocumentStateContext();
	const document: TextDocument = documentStateContext.document;
	const stringRanges: Range[] | undefined = documentStateContext.stringRanges;
	const stringEmbeddedCfmlRanges: Range[] | undefined = documentStateContext.stringEmbeddedCfmlRanges;

	if (stringRanges === undefined || stringEmbeddedCfmlRanges === undefined) {
		return undefined;
	}
	while (iterator.hasNext()) {
		const ch: number = iterator.next(_token);

		if (stringRanges) {
			const position: Position | undefined = iterator.getPosition();
			if (position === undefined) {
				break;
			}
			const position_translated: Position = position.translate(0, 1);
			const stringRange: Range | undefined = stringRanges.find((range: Range) => {
				return range.contains(position_translated) && !range.end.isEqual(position_translated);
			});
			if (stringRange && !(stringEmbeddedCfmlRanges && isInRanges(stringEmbeddedCfmlRanges, position_translated, true, _token))) {
				iterator.setPosition(stringRange.start.translate(0, -1), _token);
				continue;
			}
		}

		switch (ch) {
			case LEFT_PAREN:
				parenNesting--;
				if (parenNesting < 0) {
					const candidatePosition: Position | undefined = iterator.getPosition();
					while (iterator.hasNext()) {
						const nch: number = iterator.next(_token);
						const charStr = String.fromCharCode(nch);
						if (/\S/.test(charStr)) {
							const iterPos: Position | undefined = iterator.getPosition();
							if (iterPos) {
								if (isValidIdentifierPart(charStr)) {
									const nameRange = document.getWordRangeAtPosition(iterPos);
									const name = document.getText(nameRange);
									if (isValidIdentifier(name) && !stringArrayIncludesIgnoreCase(["function", "if", "for", "while", "switch", "catch"], name)) {
										return candidatePosition;
									}
								}
								iterator.setPosition(iterPos.translate(0, 1), _token);
							}
							parenNesting++;
							break;
						}
					}
				}
				break;
			case RIGHT_PAREN:
				parenNesting++;
				break;
			case DOUBLE_QUOTE:
			case SINGLE_QUOTE:
				// FIXME: If position is within string, this does not work
				while (iterator.hasNext()) {
					const nch: number = iterator.next(_token);
					// find the closing quote or double quote

					// TODO: Ignore if escaped
					if (ch === nch) {
						break;
					}
				}
				break;
		}
	}

	return undefined;
}

/**
 * Checks whether the given document should be excluded from being used.
 * @param documentUri The URI of the document to check against
 * @returns boolean
 */
export function shouldExcludeDocument(documentUri: Uri): boolean {
	const fileSettings: WorkspaceConfiguration = workspace.getConfiguration("files", documentUri);

	const fileExcludes: object = fileSettings.get<object>("exclude", []);
	const fileExcludeGlobs: string[] = [];
	for (let fileExcludeGlob in fileExcludes) {
		if (fileExcludes[fileExcludeGlob]) {
			if (fileExcludeGlob.endsWith("/")) {
				fileExcludeGlob += "**";
			}
			fileExcludeGlobs.push(fileExcludeGlob);
		}
	}

	const relativePath = workspace.asRelativePath(documentUri);

	return some(relativePath, fileExcludeGlobs);
}
