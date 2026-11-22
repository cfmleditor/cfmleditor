import { Range, TextDocument } from "vscode";

const annotationPattern = /^[ \t]*@([\w$]+)(?:\.([\w$]+))?(?:[ \t]+|$)/;
const decorationPattern = /^[ \t]*\*[ \t]?/;
const fencePattern = /^ {0,3}(?:`{3,}|~{3,})/;
const indentedCodePattern = /^(?: {4}|\t)/;
const multilineAnnotations = new Set(["hint", "description", "param", "return", "returns"]);

export interface DocBlockKeyValue {
	key: string; // lowercased
	subkey?: string; // lowercased
	value: string;
	valueRange?: Range;
}

interface DocBlockLine {
	text: string;
	offset: number;
}

/**
 * Parses a CFScript documentation block.
 * @param document The document containing the block.
 * @param docRange The block's content, excluding the comment delimiters.
 * @returns Documentation and metadata with source ranges.
 */
export function parseDocBlock(document: TextDocument, docRange: Range): DocBlockKeyValue[] {
	const lines = document.getText(docRange).split("\n");
	const prose: DocBlockLine[] = [];
	const annotations: { key: string; subkey?: string; lines: DocBlockLine[] }[] = [];
	const unstarredLines = lines.slice(1).filter(line => line.trim() && !decorationPattern.test(line));
	const indentation = unstarredLines.reduce((indent, line) => Math.min(indent, line.length - line.trimStart().length), Infinity);

	let active = prose;
	let offset = document.offsetAt(docRange.start);
	let openFence: string | undefined;
	let inIndentedCode = false;
	for (const [index, raw] of lines.entries()) {
		const decoration = decorationPattern.exec(raw)?.[0].length;
		const prefix = decoration ?? (index === 0 ? raw.length - raw.trimStart().length : Math.min(indentation, raw.length));
		const line = raw.slice(prefix).replace(/\r$/, "");
		const lineOffset = offset + prefix;
		offset += raw.length + 1;

		const fence = fencePattern.exec(line)?.[0].trimStart();
		const indented = indentedCodePattern.test(line);
		const annotation = !openFence && !(inIndentedCode && indented) ? annotationPattern.exec(line) : null;
		if (annotation) {
			const key = annotation[1].toLowerCase();
			const subkey = annotation[2]?.toLowerCase();
			const valuePrefix = annotation[0].length;
			const valueLines = [{ text: line.slice(valuePrefix), offset: lineOffset + valuePrefix }];
			annotations.push({ key, subkey, lines: valueLines });
			active = multilineAnnotations.has(key) || subkey === "hint" ? valueLines : prose;
			inIndentedCode = false;
			continue;
		}

		active.push({ text: line, offset: lineOffset });
		if (fence && !openFence) {
			openFence = fence;
		}
		else if (fence && openFence && fence.startsWith(openFence) && line.trim() === fence) {
			openFence = undefined;
		}
		if (line.trim()) {
			inIndentedCode = indented;
		}
	}

	const entries = prose.some(line => line.text.trim()) ? [{ key: "hint", subkey: undefined, lines: prose }, ...annotations] : annotations;
	return entries.map(({ key, subkey, lines }) => {
		const first = lines.findIndex(line => line.text.trim());
		if (first === -1) {
			return { key, subkey, value: "" };
		}
		let last = lines.length - 1;
		while (!lines[last].text.trim()) {
			last--;
		}
		const endLength = lines[last].text.trimEnd().length;
		const valueRange = new Range(document.positionAt(lines[first].offset), document.positionAt(lines[last].offset + endLength));
		const value = lines.slice(first, last + 1).map(line => line.text).join("\n").trimEnd();
		return { key, subkey, value, valueRange };
	});
}
