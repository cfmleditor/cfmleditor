import { CancellationToken, Position, Range, TextDocument, WorkspaceConfiguration, workspace } from "vscode";
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
    userEngine: CFMLEngine;
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
 * Provides context information for the given document
 * @param document The document for which to provide context
 * @param fast Whether to use the faster, but less accurate parsing
 * @param replaceComments replace comments in getSanitizedDocumentText
 * @param _token
 * @param exclDocumentRanges
 * @returns DocumentStateContext
 */
export function getDocumentStateContext(document: TextDocument, fast: boolean = false, replaceComments: boolean = false, _token: CancellationToken, exclDocumentRanges: boolean = false): DocumentStateContext {
    const cfmlEngineSettings: WorkspaceConfiguration = workspace.getConfiguration("cfml.engine");
    const userEngineName: CFMLEngineName = CFMLEngineName.valueOf(cfmlEngineSettings.get<string>("name"));
    const userEngine: CFMLEngine = new CFMLEngine(userEngineName, cfmlEngineSettings.get<string>("version"));

    const docIsCfcFile: boolean = isCfcFile(document, _token);
    const docIsCfmFile: boolean = isCfmFile(document, _token);
    const docIsCfsFile: boolean = isCfsFile(document, _token);
    const thisComponent: Component = getComponent(document.uri, _token);
    const docIsScript: boolean = (docIsCfcFile && isScriptComponent(document, _token)) || docIsCfsFile;

    const documentRanges: DocumentContextRanges = getDocumentContextRanges(document, docIsScript, undefined, fast, _token, exclDocumentRanges);
    const commentRanges: Range[] = documentRanges.commentRanges;
    const stringRanges: Range[] = documentRanges.stringRanges;
    const stringEmbeddedCfmlRanges: Range[] = documentRanges.stringEmbeddedCfmlRanges;
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
        userEngine
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
 * @returns DocumentPositionStateContext
 */
export function getDocumentPositionStateContext(document: TextDocument, position: Position, fast: boolean = false, replaceComments: boolean = false, _token: CancellationToken, exclDocumentRanges: boolean = false): DocumentPositionStateContext {
    const documentStateContext: DocumentStateContext = getDocumentStateContext(document, fast, replaceComments, _token, exclDocumentRanges);

    const docIsScript: boolean = documentStateContext.docIsScript;
    const positionInComment: boolean = isInRanges(documentStateContext.commentRanges, position, false, _token);
    const cfscriptRanges: Range[] = getCfScriptRanges(document, null, _token);
    const positionIsScript: boolean = docIsScript || isInRanges(cfscriptRanges, position, false, _token);

    let wordRange: Range = document.getWordRangeAtPosition(position);
    const currentWord: string = wordRange ? document.getText(wordRange) : "";
    if (!wordRange) {
        wordRange = new Range(position, position);
    }
    const docPrefix: string = documentStateContext.sanitizedDocumentText.slice(0, document.offsetAt(wordRange.start));

    const documentPositionStateContext: DocumentPositionStateContext = Object.assign(documentStateContext,
        {
            position,
            positionIsScript,
            positionInComment,
            docPrefix,
            wordRange,
            currentWord,
            isContinuingExpression: isContinuingExpression(docPrefix, _token),
            isMemberExpression: isMemberExpression(docPrefix)
        }
    );

    return documentPositionStateContext;
}
