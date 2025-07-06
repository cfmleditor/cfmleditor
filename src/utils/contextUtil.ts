import { CancellationToken, CharacterPair, Position, Range, TextDocument, Uri, workspace, WorkspaceConfiguration } from "vscode";
import { COMPONENT_EXT, isScriptComponent } from "../entities/component";
import { getTagPattern, parseTags, Tag, TagContext } from "../entities/tag";
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
const cfscriptLineCommentPattern: RegExp = /\/\/[^\r\n]*/g;
const cfscriptBlockCommentPattern: RegExp = /\/\*[\s\S]*?\*\//g;

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
const BOF = 0;

const identPattern = /[$A-Za-z_][$\w]*/;
const identPartPattern = /[$\w]/;

export interface StringContext {
	inString: boolean;
	activeStringDelimiter?: string;
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
 * @param _token
 * @param commentRanges
 * @returns
 */
export function getCfScriptRanges(document: TextDocument, range: Range | undefined, _token: CancellationToken | undefined, commentRanges: Range[] = []): Range[] {
	const ranges: Range[] = [];
	let documentText: string;
	let textOffset: number;
	if (range && document.validateRange(range)) {
		documentText = document.getText(range);
		textOffset = document.offsetAt(range.start);
	}
	else {
		documentText = document.getText();
		textOffset = 0;
	}

	const cfscriptTagPattern: RegExp = getTagPattern("cfscript");
	let cfscriptTagMatch: RegExpExecArray | null;
	while ((cfscriptTagMatch = cfscriptTagPattern.exec(documentText))) {
		const prefixLen: number = cfscriptTagMatch[1].length + cfscriptTagMatch[2].length + 1;
		const cfscriptBodyText: string = cfscriptTagMatch[3];
		if (cfscriptBodyText) {
			const cfscriptBodyStartOffset: number = textOffset + cfscriptTagMatch.index + prefixLen;
			const range = new Range(
				document.positionAt(cfscriptBodyStartOffset),
				document.positionAt(cfscriptBodyStartOffset + cfscriptBodyText.length)
			);
			if (!isInRanges(commentRanges, range, false, _token)) {
				ranges.push(range);
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
	if (fast) {
		return { commentRanges: getCommentRangesByRegex(document, isScript, docRange, _token), stringRanges: undefined, stringEmbeddedCfmlRanges: undefined };
	}

	if (exclDocumentRanges) {
		return { commentRanges: [], stringRanges: undefined, stringEmbeddedCfmlRanges: undefined };
	}

	return getCommentAndStringRangesIterated(document, isScript, docRange, _token);
}

/**
 * Returns all of the ranges for comments based on regular expression searches
 * @param document The document to check
 * @param isScript Whether the document or given range is CFScript
 * @param docRange Range within which to check
 * @param _token
 * @returns
 */
function getCommentRangesByRegex(document: TextDocument, isScript: boolean = false, docRange: Range | undefined, _token: CancellationToken | undefined): Range[] {
	let commentRanges: Range[] = [];
	let documentText: string;
	let textOffset: number;
	if (docRange && document.validateRange(docRange)) {
		documentText = document.getText(docRange);
		textOffset = document.offsetAt(docRange.start);
	}
	else {
		documentText = document.getText();
		textOffset = 0;
	}

	if (isScript) {
		let scriptBlockCommentMatch: RegExpExecArray | null;
		while ((scriptBlockCommentMatch = cfscriptBlockCommentPattern.exec(documentText))) {
			const scriptBlockCommentText: string = scriptBlockCommentMatch[0];
			const scriptBlockCommentStartOffset: number = textOffset + scriptBlockCommentMatch.index;
			commentRanges.push(new Range(
				document.positionAt(scriptBlockCommentStartOffset),
				document.positionAt(scriptBlockCommentStartOffset + scriptBlockCommentText.length)
			));
		}

		let scriptLineCommentMatch: RegExpExecArray | null;
		while ((scriptLineCommentMatch = cfscriptLineCommentPattern.exec(documentText))) {
			const scriptLineCommentText = scriptLineCommentMatch[0];
			const scriptLineCommentStartOffset = textOffset + scriptLineCommentMatch.index;
			commentRanges.push(new Range(
				document.positionAt(scriptLineCommentStartOffset),
				document.positionAt(scriptLineCommentStartOffset + scriptLineCommentText.length)
			));
		}
	}
	else {
		const nestedCommentRanges: Range[] = getNestedCommentRanges(document, docRange, _token);
		commentRanges = commentRanges.concat(nestedCommentRanges);

		const cfScriptRanges: Range[] = getCfScriptRanges(document, docRange, _token, commentRanges);
		cfScriptRanges.forEach((range: Range) => {
			const cfscriptCommentRanges: Range[] = getCommentRangesByRegex(document, true, range, _token);
			commentRanges = commentRanges.concat(cfscriptCommentRanges);
		});
	}

	return commentRanges;
}
/**
 * Returns ranges for nested comments <!--- --->
 * using regex to find startComment and endComment text.
 * @param document The document to check
 * @param docRange Range within which to check
 * @param _token
 * @returns
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getNestedCommentRanges(document: TextDocument, docRange: Range | undefined, _token: CancellationToken | undefined): Range[] {
	const commentRanges: Range[] = [];
	const documentText = docRange ? document.getText(docRange) : document.getText();
	const textOffset = docRange ? document.offsetAt(docRange.start) : 0;

	const commentRegex = /<!---|--->/g; // Matches startComment and endComment
	let match: RegExpExecArray | null;
	let depth = 0;
	let startOffset: number | undefined;

	while ((match = commentRegex.exec(documentText)) !== null) {
		if (match[0] === "<!---") {
			if (depth === 0) {
				startOffset = match.index;
			}
			depth++;
		}
		else if (match[0] === "--->") {
			depth--;
			if (depth === 0 && startOffset !== undefined) {
				const range = new Range(
					document.positionAt(textOffset + startOffset),
					document.positionAt(textOffset + match.index + match[0].length)
				);
				commentRanges.push(range);
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
	let commentRanges: Range[] = [];
	let stringRanges: Range[] = [];
	const documentText: string = document.getText();
	let textOffsetStart: number = 0;
	let textOffsetEnd: number = documentText.length;
	let previousPosition: Position | undefined;
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

	let lineText = "";

	let stringContext: StringContext = {
		inString: false,
		activeStringDelimiter: undefined,
		start: undefined,
		embeddedCFML: false,
		embeddedCFMLStartPosition: undefined,
	};

	let tagContext: TagContext = {
		inStartTag: false,
		inEndTag: false,
		name: undefined,
		startOffset: undefined,
	};

	const stringEmbeddedCFMLDelimiter: string = "#";
	const tagOpeningChars: string = "<cf";
	const tagClosingChar: string = ">";
	const stringEmbeddedCFMLRanges: Range[] = [];
	let commentDepth: number = 0;

	// TODO: Account for code delimited by hashes within cfoutput, cfmail, cfquery, etc. blocks

	for (let offset = textOffsetStart; offset < textOffsetEnd; offset++) {
		let position: Position = document.positionAt(offset);
		const characterAtPosition: string = documentText.charAt(offset);

		if (previousPosition && position.line !== previousPosition.line) {
			lineText = "";
		}

		lineText += characterAtPosition;

		if (commentContext.inComment) {
			// Check for end of comment
			if (previousPosition && commentContext.start && commentContext.commentType === CommentType.Line && position.line !== previousPosition.line) {
				commentRanges.push(new Range(commentContext.start, previousPosition));
				commentContext = {
					inComment: false,
					activeComment: undefined,
					commentType: undefined,
					start: undefined,
					depth: 0,
				};
			}
			else if (commentContext.commentType === CommentType.Block && commentContext.activeComment && lineText.endsWith(commentContext.activeComment[1])) {
				if (commentContext.depth > 1) {
					commentDepth = commentContext.depth - 1;
					commentContext.depth = commentDepth;
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
		}
		else if (stringContext.inString) {
			if (characterAtPosition === stringEmbeddedCFMLDelimiter) {
				if (stringContext.embeddedCFML) {
					stringContext.embeddedCFML = false;
					if (stringContext.embeddedCFMLStartPosition) {
						stringEmbeddedCFMLRanges.push(new Range(stringContext.embeddedCFMLStartPosition, document.positionAt(offset + 1)));
					}
					stringContext.embeddedCFMLStartPosition = undefined;
				}
				else {
					let hashEscaped = false;
					let characterAtNextPosition: string = "";
					try {
						characterAtNextPosition = documentText.charAt(offset + 1);
						hashEscaped = characterAtNextPosition === stringEmbeddedCFMLDelimiter;
					}
					// eslint-disable-next-line @typescript-eslint/no-unused-vars
					catch (e) {
						// Keep value
					}

					if (hashEscaped) {
						offset++;
						lineText += characterAtNextPosition;
						position = document.positionAt(offset);
					}
					else {
						stringContext.embeddedCFML = true;
						stringContext.embeddedCFMLStartPosition = position;
					}
				}
			}
			else if (!stringContext.embeddedCFML && characterAtPosition === stringContext.activeStringDelimiter) {
				let quoteEscaped = false;
				let characterAtNextPosition: string = "";
				try {
					characterAtNextPosition = documentText.charAt(offset + 1);
					quoteEscaped = characterAtNextPosition === stringContext.activeStringDelimiter;
				}
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				catch (e) {
					// Keep value
				}

				if (quoteEscaped) {
					offset++;
					lineText += characterAtNextPosition;
					position = document.positionAt(offset);
				}
				else {
					if (stringContext.start) {
						stringRanges.push(new Range(stringContext.start, document.positionAt(offset + 1)));
						stringContext = {
							inString: false,
							activeStringDelimiter: undefined,
							start: undefined,
							embeddedCFML: false,
						};
					}
				}
			}
		}
		else {
			if (isScript) {
				if (characterAtPosition === "'" || characterAtPosition === "\"") {
					stringContext = {
						inString: true,
						activeStringDelimiter: characterAtPosition,
						start: position,
						embeddedCFML: false,
					};
				}
				else if (lineText.endsWith(cfmlCommentRules.scriptLineComment)) {
					// Comments in tag block
					if (commentContext.activeComment !== cfmlCommentRules.tagBlockComment) {
						commentDepth = commentContext.depth + 1;
						commentContext = {
							inComment: true,
							activeComment: cfmlCommentRules.scriptLineComment,
							commentType: CommentType.Line,
							start: previousPosition,
							depth: commentDepth,
						};
					}
				}
				else if (lineText.endsWith(cfmlCommentRules.scriptBlockComment[0])) {
					// Comments in tag block
					if (commentContext.activeComment !== cfmlCommentRules.tagBlockComment) {
						commentDepth = commentContext.depth + 1;
						commentContext = {
							inComment: true,
							activeComment: cfmlCommentRules.scriptBlockComment,
							commentType: CommentType.Block,
							start: previousPosition,
							depth: commentDepth,
						};
					}
				}
			}
			else if (lineText.endsWith(cfmlCommentRules.tagBlockComment[0])) {
				commentDepth = commentContext.depth + 1;
				if (commentDepth > 1) {
					commentContext.depth = commentDepth;
				}
				else {
					commentContext = {
						inComment: true,
						activeComment: cfmlCommentRules.tagBlockComment,
						commentType: CommentType.Block,
						start: position.translate(0, 1 - cfmlCommentRules.tagBlockComment[0].length),
						depth: commentDepth,
					};
				}
			}
			else if (tagContext.inStartTag) {
				if (characterAtPosition === tagClosingChar) {
					tagContext = {
						inStartTag: false,
						inEndTag: false,
						name: undefined,
						startOffset: undefined,
					};
				}
				else if (characterAtPosition === "'" || characterAtPosition === "\"") {
					stringContext = {
						inString: true,
						activeStringDelimiter: characterAtPosition,
						start: document.positionAt(offset),
						embeddedCFML: false,
					};
				}
			}
			else if (lineText.endsWith(tagOpeningChars)) {
				const tagName = document.getText(document.getWordRangeAtPosition(position));
				tagContext = {
					inStartTag: true,
					inEndTag: false,
					name: tagName,
					startOffset: offset - 2,
				};
			}
		}

		previousPosition = position;
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
				commentRanges = commentRanges.concat(cfscriptContextRanges.commentRanges);
				if (cfscriptContextRanges.stringRanges) {
					stringRanges = stringRanges.concat(cfscriptContextRanges.stringRanges);
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
 * @returns
 */
export function isInCfScript(document: TextDocument, position: Position, _token: CancellationToken | undefined): boolean {
	return isInRanges(getCfScriptRanges(document, undefined, _token), position, false, _token);
}

/**
 * Returns whether the given position is in a CFScript context
 * @param document The document to check
 * @param position Position at which to check
 * @param _token
 * @returns
 */
export function isPositionScript(document: TextDocument, position: Position, _token: CancellationToken | undefined): boolean {
	return (isScriptComponent(document) || isInCfScript(document, position, _token));
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
		else if (characterAtPosition === "'" || characterAtPosition === "\"") {
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
		else if (characterAtPosition === "'" || characterAtPosition === "\"") {
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
