import { CancellationToken, ConfigurationScope, Position, Range, TextDocument, WorkspaceConfiguration, workspace } from "vscode";
import { Component, isScriptComponent } from "../entities/component";
import { getComponent } from "../features/cachedEntities";
import { CFMLEngine, CFMLEngineName } from "./cfdocs/cfmlEngine";
import { getCfScriptRanges, getDocumentContextRanges, isCfcFile, isCfmFile, isCfsFile, isContinuingExpression, isInRanges, DocumentContextRanges, isMemberExpression } from "./contextUtil";
import { getSanitizedDocumentText } from "./textUtil";

export interface DocumentStateContext {
	document: TextDocument;
	isCfmFile: boolean;
	isCfcFile: boolean;
	docIsScript: boolean;
	commentRanges: Range[];
	stringRanges?: Range[];
	stringEmbeddedCfmlRanges?: Range[];
	sanitizedDocumentText: string;
	component?: Component;
	cfmlEngine: CFMLEngine;
	includeImplicitAccessors: boolean;
}

export interface DocumentPositionStateContext extends DocumentStateContext {
	position: Position;
	positionIsScript: boolean;
	positionInComment: boolean;
	docPrefix: string;
	wordRange: Range;
	currentWord: string;
	isContinuingExpression: boolean;
	isMemberExpression: boolean;
}

/**
 *
 * @param scope
 * @returns CFMLEngine
 */
export function getCFMLEngine(scope?: ConfigurationScope | null): CFMLEngine {
	const cfmlEngineSettings: WorkspaceConfiguration = workspace.getConfiguration("cfml.engine", scope);
	const cfmlEngineName: CFMLEngineName = CFMLEngineName.valueOf(cfmlEngineSettings.get<string>("name", "coldfusion"));
	const cfmlEngine: CFMLEngine = new CFMLEngine(cfmlEngineName, cfmlEngineSettings.get<string>("version", "2021.0.0"));
	return cfmlEngine;
}

/**
 * Provides context information for the given document
 * @param document The document for which to provide context
 * @param fast Whether to use the faster, but less accurate parsing
 * @param replaceComments replace comments in getSanitizedDocumentText
 * @param _token
 * @param exclDocumentRanges
 * @param cfmlEngine
 * @param includeImplicitAccessors
 * @returns DocumentStateContext
 */
export function getDocumentStateContext(document: TextDocument, fast: boolean = false, replaceComments: boolean = false, _token: CancellationToken | undefined, exclDocumentRanges: boolean = false, cfmlEngine: CFMLEngine, includeImplicitAccessors: boolean): DocumentStateContext {
	const docIsCfcFile: boolean = isCfcFile(document, _token);
	const docIsCfmFile: boolean = isCfmFile(document, _token);
	const docIsCfsFile: boolean = isCfsFile(document, _token);
	const thisComponent: Component | undefined = getComponent(document.uri, _token);

	// If we've already cached the component we already know if it is a script component
	const docIsScript: boolean = thisComponent ? thisComponent.isScript : ((docIsCfcFile && isScriptComponent(document, _token)) || docIsCfsFile);

	const documentRanges: DocumentContextRanges = getDocumentContextRanges(document, docIsScript, undefined, fast, _token, exclDocumentRanges);
	const commentRanges: Range[] = documentRanges.commentRanges;
	const stringRanges: Range[] | undefined = documentRanges.stringRanges;
	const stringEmbeddedCfmlRanges: Range[] | undefined = documentRanges.stringEmbeddedCfmlRanges;
	const sanitizedDocumentText: string = getSanitizedDocumentText(document, commentRanges, replaceComments, _token);

	return {
		document,
		isCfmFile: docIsCfmFile,
		isCfcFile: docIsCfcFile,
		docIsScript,
		commentRanges,
		stringRanges,
		stringEmbeddedCfmlRanges,
		sanitizedDocumentText,
		component: thisComponent,
		cfmlEngine,
		includeImplicitAccessors,
	};
}

/**
 * Provides context information for the given document and position
 * @param document The document for which to provide context
 * @param position The position within the document for which to provide context
 * @param fast Whether to use the faster, but less accurate parsing
 * @param replaceComments replace comments in getDocumentStateContext
 * @param _token
 * @param exclDocumentRanges
 * @param cfmlEngine
 * @param lookbehindMaxLength
 * @param includeImplicitAccessors
 * @returns DocumentPositionStateContext
 */
export function getDocumentPositionStateContext(document: TextDocument, position: Position, fast: boolean = false, replaceComments: boolean = false, _token: CancellationToken | undefined, exclDocumentRanges: boolean = false, cfmlEngine: CFMLEngine, lookbehindMaxLength: number, includeImplicitAccessors: boolean): DocumentPositionStateContext {
	const documentStateContext: DocumentStateContext = getDocumentStateContext(document, fast, replaceComments, _token, exclDocumentRanges, cfmlEngine, includeImplicitAccessors);
	const docIsScript: boolean = documentStateContext.docIsScript;
	const positionInComment: boolean = isInRanges(documentStateContext.commentRanges, position, false, _token);
	const cfscriptRanges: Range[] = getCfScriptRanges(document, undefined, _token);
	const positionIsScript: boolean = docIsScript || isInRanges(cfscriptRanges, position, false, _token);

	let wordRange: Range | undefined = document.getWordRangeAtPosition(position);
	const currentWord: string = wordRange ? document.getText(wordRange) : "";
	if (!wordRange) {
		wordRange = new Range(position, position);
	}
	const wordRangeStartOffset = document.offsetAt(wordRange.start);
	const documentSliceStart: number = lookbehindMaxLength > -1 ? Math.max(0, wordRangeStartOffset - lookbehindMaxLength) : 0;
	const docPrefix: string = documentStateContext.sanitizedDocumentText.slice(documentSliceStart, wordRangeStartOffset);

	const documentPositionStateContext: DocumentPositionStateContext = Object.assign(documentStateContext,
		{
			position,
			positionIsScript,
			positionInComment,
			docPrefix,
			wordRange,
			currentWord,
			isContinuingExpression: isContinuingExpression(docPrefix, _token),
			isMemberExpression: isMemberExpression(docPrefix),
		}
	);

	return documentPositionStateContext;
}
