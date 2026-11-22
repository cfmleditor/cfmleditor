import { CancellationToken, Position, Range, SelectionRange, SelectionRangeProvider, TextDocument } from "vscode";
import { getLanguageService, type SelectionRange as HTMLSelectionRange } from "vscode-html-languageservice";
import { TextDocument as LanguageDocument } from "vscode-languageserver-textdocument";
import { getCfScriptRanges } from "../utils/contextUtil";
import { getDocumentStateContext } from "../utils/documentUtil";
import { replaceRangeWithSpaces } from "../utils/textUtil";

const html = getLanguageService();
const interpolationPattern = /##|#(?:[^#<>"'\r\n]|"(?:""|[^"\r\n])*"|'(?:''|[^'\r\n])*')+#/g;

/**
 * Finds the complete hash expression under the cursor within the current markup range.
 * @param document The editor document.
 * @param text The document with comments and script bodies masked.
 * @param position The cursor position.
 * @param markupRange The smallest HTML selection at the cursor.
 * @returns The hash expression range, when present.
 */
function interpolationRange(document: TextDocument, text: string, position: Position, markupRange: Range | undefined): Range | undefined {
	const lineRange = document.lineAt(position.line).range;
	const searchRange = markupRange ? lineRange.intersection(markupRange) : lineRange;
	if (!searchRange) {
		return undefined;
	}

	const start = document.offsetAt(searchRange.start);
	const cursor = document.offsetAt(position);
	const line = text.slice(start, document.offsetAt(searchRange.end));
	for (const match of line.matchAll(interpolationPattern)) {
		const matchStart = start + match.index;
		const matchEnd = matchStart + match[0].length;
		if (match[0] !== "##" && matchStart <= cursor && cursor < matchEnd) {
			return new Range(document.positionAt(matchStart), document.positionAt(matchEnd));
		}
	}
	return undefined;
}

export default class CFMLSelectionRangeProvider implements SelectionRangeProvider {
	/**
	 * Combines CFML interpolation and HTML selection stops.
	 * @param document The document being edited.
	 * @param positions The active cursor positions.
	 * @param token The cancellation token.
	 * @returns The selection chain for each cursor.
	 */
	public async provideSelectionRanges(document: TextDocument, positions: Position[], token: CancellationToken): Promise<SelectionRange[] | undefined> {
		const state = await getDocumentStateContext(document, true, false, token);
		if (token.isCancellationRequested || state.docIsScript) {
			return undefined;
		}

		const scriptBodies = getCfScriptRanges(document, undefined, token, state.commentRanges, true, undefined, true);
		const markup = replaceRangeWithSpaces(document, [...state.commentRanges, ...scriptBodies]);
		const htmlDocument = LanguageDocument.create(document.uri.toString(), "html", document.version, markup);
		const htmlSelections = html.getSelectionRanges(htmlDocument, positions);

		return positions.map((position, index) => {
			const htmlRanges: Range[] = [];
			for (let selection: HTMLSelectionRange | undefined = htmlSelections[index]; selection; selection = selection.parent) {
				const { start, end } = selection.range;
				const range = new Range(start.line, start.character, end.line, end.character);
				if (!range.isEmpty) {
					htmlRanges.push(range);
				}
			}

			const word = document.getWordRangeAtPosition(position);
			const expression = interpolationRange(document, markup, position, htmlRanges[0]);
			const ranges: Range[] = [];
			for (const range of [word, expression, ...htmlRanges]) {
				const previous = ranges.at(-1);
				if (range?.contains(position) && (!previous || (range.contains(previous) && !range.isEqual(previous)))) {
					ranges.push(range);
				}
			}

			return ranges.reduceRight<SelectionRange | undefined>((parent, range) => new SelectionRange(range, parent), undefined)
				?? new SelectionRange(new Range(position, position));
		});
	}
}
