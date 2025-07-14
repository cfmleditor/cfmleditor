import { Range, TextDocument } from "vscode";
import { integer } from "vscode-languageserver-types";

// If the key has no value, the last letter is ignored
// const DOC_PATTERN: RegExp = /(\n\s*(?:\*[ \t]*)?(?:@(\w+)(?:[. ](\w+))?)?[ \t]*)(\S.*)/gi;

const DOC_PATTERN: RegExp = /((?:\n\s*|^\s*)(?:\*)?)(?:(?:[ \t]*(@([\w{}]+)(?:[\s]+((?:\{(?:[^{}]+)\}|\s?\{\s?|\s?\}\s?)+))?)(?:[ \t.]+([\w{}.]+))?)|([ \t]*[^@\s].*)?)(.*)/gi;
const INDENT_PATTERN: RegExp = /^[ \t]{2,}/i;
const CODE_BLOCK_PATTERN: RegExp = /```/i;

/*
true - implies a property can have multiple lines
false - implies ( for now ), that additional lines are "HINT" lines
*/
const MULTI_LINE_PROPERTIES = false;

export interface DocBlockKeyValue {
	key: string; // lowercased
	subkey?: string; // lowercased
	value: string;
	type?: string;
	valueRange?: Range;
}

/**
 * Parses a CFScript documentation block and returns an array of DocBlockKeyValue objects
 * @param document The document in which to parse
 * @param docRange The range within the document containing the docblock
 * @returns
 */
export function parseDocBlock(document: TextDocument, docRange: Range): DocBlockKeyValue[] {
	const docBlockStr: string = document.getText(docRange);
	const docBlock: DocBlockKeyValue[] = [];
	const docBlockKeys: Map<string, integer> = new Map();
	let prevKey = "hint";
	let activeKey = "hint";
	let prevSubkey: string | undefined;
	let prevType: string | undefined;
	let activeSubkey: string | undefined;
	let activeValue: string | undefined;
	let activeType: string | undefined;
	let activeValueStartOffset = 0;
	let activeValueEndOffset = 0;
	let docBlockMatches: RegExpExecArray | null;
	let indentedCodeBlock: boolean = false;
	let explicitCodeBlock: boolean = false;
	let metadataValueIndent: RegExpMatchArray | null;
	let metadataValueReplace: RegExp | undefined;
	let overwriteValue: boolean = false;

	const docBlockOffset: number = document.offsetAt(docRange.start);
	while ((docBlockMatches = DOC_PATTERN.exec(docBlockStr))) {
		const valuePrefix: string = docBlockMatches[0] || ""; // full line
		// const metadataKeyWithAtSymbol = docBlockMatches[2] matches @value with @prefix
		/*
		If not multi line and metadataKey is empty, assume its part of the hint
		*/

		const metadataKey: string = docBlockMatches[3] || ""; // matches @value without @prefix
		const metadataSubkey: string = (metadataKey === "param" ? docBlockMatches[5] : ""); // matches value after the @value where its not {}, the second where it is {}
		const metadataValue: string = (metadataKey !== "param" && docBlockMatches[5] ? docBlockMatches[5] : "") + (docBlockMatches[7] || docBlockMatches[6] || ""); // matches description [7] when @value exists on that line otherwise [6]
		const metadataType: string = docBlockMatches[4] || ""; // matches first value after the @value where it is {}
		const docValueOffset: number = docBlockOffset + docBlockMatches.index + valuePrefix.length;

		if (metadataKey) {
			activeKey = metadataKey.toLowerCase();
			activeType = metadataType.toLowerCase();

			if (metadataSubkey) {
				activeSubkey = metadataSubkey.toLowerCase();
			}
			else {
				activeSubkey = undefined;
			}
		}
		else {
			if (metadataValue.trim() === "") {
				continue;
			}
		}

		if (activeKey === "hint" && metadataKey === "hint") {
			overwriteValue = true;
		}
		else {
			overwriteValue = false;
		}

		if ((activeKey !== prevKey || (activeSubkey !== prevSubkey)) && (activeValue || prevSubkey)) {
			// Close code blocks if they're open
			if (explicitCodeBlock) {
				explicitCodeBlock = false;
			}
			else if (indentedCodeBlock) {
				indentedCodeBlock = false;
				metadataValueReplace = undefined;
				activeValue += "\n```";
			}

			docBlock.push({
				key: prevKey,
				subkey: prevSubkey,
				value: activeValue ? activeValue.trim() : "",
				type: prevType,
				valueRange: new Range(document.positionAt(activeValueStartOffset), document.positionAt(activeValueEndOffset)),
			});

			docBlockKeys.set(prevKey, docBlock.length - 1);
			prevKey = activeKey;
			prevSubkey = activeSubkey;
			prevType = activeType;
			activeType = undefined;
			activeValue = undefined;
		}

		/**
		 * If no metadataKey and we're not in multi line property mode, assume the line is for a "Hint"
		 */
		if (!MULTI_LINE_PROPERTIES && !metadataKey && docBlockKeys.get("hint") !== undefined) {
			const posn: integer | undefined = docBlockKeys.get("hint");
			if (posn !== undefined) {
				docBlock[posn].value += "\n" + metadataValue.trim();
			}
			continue;
		}

		if (!activeValue) {
			activeValueStartOffset = docValueOffset;
			activeValue = "";
		}

		if (CODE_BLOCK_PATTERN.test(metadataValue)) {
			explicitCodeBlock = !explicitCodeBlock;
		}

		if (!explicitCodeBlock) {
			metadataValueIndent = metadataValue.match(INDENT_PATTERN);
			if (!indentedCodeBlock && metadataValueIndent && metadataValueIndent.length > 0) {
				metadataValueReplace = new RegExp("^(" + metadataValueIndent[0] + ")");
				indentedCodeBlock = true;
				activeValue += "\n```typescript";
			}
			else if (indentedCodeBlock && (!metadataValueIndent || metadataValueIndent.length < 1)) {
				indentedCodeBlock = false;
				metadataValueReplace = undefined;
				activeValue += "\n```";
			}
		}

		if (activeValue) {
			activeValue += "\n";
		}

		// If in a explicit code block or an indented one preserve white space
		if (explicitCodeBlock || indentedCodeBlock) {
			activeValue += metadataValueReplace ? metadataValue.replace(metadataValueReplace, "") : metadataValue;
		}
		else if (overwriteValue === true) {
			activeValue = metadataValueReplace ? metadataValue.replace(metadataValueReplace, "").trim() : metadataValue.trim();
		}
		else {
			activeValue += metadataValueReplace ? metadataValue.replace(metadataValueReplace, "").trim() : metadataValue.trim();
		}
		activeType = metadataType.toLowerCase();
		activeValueEndOffset = docValueOffset + metadataValue.length;
	}

	if (activeKey) {
		docBlock.push({
			key: activeKey,
			subkey: activeSubkey,
			value: activeValue ? activeValue.trim() : "",
			type: activeType,
			valueRange: new Range(document.positionAt(activeValueStartOffset), document.positionAt(activeValueEndOffset)),
		});
		docBlockKeys.set(activeKey, docBlock.length - 1);
	}

	return docBlock;
}

/**
 * Gets a regular expression that matches a docblock key with the given name and captures its next word
 * @param keyName The tag key to match
 * @returns
 */
export function getKeyPattern(keyName: string): RegExp {
	return new RegExp(`@${keyName}\\s+(\\S+)`, "i");
}
