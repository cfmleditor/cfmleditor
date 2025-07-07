import { Range, TextDocument } from "vscode";

// If the key has no value, the last letter is ignored
// const DOC_PATTERN: RegExp = /(\n\s*(?:\*[ \t]*)?(?:@(\w+)(?:[. ](\w+))?)?[ \t]*)(\S.*)/gi;

const DOC_PATTERN: RegExp = /(\n\s*(?:\*)?)(?:(?:[ \t]*(@(\w+))[ \t]+(\w+))|([ \t]*[^@\s].*)?)(.*)/gi;
const INDENT_PATTERN: RegExp = /^[ \t]{2,}/i;
const CODE_BLOCK_PATTERN: RegExp = /```/i;

export interface DocBlockKeyValue {
	key: string; // lowercased
	subkey?: string; // lowercased
	value: string;
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
	let prevKey = "hint";
	let activeKey = "hint";
	let prevSubkey: string | undefined;
	let activeSubkey: string | undefined;
	let activeValue: string | undefined;
	let activeValueStartOffset = 0;
	let activeValueEndOffset = 0;
	let docBlockMatches: RegExpExecArray | null;
	let intendedCodeBlock: boolean = false;
	let explicitCodeBlock: boolean = false;
	let metadataValueIndent: RegExpMatchArray | null;
	let metadataValueReplace: RegExp | undefined;
	const docBlockOffset: number = document.offsetAt(docRange.start);
	while ((docBlockMatches = DOC_PATTERN.exec(docBlockStr))) {
		const valuePrefix: string = docBlockMatches[0] || "";
		const metadataKey: string = docBlockMatches[3] || "";
		const metadataValue: string = docBlockMatches[6] || docBlockMatches[5] || "";
		const metadataSubkey: string = docBlockMatches[4] || "";
		const docValueOffset: number = docBlockOffset + docBlockMatches.index + valuePrefix.length;

		if (metadataKey) {
			activeKey = metadataKey.toLowerCase();
			if (metadataSubkey) {
				activeSubkey = metadataSubkey.toLowerCase();
			}
			else {
				activeSubkey = undefined;
			}
		}
		else if (metadataValue === "") {
			continue;
		}

		if ((activeKey !== prevKey || activeSubkey !== prevSubkey) && activeValue) {
			// Close code blocks if they're open
			if (explicitCodeBlock) {
				explicitCodeBlock = false;
			}
			else if (intendedCodeBlock) {
				intendedCodeBlock = false;
				metadataValueReplace = undefined;
				activeValue += "\n```";
			}

			docBlock.push({
				key: prevKey,
				subkey: prevSubkey,
				value: activeValue.trim(),
				valueRange: new Range(document.positionAt(activeValueStartOffset), document.positionAt(activeValueEndOffset)),
			});
			prevKey = activeKey;
			prevSubkey = activeSubkey;
			activeValue = undefined;
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
			if (!intendedCodeBlock && metadataValueIndent && metadataValueIndent.length > 0) {
				metadataValueReplace = new RegExp("^(" + metadataValueIndent[0] + ")");
				intendedCodeBlock = true;
				activeValue += "\n```typescript";
			}
			else if (intendedCodeBlock && (!metadataValueIndent || metadataValueIndent.length < 1)) {
				intendedCodeBlock = false;
				metadataValueReplace = undefined;
				activeValue += "\n```";
			}
		}

		if (activeValue) {
			activeValue += "\n";
		}

		activeValue += metadataValueReplace ? metadataValue.replace(metadataValueReplace, "") : metadataValue;
		activeValueEndOffset = docValueOffset + metadataValue.length;
	}

	if (activeValue) {
		docBlock.push({
			key: activeKey,
			subkey: activeSubkey,
			value: activeValue.trim(),
			valueRange: new Range(document.positionAt(activeValueStartOffset), document.positionAt(activeValueEndOffset)),
		});
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
