const tagEndingPattern = /^<([_a-zA-Z][a-zA-Z0-9:\-_.]*)(?:\s[^<>]*[^\s/<>=])?\s*([/>])$/;

/**
 * Matches the opening tag ending at the cursor.
 * @param text The line up to and including the character just typed.
 * @returns The matched text, tag name, and typed delimiter.
 */
export function matchAutoCloseTag(text: string): RegExpExecArray | null {
	// Only the last opening bracket can start a match because attributes in
	// this matcher cannot contain angle brackets.
	const start = text.lastIndexOf("<");
	return start === -1 ? null : tagEndingPattern.exec(text.slice(start));
}
